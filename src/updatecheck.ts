import * as fs from "fs";
import { fetchWithProxy } from "./proxy.js";

// Shared update checker for CLI (`update`) and menu (live badge).
// The menu checks exactly once when it opens — no re-checks during the session.

const REPO = "2sulraw/TrueSearchMCP";
export const REPO_URL = `https://github.com/${REPO}`;

export interface UpdateCheck {
  local: string;
  lines: string[]; // formatted "GitHub: ...", "Source: ...", "npm: ..."
  available: boolean;
  hint: string;
  failed: boolean; // no source responded at all (offline etc.)
}

export function readLocalVersion(): string {
  try {
    const pkg = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf-8"));
    return pkg.version || "0.0.0";
  } catch {
    return "0.0.0";
  }
}

/** -1 if a<b, 0 if equal, 1 if a>b */
export function cmpVer(a: string, b: string): number {
  const pa = a.split(".").map((n) => parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  }
  return 0;
}

async function runCheck(): Promise<UpdateCheck> {
  const local = readLocalVersion();
  const lines: string[] = [];
  let available = false;
  let responded = false;

  // 1) GitHub latest release
  try {
    const r = await fetchWithProxy(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: { "User-Agent": "truesearch-mcp", Accept: "application/vnd.github+json" },
      signal: AbortSignal.timeout(8000),
    });
    responded = true;
    if (r.ok) {
      const rel = await r.json();
      const tag = String(rel.tag_name || "");
      const ver = tag.replace(/^v/, "");
      if (cmpVer(ver, local) > 0) {
        available = true;
        lines.push(`GitHub:  ${tag} — UPDATE AVAILABLE`);
        lines.push(`         ${rel.html_url || REPO_URL + "/releases"}`);
      } else {
        lines.push(`GitHub:  ${tag} — up to date`);
      }
    } else if (r.status === 404) {
      lines.push(`GitHub:  no releases yet (${REPO_URL}/releases)`);
    } else {
      lines.push(`GitHub:  HTTP ${r.status}`);
    }
  } catch (e: any) {
    lines.push(`GitHub:  check failed (${e.message})`);
  }

  // 2) Repo source package.json (works after push, before formal releases)
  for (const branch of ["main", "master"]) {
    try {
      const r = await fetchWithProxy(
        `https://raw.githubusercontent.com/${REPO}/${branch}/package.json`,
        { signal: AbortSignal.timeout(8000) }
      );
      responded = true;
      if (r.ok) {
        const pkg = await r.json();
        const ver = String(pkg.version || "");
        if (ver && cmpVer(ver, local) > 0) {
          available = true;
          lines.push(`Source:  ${branch} @ ${ver} — UPDATE AVAILABLE`);
        } else if (ver) {
          lines.push(`Source:  ${branch} @ ${ver} — up to date`);
        }
        break;
      }
      if (r.status === 404 && branch === "master") {
        lines.push("Source:  not pushed yet (repo has no package.json)");
      }
    } catch (e: any) {
      lines.push(`Source:  check failed (${e.message})`);
      break;
    }
  }

  // 3) npm registry
  try {
    const r = await fetchWithProxy("https://registry.npmjs.org/truesearch-mcp/latest", {
      signal: AbortSignal.timeout(8000),
    });
    responded = true;
    if (r.ok) {
      const pkg = await r.json();
      const ver = String(pkg.version || "");
      if (ver && cmpVer(ver, local) > 0) {
        available = true;
        lines.push(`npm:     ${ver} — UPDATE AVAILABLE (npm install -g truesearch-mcp@${ver})`);
      } else if (ver) {
        lines.push(`npm:     ${ver} — up to date`);
      }
    } else if (r.status === 404) {
      lines.push("npm:     not published");
    } else {
      lines.push(`npm:     HTTP ${r.status}`);
    }
  } catch (e: any) {
    lines.push(`npm:     check failed (${e.message})`);
  }

  return {
    local,
    lines,
    available,
    hint: available ? `Download: ${REPO_URL}/releases` : "",
    failed: !responded,
  };
}

let cached: UpdateCheck | null = null;
let inflight: Promise<UpdateCheck> | null = null;
let started = false;
let pendingNotify: (() => void) | null = null;

/**
 * Start the update check ONCE, when the menu opens the first time.
 * Later menu opens only refresh the notify callback (no re-check).
 */
export function maybeStartCheck(notify?: () => void): void {
  if (notify) pendingNotify = notify;
  if (started) return; // check once per process — no re-checks
  started = true;
  inflight = runCheck()
    .then((r) => {
      cached = r;
      inflight = null;
      pendingNotify?.();
      return r;
    })
    .catch((e) => {
      cached = {
        local: readLocalVersion(),
        lines: [`Check:     failed (${e.message})`],
        available: false,
        hint: "",
        failed: true,
      };
      inflight = null;
      pendingNotify?.();
      return cached;
    });
}

/** Await a check. force=true always runs a fresh check (used by `cli update`). */
export async function getUpdateCheck(force = false): Promise<UpdateCheck> {
  if (force || !cached) {
    if (!inflight || force) {
      if (force && inflight) return inflight; // don't stack duplicate requests
      started = true;
      inflight = runCheck().then((r) => {
        cached = r;
        inflight = null;
        return r;
      }).catch((e) => {
        cached = {
          local: readLocalVersion(),
          lines: [`Check:     failed (${e.message})`],
          available: false,
          hint: "",
          failed: true,
        };
        inflight = null;
        return cached;
      });
    }
    return inflight;
  }
  return cached;
}

/** One-line badge for the menu status area. Non-blocking. */
export function getUpdateBadge(): string {
  const colors = {
    reset: process.stdout.isTTY && !process.env.NO_COLOR ? "\x1b[0m" : "",
    dim: process.stdout.isTTY && !process.env.NO_COLOR ? "\x1b[2m" : "",
    yellow: process.stdout.isTTY && !process.env.NO_COLOR ? "\x1b[33m" : "",
    red: process.stdout.isTTY && !process.env.NO_COLOR ? "\x1b[31m" : "",
  };
  if (inflight || (!cached && started)) {
    return `${colors.dim}◇ checking for updates…${colors.reset}`;
  }
  if (!cached) return "";
  if (cached.available) {
    return `${colors.yellow}⚠ update available — run: tsmcp update${colors.reset}`;
  }
  if (cached.failed) {
    return `${colors.red}◇ update check failed${colors.reset}`;
  }
  return `${colors.dim}✓ up to date (v${cached.local})${colors.reset}`;
}
