#!/usr/bin/env node
import * as readline from "readline";
import { emitKeypressEvents } from "readline";
import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { getChromeCookies } from "./cookies/chrome.js";
import { getFirefoxCookies } from "./cookies/firefox.js";
import { saveCookies, loadCookies } from "./cookies/stored.js";
import { searchGoogle } from "./search.js";
import { searchYouTube, scrapeYouTubeVideo, getYouTubeComments } from "./youtube.js";
import { showConfig, setProxy, healthCheck, MCP_PATH, HEALTH_PORT, isMcpRunning, claudeInstallStatus } from "./cfg.js";
import { detectHarnesses, installHarness, uninstallHarness, detectedSummary } from "./harness.js";
import { maybeStartCheck, getUpdateBadge } from "./updatecheck.js";
import { activeProxyUrl } from "./proxy.js";
import type { Cookie } from "./types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── colors (disabled when NO_COLOR or not TTY) ──
const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const c = {
  reset: useColor ? "\x1b[0m" : "",
  bold: useColor ? "\x1b[1m" : "",
  dim: useColor ? "\x1b[2m" : "",
  cyan: useColor ? "\x1b[36m" : "",
  green: useColor ? "\x1b[32m" : "",
  yellow: useColor ? "\x1b[33m" : "",
  red: useColor ? "\x1b[31m" : "",
  blue: useColor ? "\x1b[34m" : "",
  magenta: useColor ? "\x1b[35m" : "",
  bgBlue: useColor ? "\x1b[44m" : "",
  bgGray: useColor ? "\x1b[100m" : "",
  white: useColor ? "\x1b[37m" : "",
};

emitKeypressEvents(process.stdin);
if (process.stdin.isTTY) process.stdin.setRawMode(true);

// Fresh readline per question — a persistent Interface buffers menu keystrokes
// ("8","0") and dumps them into the next ask() answer.
function ask(q: string): Promise<string> {
  return new Promise((res) => {
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(q, (ans) => {
      rl.close();
      // readline.close() pauses stdin — without resume, keypress (menu input) dies
      process.stdin.resume();
      if (process.stdin.isTTY) process.stdin.setRawMode(true);
      res(ans);
    });
  });
}

interface MenuItem {
  label: string;
  key?: string;        // "back" marks the Back item
  action: () => Promise<void> | void;
  danger?: boolean;
  opensMenu?: boolean; // submenu: no "Press Enter" after it returns
}

type MenuResult =
  | { type: "select"; index: number }
  | { type: "back" }
  | { type: "exit" };

// Status line is expensive (PowerShell ~2s). Cache it; invalidate when state changes.
let statusCache: string | null = null;

function invalidateStatus(): void {
  statusCache = null;
}

function buildStatusLine(): string {
  if (statusCache) return statusCache;
  const mcp = isMcpRunning();
  const status = mcp.running
    ? `${c.green}● MCP running${c.reset}${c.dim} (pid ${mcp.pid})${c.reset}`
    : `${c.red}● MCP stopped${c.reset}`;
  const proxy = activeProxyUrl();
  const proxyStr = proxy
    ? `${c.yellow}◈ proxy${c.reset}${c.dim} ${proxy}${c.reset}`
    : `${c.dim}◈ no proxy${c.reset}`;
  statusCache = `  ${status}   ${proxyStr}   ${c.dim}cookies ${loadCookies().length}${c.reset}`;
  return statusCache;
}

async function selectMenu(title: string, subtitle: string | null, items: MenuItem[]): Promise<MenuResult> {
  let sel = 0;
  const hint = `${c.dim}↑↓/j/k move  •  enter select  •  1-9,0 hotkey  •  esc back${c.reset}`;
  const statusLine = buildStatusLine(); // once per menu open (cached)
  // Fresh harness detection every time a menu screen opens (fs-only, cheap)
  const hs = detectHarnesses();
  const harnessPart = `   ${c.dim}· harnesses ${hs.filter((h) => h.detected).length}/${hs.length}${c.reset}`;

  return new Promise((resolve) => {
    let menuAlive = true;

    const render = () => {
      if (!menuAlive) return;
      const lines: string[] = [];
      lines.push("");
      lines.push(`  ${c.cyan}${c.bold}┌──────────────────────────────────────────────┐${c.reset}`);
      lines.push(`  ${c.cyan}${c.bold}│${c.reset}  ${c.bold}${c.white}${title.padEnd(42)}${c.reset}  ${c.cyan}${c.bold}│${c.reset}`);
      lines.push(`  ${c.cyan}${c.bold}└──────────────────────────────────────────────┘${c.reset}`);
      if (subtitle) lines.push(`  ${c.dim}${subtitle}${c.reset}`);
      lines.push("");
      items.forEach((it, i) => {
        const num = i + 1;
        const marker = it.danger ? c.red : c.green;
        const isActive = i === sel;
        const prefix = isActive
          ? `  ${marker}❯ ${c.reset}`
          : `    ${c.dim} ${c.reset}`;
        const numStr = isActive
          ? `${c.bold}${marker}${num}${c.reset}`
          : `${c.dim}${num}${c.reset}`;
        const label = isActive
          ? `${c.bold}${c.white}${it.label}${c.reset}`
          : `${c.reset}${it.label}`;
        lines.push(`${prefix}${numStr}. ${label}`);
      });
      lines.push("");
      lines.push(statusLine + harnessPart);
      const badge = getUpdateBadge();
      if (badge) lines.push(`  ${badge}`);
      lines.push(`  ${hint}`);
      process.stdout.write("\x1b[2J\x1b[H" + lines.join("\n") + "\n");
    };

    const cleanup = () => {
      menuAlive = false;
      process.stdin.off("keypress", onKey);
    };

    const choose = (index: number) => {
      cleanup();
      resolve({ type: "select", index });
    };

    const onKey = (str: string | undefined, key: readline.Key) => {
      if (!key) return;
      if (key.name === "up" || key.name === "k") {
        sel = (sel - 1 + items.length) % items.length;
        render();
      } else if (key.name === "down" || key.name === "j") {
        sel = (sel + 1) % items.length;
        render();
      } else if (key.name === "return") {
        choose(sel);
      } else if (key.name === "escape") {
        cleanup();
        const hasBack = items.some((i) => i.key === "back");
        resolve(hasBack ? { type: "back" } : { type: "exit" });
      } else if (str === "q" && !items.some((i) => i.key === "q")) {
        cleanup();
        const hasBack = items.some((i) => i.key === "back");
        resolve(hasBack ? { type: "back" } : { type: "exit" });
      } else if (/^[0-9]$/.test(str || "")) {
        // "0" = hotkey for the 10th item (index 9)
        const idx = str === "0" ? 9 : parseInt(str!, 10) - 1;
        if (idx >= 0 && idx < items.length) choose(idx);
      }
    };

    process.stdin.resume(); // ensure flowing after any prior ask() closed a readline
    process.stdin.on("keypress", onKey);
    // Live update check: fires in background on menu open; re-renders badge when done
    maybeStartCheck(() => {
      if (menuAlive) render();
    });
    render();
  });
}

async function runMenu(
  title: string,
  subtitle: string | null,
  items: MenuItem[],
  isRoot = false
): Promise<void> {
  for (;;) {
    const result = await selectMenu(title, subtitle, items);
    if (result.type === "exit") {
      if (isRoot) bye();
      return;
    }
    if (result.type === "back") {
      if (isRoot) bye();
      return;
    }
    const it = items[result.index];
    if (it.key === "back") return;
    try {
      await it.action();
    } catch (e: any) {
      console.log(`\n  ${c.red}Error:${c.reset} ${e.message}`);
    }
    if (it.opensMenu) continue; // submenu handled its own pause/loop
    await ask("\n  Press Enter to continue...");
  }
}

function bye() {
  console.log(`\n  ${c.cyan}Goodbye!${c.reset}\n`);
  if (process.stdin.isTTY) process.stdin.setRawMode(false);
  process.exit(0);
}

// ── actions ──

async function toggleMcp() {
  invalidateStatus();
  const h = isMcpRunning();
  if (h.running) {
    console.log(`\n  ${c.yellow}Stopping MCP${c.reset} (pid ${h.pid})...`);
    try {
      execSync(`powershell -NoProfile -Command "Stop-Process -Id ${h.pid} -Force"`, { timeout: 5000 });
      console.log(`  ${c.green}Stopped.${c.reset}`);
    } catch { console.log(`  ${c.red}Failed to stop.${c.reset}`); }
    return;
  }
  console.log(`\n  ${c.yellow}Starting MCP server...${c.reset}`);
  try {
    execSync(
      `powershell -NoProfile -Command "Start-Process -FilePath 'node' -ArgumentList '${MCP_PATH}' -WindowStyle Hidden"`,
      { timeout: 5000 }
    );
  } catch (e: any) { console.log(`  ${c.red}Failed:${c.reset} ${e.message}`); return; }
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 250));
    const h2 = isMcpRunning();
    if (h2.running) { console.log(`  ${c.green}MCP RUNNING${c.reset} (pid ${h2.pid}, port ${HEALTH_PORT})`); return; }
  }
  console.log(`  ${c.yellow}WARNING:${c.reset} MCP did not respond. Check mcp.log`);
}

async function askCookieSource(): Promise<{ cookies: Cookie[]; label: string }> {
  console.log(`\n  ${c.dim}Cookie source:${c.reset}`);
  console.log(`    ${c.green}1${c.reset}. Stored (${loadCookies().length} cookies)  ${c.green}2${c.reset}. Firefox  ${c.green}3${c.reset}. Chrome`);
  const src = (await ask(`  Choice [1] > `)).trim() || "1";
  if (src === "2") return { cookies: getFirefoxCookies(".google.com"), label: "firefox" };
  if (src === "3") return { cookies: await getChromeCookies(".google.com"), label: "chrome" };
  const cookies = loadCookies();
  if (!cookies.length) throw new Error("No stored cookies. Save Firefox cookies first (Cookies menu).");
  return { cookies, label: "stored" };
}

async function doSearchGoogle() {
  const query = (await ask(`\n  ${c.cyan}Google search>${c.reset} `)).trim();
  if (!query) return;
  const { cookies, label } = await askCookieSource();
  console.log(`\n  ${c.yellow}Searching...${c.reset} (${label})`);
  const results = await searchGoogle(query, cookies, 10);
  if (!results.length) return console.log(`  ${c.dim}No results.${c.reset}`);
  results.forEach((r, i) => {
    console.log(`\n  ${c.bold}${i + 1}.${c.reset} ${r.title}`);
    console.log(`     ${c.cyan}${r.url}${c.reset}`);
    if (r.snippet) console.log(`     ${c.dim}${r.snippet}${c.reset}`);
  });
}

async function doSearchYouTube() {
  const query = (await ask(`\n  ${c.cyan}YouTube search>${c.reset} `)).trim();
  if (!query) return;
  const { cookies, label } = await askCookieSource();
  console.log(`\n  ${c.yellow}Searching YouTube...${c.reset} (${label})`);
  const results = await searchYouTube(query, cookies, 10);
  if (!results.length) return console.log(`  ${c.dim}No results.${c.reset}`);
  results.forEach((r, i) => {
    console.log(`\n  ${c.bold}${i + 1}.${c.reset} ${r.title}`);
    console.log(`     ${c.cyan}${r.url}${c.reset}`);
    console.log(`     ${c.dim}${r.channel} │ ${r.views} │ ${r.duration}${c.reset}`);
    if (r.description) console.log(`     ${c.dim}${r.description}${c.reset}`);
  });
}

async function doScrapeVideo() {
  const url = (await ask(`\n  ${c.cyan}Video URL or ID>${c.reset} `)).trim();
  if (!url) return;
  const { cookies, label } = await askCookieSource();
  console.log(`\n  ${c.yellow}Scraping video...${c.reset} (${label})`);
  const v = await scrapeYouTubeVideo(url, cookies);
  console.log(`\n  ${c.bold}Title:${c.reset}     ${v.title}`);
  console.log(`  ${c.bold}Channel:${c.reset}   ${v.channel}`);
  console.log(`  ${c.bold}Views:${c.reset}     ${v.views}`);
  console.log(`  ${c.bold}Likes:${c.reset}     ${v.likes || "N/A"}`);
  console.log(`  ${c.bold}Duration:${c.reset}  ${v.duration}`);
  console.log(`  ${c.bold}Published:${c.reset} ${v.published || "N/A"}`);
  console.log(`  ${c.bold}Category:${c.reset}  ${v.category || "N/A"}`);
  if (v.tags.length) console.log(`  ${c.bold}Tags:${c.reset}      ${v.tags.slice(0, 10).join(", ")}`);
  console.log(`\n  ${c.bold}Description:${c.reset}\n  ${v.description.substring(0, 500)}${v.description.length > 500 ? "..." : ""}`);

  console.log(`\n  ${c.yellow}Fetching comments...${c.reset}`);
  try {
    const comments = await getYouTubeComments(url, cookies, 10);
    if (!comments.length) return console.log(`  ${c.dim}No comments found.${c.reset}`);
    console.log(`\n  ${c.bold}Top ${comments.length} comments:${c.reset}`);
    comments.forEach((cm, i) => {
      console.log(`\n  ${c.green}${i + 1}.${c.reset} ${cm.author} ${c.dim}(${cm.likes} likes, ${cm.published})${c.reset}`);
      console.log(`     ${cm.text.substring(0, 200)}${cm.text.length > 200 ? "..." : ""}`);
    });
  } catch (e: any) {
    console.log(`  ${c.red}Comments failed:${c.reset} ${e.message}`);
  }
}

async function cookiesSubmenu() {
  await runMenu("Cookie Management", `Stored: ${loadCookies().length} cookies`, [
    { label: "List stored cookies", action: async () => {
      const cookies = loadCookies();
      console.log(`\n  ${c.bold}${cookies.length} stored cookies:${c.reset}`);
      cookies.forEach((ck) => console.log(`    ${ck.name} ${c.dim}(${ck.domain})${c.reset}`));
    }},
    { label: "Save Firefox cookies → storage", action: async () => {
      invalidateStatus();
      const n = saveCookies(getFirefoxCookies(".google.com"));
      console.log(`\n  ${c.green}Saved ${n} Firefox cookies.${c.reset}`);
    }},
    { label: "Save Chrome cookies → storage", action: async () => {
      invalidateStatus();
      const n = saveCookies(await getChromeCookies(".google.com"));
      console.log(`\n  ${c.green}Saved ${n} Chrome cookies.${c.reset}`);
    }},
    { label: "Upload cookies from JSON file", action: async () => {
      const file = (await ask(`  JSON file path > `)).trim();
      if (!file) return;
      const cookies = JSON.parse(fs.readFileSync(file, "utf-8"));
      if (!Array.isArray(cookies)) throw new Error("Expected a JSON array");
      invalidateStatus();
      console.log(`\n  ${c.green}Saved ${saveCookies(cookies)} cookies.${c.reset}`);
    }},
    { label: "Show Firefox cookies as JSON", action: async () => {
      console.log(JSON.stringify(getFirefoxCookies(".google.com"), null, 2));
    }},
    { label: "Show Chrome cookies as JSON", action: async () => {
      console.log(JSON.stringify(await getChromeCookies(".google.com"), null, 2));
    }},
    { label: "← Back", key: "back", action: async () => {} },
  ]);
}

async function configSubmenu() {
  await runMenu("Configuration", `Proxy: ${activeProxyUrl() || "off"} │ Claude: ${claudeLabel()}`, [
    { label: "Show full config", action: async () => {
      showConfig().forEach((l) => console.log("  " + l));
    }},
    { label: "Set proxy → auto (system)", action: async () => { invalidateStatus(); console.log(`  ${c.green}${setProxy("auto")}${c.reset}`); }},
    { label: "Set proxy → off (direct)", action: async () => { invalidateStatus(); console.log(`  ${c.green}${setProxy("off")}${c.reset}`); }},
    { label: "Set proxy → custom URL", action: async () => {
      const url = (await ask(`  Proxy URL ${c.dim}(http://host:port)${c.reset} > `)).trim();
      if (url) { invalidateStatus(); console.log(`  ${c.green}${setProxy(url)}${c.reset}`); }
    }},
    { label: "← Back", key: "back", action: async () => {} },
  ]);
}

function claudeLabel(): string {
  const s = claudeInstallStatus();
  if (s.desktop && s.code) return "both";
  if (s.desktop) return "desktop";
  if (s.code) return "code";
  return "none";
}

async function harnessSubmenu() {
  const list = detectHarnesses();
  const items: MenuItem[] = list.map((h) => ({
    label: h.installed
      ? `${h.name} ${c.green}✓ installed${c.reset} ${c.dim}(enter to remove)${c.reset}`
      : h.detected
        ? `${h.name} ${c.yellow}✓ detected${c.reset}`
        : `${h.name} ${c.dim}✗ not found${c.reset}`,
    danger: h.installed,
    action: async () => {
      // Re-detect so install/remove decision uses current state
      const fresh = detectHarnesses().find((x) => x.id === h.id) || h;
      if (fresh.installed) {
        const yes = (await ask(`  Remove truesearch from ${fresh.name}? [y/N] > `)).trim().toLowerCase();
        if (yes !== "y" && yes !== "yes") {
          console.log(`  ${c.dim}Cancelled.${c.reset}`);
          return;
        }
        const r = uninstallHarness(fresh.id);
        console.log(`\n  ${r.ok ? c.green + "OK" : c.yellow + "NOTE"}:${c.reset} ${r.message}`);
      } else {
        const r = installHarness(fresh.id);
        console.log(`\n  ${r.ok ? c.green + "OK" : c.yellow + "NOTE"}:${c.reset} ${r.message}`);
      }
    },
  }));
  items.push({ label: "← Back", key: "back", action: async () => {} });
  await runMenu(
    "Install on Harness",
    `Auto-detect: ${detectedSummary(list)} │ detected→install · installed→remove`,
    items
  );
}

async function doHealth() {
  console.log(`\n  ${c.bold}Health Check${c.reset}`);
  const lines = await healthCheck();
  lines.forEach((l) => console.log("  " + l));
  try {
    const ch = await getChromeCookies(".google.com");
    console.log(`  Chrome:         ${c.green}OK${c.reset} (${ch.length} google cookies)`);
  } catch (e: any) {
    const msg = e.message.includes("App-Bound")
      ? `${c.yellow}v20 encryption — needs --remote-debugging-port${c.reset}`
      : `${c.red}ERROR${c.reset} - ${e.message.substring(0, 50)}`;
    console.log(`  Chrome:         ${msg}`);
  }
}

function showHelp() {
  console.log(`
  ${c.bold}TrueSearchMCP — Controls${c.reset}

  ${c.green}↑ ↓${c.reset} / ${c.green}j k${c.reset}   Navigate menu
  ${c.green}Enter${c.reset}     Select highlighted item
  ${c.green}1-9,0${c.reset}    Jump directly to item (0 = 10th)
  ${c.green}Esc${c.reset}      Back / Exit
  ${c.green}q${c.reset}        Quit (on main menu)

  ${c.bold}Cookie sources:${c.reset}
    ${c.cyan}stored${c.reset}  cookies saved in Cookies menu
    ${c.cyan}firefox${c.reset} read live from Firefox (plaintext)
    ${c.cyan}chrome${c.reset}  read from Chrome (v20 needs debug port)`);
}

async function mainMenu() {
  const running = isMcpRunning().running;
  await runMenu("TrueSearchMCP  v1.0.0", "Browser-cookie powered Google & YouTube search — no API keys", [
    { label: running ? "Stop MCP Server" : "Start MCP Server", action: toggleMcp },
    { label: "Search Google", action: doSearchGoogle },
    { label: "Search YouTube", action: doSearchYouTube },
    { label: "Scrape YouTube Video (+ comments)", action: doScrapeVideo },
    { label: "Manage Cookies", opensMenu: true, action: async () => { await cookiesSubmenu(); } },
    { label: "Health Check", action: doHealth },
    { label: "Config (proxy / settings)", opensMenu: true, action: async () => { await configSubmenu(); } },
    { label: "Install on Harness", opensMenu: true, action: async () => { await harnessSubmenu(); } },
    { label: "Help", action: async () => { showHelp(); } },
    { label: "Exit", danger: true, action: async () => { bye(); } },
  ], true);
}

async function mainLoop() {
  await mainMenu();
}

console.log(`\n  ${c.cyan}${c.bold}TrueSearchMCP${c.reset} ${c.dim}starting...${c.reset}`);
mainLoop();

// handle ctrl+c cleanly
process.stdin.on("keypress", (_s, key) => {
  if (key && key.ctrl && key.name === "c") bye();
});
process.stdin.on("end", () => { if (process.stdin.isTTY) process.stdin.setRawMode(false); process.exit(0); });
