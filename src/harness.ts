import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { MCP_PATH } from "./cfg.js";

export interface Harness {
  id: string;
  name: string;
  detected: boolean;
  installed: boolean;
  detail: string; // config path or detection reason
}

const home = os.homedir();
const appData = process.env.APPDATA || "";
const localAppData = process.env.LOCALAPPDATA || "";

function exists(p: string): boolean {
  try { return fs.existsSync(p); } catch { return false; }
}

function readText(p: string): string {
  try { return fs.readFileSync(p, "utf-8"); } catch { return ""; }
}

function readJson(p: string): any {
  try { return JSON.parse(fs.readFileSync(p, "utf-8")); } catch { return null; }
}

function firstExisting(...paths: string[]): string | null {
  for (const p of paths) if (exists(p)) return p;
  return null;
}

const stdioEntry = () => ({ command: "node", args: [MCP_PATH], type: "stdio" });

// ── detection ──────────────────────────────────────────────

export function detectHarnesses(): Harness[] {
  const list: Harness[] = [];

  // 1. Claude Desktop
  {
    const p = path.join(appData, "Claude", "claude_desktop_config.json");
    const detected = exists(p);
    const cfg = readJson(p);
    list.push({
      id: "claude-desktop", name: "Claude Desktop",
      detected, installed: !!cfg?.mcpServers?.truesearch,
      detail: detected ? p : "claude_desktop_config.json not found",
    });
  }

  // 2. Claude Code
  {
    const p = path.join(home, ".claude.json");
    const detected = exists(p);
    const cfg = readJson(p);
    list.push({
      id: "claude-code", name: "Claude Code",
      detected, installed: !!cfg?.mcpServers?.truesearch,
      detail: detected ? p : "~/.claude.json not found",
    });
  }

  // 3. Hermes
  {
    const p = firstExisting(
      path.join(home, ".hermes", "config.yaml"),
      path.join(appData, "hermes", "config.yaml")
    );
    const text = p ? readText(p) : "";
    list.push({
      id: "hermes", name: "Hermes",
      detected: !!p, installed: /truesearch/.test(text),
      detail: p || "config.yaml not found",
    });
  }

  // 4. OpenCode (edits opencode.json; jsonc shown as snippet only)
  {
    const p = firstExisting(
      path.join(home, ".config", "opencode", "opencode.json"),
      path.join(home, ".opencode", "opencode.json")
    );
    const cfg = p ? readJson(p) : null;
    list.push({
      id: "opencode", name: "OpenCode",
      detected: !!p || exists(path.join(home, ".config", "opencode", "opencode.jsonc")),
      installed: !!cfg?.mcp?.truesearch,
      detail: p || path.join(home, ".config", "opencode", "opencode.jsonc") + " (jsonc — snippet only)",
    });
  }

  // 5. Cline / Roo Code
  {
    const storage = path.join(appData, "Code", "User", "globalStorage", "saoudrizwan.claude-dev");
    const extDirs = path.join(home, ".vscode", "extensions");
    const ext = exists(extDirs) && fs.readdirSync(extDirs).some((d) => d.startsWith("saoudrizwan.claude-dev"));
    const settingsPath = path.join(storage, "settings", "cline_mcp_settings.json");
    const detected = exists(storage) || ext;
    const cfg = readJson(settingsPath);
    list.push({
      id: "cline", name: "Cline / Roo Code",
      detected, installed: !!cfg?.mcpServers?.truesearch,
      detail: detected ? settingsPath : "VS Code extension not found",
    });
  }

  // 6. Cursor
  {
    const cfgPath = path.join(home, ".cursor", "mcp.json");
    const detected = exists(cfgPath) || exists(path.join(appData, "Cursor")) || exists(path.join(localAppData, "Programs"));
    const cursorApp = exists(path.join(appData, "Cursor"));
    const cfg = readJson(cfgPath);
    list.push({
      id: "cursor", name: "Cursor",
      detected: exists(cfgPath) || cursorApp,
      installed: !!cfg?.mcpServers?.truesearch,
      detail: exists(cfgPath) ? cfgPath : cursorApp ? path.join(appData, "Cursor") + " (mcp.json will be created)" : "Cursor not found",
    });
    void detected;
  }

  // 7. Goose
  {
    const p = firstExisting(
      path.join(home, ".config", "goose", "config.yaml"),
      path.join(home, ".goose", "config.yaml")
    );
    const text = p ? readText(p) : "";
    list.push({
      id: "goose", name: "Goose (Block)",
      detected: !!p, installed: /truesearch/.test(text),
      detail: p || "config.yaml not found",
    });
  }

  // 8. Zed
  {
    const p = firstExisting(
      path.join(appData, "Zed", "settings.json"),
      path.join(home, ".config", "zed", "settings.json")
    );
    const cfg = p ? readJson(p) : null;
    list.push({
      id: "zed", name: "Zed",
      detected: !!p, installed: !!cfg?.context_servers?.truesearch,
      detail: p || "settings.json not found",
    });
  }

  // 9. Windsurf
  {
    const cfgPath = path.join(home, ".codeium", "windsurf", "mcp_config.json");
    const dir = exists(path.join(home, ".codeium", "windsurf")) || exists(path.join(appData, "Windsurf"));
    const cfg = readJson(cfgPath);
    list.push({
      id: "windsurf", name: "Windsurf",
      detected: dir, installed: !!cfg?.mcpServers?.truesearch,
      detail: dir ? cfgPath : "Windsurf not found",
    });
  }

  // 10. Continue
  {
    const p = firstExisting(
      path.join(home, ".continue", "config.yaml"),
      path.join(appData, "Continue", "config.yaml")
    );
    const text = p ? readText(p) : "";
    list.push({
      id: "continue", name: "Continue",
      detected: !!p, installed: /truesearch/.test(text),
      detail: p || "config.yaml not found",
    });
  }

  return list;
}

// ── snippets (for undetected / unsafe-to-edit configs) ─────

function jsonSnippet(): string {
  return JSON.stringify({ mcpServers: { truesearch: stdioEntry() } }, null, 2);
}

function openCodeSnippet(): string {
  return JSON.stringify(
    { mcp: { truesearch: { type: "local", command: ["node", MCP_PATH], enabled: true } } },
    null, 2
  );
}

function yamlSnippet(): string {
  const winPath = MCP_PATH.replace(/\\/g, "/");
  return `mcp_servers:
  truesearch:
    command: "node"
    args: ["${winPath}"]
    enabled: true`;
}

function zedSnippet(): string {
  return JSON.stringify(
    { context_servers: { truesearch: { command: "node", args: [MCP_PATH] } } },
    null, 2
  );
}

// ── install ────────────────────────────────────────────────

function mergeJsonMcpServers(p: string): void {
  const cfg = readJson(p) || {};
  cfg.mcpServers = cfg.mcpServers || {};
  cfg.mcpServers.truesearch = stdioEntry();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(cfg, null, 2));
}

/** Append truesearch under mcp_servers. If key exists, insert right after it; else append the block. */
function appendYamlBlock(p: string): boolean {
  const text = readText(p);
  if (/truesearch/.test(text)) return false;
  const entry = `  truesearch:\n    command: "node"\n    args: ["${MCP_PATH.replace(/\\/g, "/")}"]\n    enabled: true\n`;
  fs.mkdirSync(path.dirname(p), { recursive: true });
  if (/^mcp_servers:[ \t]*$/m.test(text)) {
    fs.writeFileSync(p, text.replace(/^mcp_servers:[ \t]*\n/m, `mcp_servers:\n${entry}`));
    return true;
  }
  if (/^\s*mcp_servers:/m.test(text)) return false; // unexpected shape — snippet fallback
  const block = (text.trimEnd() ? text.trimEnd() + "\n\n" : "") + yamlSnippet() + "\n";
  fs.writeFileSync(p, block);
  return true;
}

function removeJsonEntry(p: string, section: string, key: string): boolean {
  const cfg = readJson(p);
  if (!cfg?.[section]?.[key]) return false;
  delete cfg[section][key];
  fs.writeFileSync(p, JSON.stringify(cfg, null, 2));
  return true;
}

/** Remove our truesearch block from YAML (2-space key + 4-space children). */
function removeYamlTruesearch(p: string): boolean {
  let text = readText(p);
  if (!/truesearch/.test(text)) return false;
  const stripped = text.replace(/\n {2}truesearch:\n(?: {4}[^\n]*\n)*/g, "\n");
  if (/truesearch/.test(stripped)) return false; // unexpected format — manual removal
  fs.writeFileSync(p, stripped);
  return true;
}

export interface InstallResult {
  ok: boolean;
  message: string;
}

export function installHarness(id: string): InstallResult {
  const h = detectHarnesses().find((x) => x.id === id);
  if (!h) return { ok: false, message: `Unknown harness: ${id}` };

  if (!h.detected) {
    return {
      ok: false,
      message: `${h.name} not detected on this machine.\n\nConfig snippet:\n${snippetFor(id)}`,
    };
  }
  if (h.installed) {
    return { ok: true, message: `${h.name}: already installed (${h.detail})` };
  }

  try {
    switch (id) {
      case "claude-desktop": {
        const p = path.join(appData, "Claude", "claude_desktop_config.json");
        mergeJsonMcpServers(p);
        return { ok: true, message: `${h.name}: installed → ${p}\nRestart Claude Desktop to load it.` };
      }
      case "claude-code": {
        const p = path.join(home, ".claude.json");
        mergeJsonMcpServers(p);
        return { ok: true, message: `${h.name}: installed → ${p}\nRun \`claude mcp list\` to verify.` };
      }
      case "opencode": {
        const p = path.join(home, ".config", "opencode", "opencode.json");
        if (!exists(p)) return { ok: false, message: `Only opencode.jsonc found — edit manually:\n${openCodeSnippet()}` };
        const cfg = readJson(p) || {};
        cfg.mcp = cfg.mcp || {};
        cfg.mcp.truesearch = { type: "local", command: ["node", MCP_PATH], enabled: true };
        fs.writeFileSync(p, JSON.stringify(cfg, null, 2));
        return { ok: true, message: `${h.name}: installed → ${p}` };
      }
      case "hermes": {
        const p = h.detail;
        if (!appendYamlBlock(p)) return { ok: false, message: `${h.name}: config already has mcp_servers — merge manually:\n${yamlSnippet()}` };
        return { ok: true, message: `${h.name}: installed → ${p}\nRun \`/reload-mcp\` in Hermes.` };
      }
      case "continue": {
        const p = h.detail;
        if (!appendYamlBlock(p)) return { ok: false, message: `${h.name}: config already has mcp_servers — merge manually:\n${yamlSnippet()}` };
        return { ok: true, message: `${h.name}: installed → ${p}\nRestart Continue to load it.` };
      }
      case "goose": {
        const p = h.detail;
        if (!appendYamlBlock(p)) return { ok: false, message: `${h.name}: config already has mcp_servers — merge manually:\n${yamlSnippet()}` };
        return { ok: true, message: `${h.name}: installed → ${p}` };
      }
      case "cline": {
        mergeJsonMcpServers(h.detail);
        return { ok: true, message: `${h.name}: installed → ${h.detail}\nReload the VS Code window.` };
      }
      case "cursor": {
        const p = path.join(home, ".cursor", "mcp.json");
        mergeJsonMcpServers(p);
        return { ok: true, message: `${h.name}: installed → ${p}\nRestart Cursor to load it.` };
      }
      case "windsurf": {
        const p = path.join(home, ".codeium", "windsurf", "mcp_config.json");
        mergeJsonMcpServers(p);
        return { ok: true, message: `${h.name}: installed → ${p}` };
      }
      case "zed": {
        const p = h.detail;
        const cfg = readJson(p) || {};
        cfg.context_servers = cfg.context_servers || {};
        cfg.context_servers.truesearch = { command: "node", args: [MCP_PATH] };
        fs.writeFileSync(p, JSON.stringify(cfg, null, 2));
        return { ok: true, message: `${h.name}: installed → ${p}\nRestart Zed to load it.` };
      }
      default:
        return { ok: false, message: snippetFor(id) };
    }
  } catch (e: any) {
    return { ok: false, message: `Install failed: ${e.message}\n\nManual snippet:\n${snippetFor(id)}` };
  }
}

export function uninstallHarness(id: string): InstallResult {
  const h = detectHarnesses().find((x) => x.id === id);
  if (!h) return { ok: false, message: `Unknown harness: ${id}` };
  if (!h.installed) return { ok: true, message: `${h.name}: not installed` };

  try {
    switch (id) {
      case "claude-desktop":
        return removeJsonEntry(path.join(appData, "Claude", "claude_desktop_config.json"), "mcpServers", "truesearch")
          ? { ok: true, message: `${h.name}: uninstalled. Restart Claude Desktop.` }
          : { ok: false, message: `${h.name}: could not remove entry` };
      case "claude-code":
        return removeJsonEntry(path.join(home, ".claude.json"), "mcpServers", "truesearch")
          ? { ok: true, message: `${h.name}: uninstalled.` }
          : { ok: false, message: `${h.name}: could not remove entry` };
      case "opencode": {
        const p = path.join(home, ".config", "opencode", "opencode.json");
        return removeJsonEntry(p, "mcp", "truesearch")
          ? { ok: true, message: `${h.name}: uninstalled → ${p}` }
          : { ok: false, message: `${h.name}: could not remove entry` };
      }
      case "zed":
        return removeJsonEntry(h.detail, "context_servers", "truesearch")
          ? { ok: true, message: `${h.name}: uninstalled. Restart Zed.` }
          : { ok: false, message: `${h.name}: could not remove entry` };
      case "cline":
      case "cursor":
      case "windsurf": {
        const p = id === "cline" ? h.detail : id === "cursor"
          ? path.join(home, ".cursor", "mcp.json")
          : path.join(home, ".codeium", "windsurf", "mcp_config.json");
        return removeJsonEntry(p, "mcpServers", "truesearch")
          ? { ok: true, message: `${h.name}: uninstalled → ${p}` }
          : { ok: false, message: `${h.name}: could not remove entry` };
      }
      case "hermes":
      case "goose":
      case "continue":
        return removeYamlTruesearch(h.detail)
          ? { ok: true, message: `${h.name}: uninstalled → ${h.detail}` }
          : { ok: false, message: `${h.name}: could not remove automatically — delete the truesearch block under mcp_servers in ${h.detail}` };
      default:
        return { ok: false, message: `Unknown harness: ${id}` };
    }
  } catch (e: any) {
    return { ok: false, message: `Uninstall failed: ${e.message}` };
  }
}

function snippetFor(id: string): string {
  switch (id) {
    case "opencode": return openCodeSnippet();
    case "hermes":
    case "goose":
    case "continue": return yamlSnippet();
    case "zed": return zedSnippet();
    default: return jsonSnippet();
  }
}

export function detectedSummary(list: Harness[]): string {
  const found = list.filter((h) => h.detected);
  const inst = list.filter((h) => h.installed);
  return `${found.length}/${list.length} detected · ${inst.length} installed`;
}
