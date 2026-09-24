import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { execSync } from "child_process";
import { fileURLToPath } from "url";
import { loadConfig, saveConfig, CONFIG_PATH } from "./config.js";
import { activeProxyUrl, fetchWithProxy } from "./proxy.js";
import { loadCookies } from "./cookies/stored.js";
import { getFirefoxCookies } from "./cookies/firefox.js";
import { searchGoogle } from "./search.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const MCP_PATH = path.join(__dirname, "index.js");
export const HEALTH_PORT = 37820;

export function isMcpRunning(): { running: boolean; pid?: number } {
  try {
    const out = execSync(
      `powershell -NoProfile -Command "(Get-NetTCPConnection -LocalPort ${HEALTH_PORT} -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1).OwningProcess"`,
      { encoding: "utf-8", timeout: 3000 }
    ).trim();
    if (out) return { running: true, pid: parseInt(out) };
  } catch { /* not running */ }
  return { running: false };
}

function claudeDesktopConfigPath(): string {
  return path.join(process.env.APPDATA || "", "Claude", "claude_desktop_config.json");
}

function claudeCodeConfigPath(): string {
  return path.join(os.homedir(), ".claude.json");
}

function readJson(p: string): any {
  try { return JSON.parse(fs.readFileSync(p, "utf-8")); } catch { return null; }
}

function writeJson(p: string, data: any): void {
  fs.writeFileSync(p, JSON.stringify(data, null, 2));
}

export function claudeInstallStatus(): { desktop: boolean; code: boolean } {
  const entry = { command: "node", args: [MCP_PATH], type: "stdio" };
  const d = readJson(claudeDesktopConfigPath());
  const c = readJson(claudeCodeConfigPath());
  return {
    desktop: !!d?.mcpServers?.truesearch,
    code: !!c?.mcpServers?.truesearch,
  };
}

export function installToClaude(target: "desktop" | "code" | "both"): string[] {
  const entry = { command: "node", args: [MCP_PATH], type: "stdio" };
  const done: string[] = [];

  if (target === "desktop" || target === "both") {
    const p = claudeDesktopConfigPath();
    const cfg = readJson(p) || {};
    cfg.mcpServers = cfg.mcpServers || {};
    cfg.mcpServers.truesearch = entry;
    writeJson(p, cfg);
    done.push(p);
  }

  if (target === "code" || target === "both") {
    const p = claudeCodeConfigPath();
    const cfg = readJson(p) || {};
    cfg.mcpServers = cfg.mcpServers || {};
    cfg.mcpServers.truesearch = entry;
    writeJson(p, cfg);
    done.push(p);
  }

  return done;
}

export function uninstallFromClaude(target: "desktop" | "code" | "both" | "all"): string[] {
  const removed: string[] = [];

  if (target === "desktop" || target === "both" || target === "all") {
    const p = claudeDesktopConfigPath();
    const cfg = readJson(p);
    if (cfg?.mcpServers?.truesearch) {
      delete cfg.mcpServers.truesearch;
      writeJson(p, cfg);
      removed.push(p);
    }
  }

  if (target === "code" || target === "both" || target === "all") {
    const p = claudeCodeConfigPath();
    const cfg = readJson(p);
    if (cfg?.mcpServers?.truesearch) {
      delete cfg.mcpServers.truesearch;
      writeJson(p, cfg);
      removed.push(p);
    }
  }

  return removed;
}

export async function healthCheck(): Promise<string[]> {
  const lines: string[] = [];

  const mcp = isMcpRunning();
  lines.push(`MCP Server:     ${mcp.running ? `RUNNING (pid: ${mcp.pid}, port: ${HEALTH_PORT})` : "STOPPED"}`);

  lines.push(`Build files:    ${fs.existsSync(MCP_PATH) ? "OK" : "MISSING (run: npm run build)"}`);

  const cfg = loadConfig();
  const active = activeProxyUrl();
  lines.push(`Proxy mode:     ${cfg.proxy}`);
  lines.push(`Proxy active:   ${active || "none (direct)"}`);
  lines.push(`Config file:    ${fs.existsSync(CONFIG_PATH) ? CONFIG_PATH : "(defaults)"}`);

  const install = claudeInstallStatus();
  lines.push(`Claude Desktop: ${install.desktop ? "INSTALLED" : "not installed"}`);
  lines.push(`Claude Code:    ${install.code ? "INSTALLED" : "not installed"}`);

  const stored = loadCookies().length;
  lines.push(`Stored cookies: ${stored}`);

  try {
    const ff = getFirefoxCookies(".google.com");
    lines.push(`Firefox:        OK (${ff.length} google cookies)`);
  } catch (e: any) {
    lines.push(`Firefox:        ERROR - ${String(e.message).substring(0, 60)}`);
  }

  try {
    const cookies = stored > 0 ? loadCookies() : getFirefoxCookies(".google.com");
    const results = await searchGoogle("test connection", cookies, 1);
    lines.push(`Google search:  ${results.length > 0 ? "OK" : "No results"}`);
  } catch (e: any) {
    lines.push(`Google search:  ERROR - ${String(e.message).substring(0, 60)}`);
  }

  try {
    const resp = await fetchWithProxy("https://www.youtube.com", {
      headers: { "User-Agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(8000),
    });
    lines.push(`YouTube:        OK (HTTP ${resp.status})`);
  } catch (e: any) {
    lines.push(`YouTube:        FAIL - ${e.cause?.code || e.cause?.message || e.message}`);
  }

  return lines;
}

export function setProxy(mode: string): string {
  if (mode !== "off" && mode !== "auto" && !/^https?:\/\//.test(mode)) {
    throw new Error("Proxy must be 'auto', 'off', or a URL like http://host:port");
  }
  saveConfig({ proxy: mode });
  return `Proxy set to: ${mode}`;
}

export function showConfig(): string[] {
  const cfg = loadConfig();
  const active = activeProxyUrl();
  const install = claudeInstallStatus();
  return [
    `Proxy mode:      ${cfg.proxy}  (auto = system, off = direct, or http://host:port)`,
    `Proxy active:    ${active || "none (direct connection)"}`,
    `MCP path:        ${MCP_PATH}`,
    `Health port:     ${HEALTH_PORT}`,
    `Config file:     ${CONFIG_PATH}`,
    `Cookie file:     .cookies.json (${loadCookies().length} cookies)`,
    `Claude Desktop:  ${install.desktop ? "installed" : "not installed"}`,
    `Claude Code:     ${install.code ? "installed" : "not installed"}`,
    "",
    "Commands:",
    "  config show                    Show this config",
    "  config proxy auto|off|URL      Set proxy mode",
    "  config install [desktop|code|both]   Add MCP to Claude (default: both)",
    "  config uninstall [all|desktop|code]  Remove MCP from Claude (default: all)",
    "  config health                  Run full health check",
  ];
}
