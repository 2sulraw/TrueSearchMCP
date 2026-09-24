import { ProxyAgent, fetch as undiciFetch } from "undici";
import { execSync } from "child_process";
import { loadConfig } from "./config.js";

let cachedKey: string | undefined;
let cachedAgent: ProxyAgent | null = null;

function systemProxy(): string | null {
  try {
    const out = execSync(
      `powershell -NoProfile -Command "(Get-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings').ProxyServer"`,
      { encoding: "utf-8", timeout: 3000 }
    ).trim();
    if (out && out.includes(":")) return out.startsWith("http") ? out : `http://${out}`;
  } catch { /* no proxy */ }
  return null;
}

export function activeProxyUrl(): string | null {
  const mode = loadConfig().proxy;
  if (mode === "off") return null;
  if (mode === "auto") return systemProxy();
  return mode; // explicit URL
}

function agent(): ProxyAgent | null {
  const url = activeProxyUrl();
  const key = url || "";
  if (cachedKey !== key) {
    cachedKey = key;
    cachedAgent = url ? new ProxyAgent(url) : null;
  }
  return cachedAgent;
}

export function fetchWithProxy(url: string, init?: any): Promise<Response> {
  const a = agent();
  if (a) return undiciFetch(url, { ...init, dispatcher: a } as any) as Promise<Response>;
  return fetch(url, init);
}
