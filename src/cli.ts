#!/usr/bin/env node
import { getChromeCookies } from "./cookies/chrome.js";
import { getFirefoxCookies } from "./cookies/firefox.js";
import { saveCookies, loadCookies } from "./cookies/stored.js";
import { searchGoogle } from "./search.js";
import { searchYouTube, scrapeYouTubeVideo, getYouTubeComments } from "./youtube.js";
import { showConfig, setProxy, installToClaude, uninstallFromClaude, healthCheck } from "./cfg.js";
import { detectHarnesses, installHarness, uninstallHarness, detectedSummary } from "./harness.js";
import type { Cookie } from "./types.js";

async function getCookies(browser: string, profile?: string): Promise<Cookie[]> {
  if (browser === "stored") {
    const c = loadCookies();
    if (!c.length) throw new Error("No stored cookies. Run: cookies set <file>");
    return c;
  }
  if (browser === "chrome") return await getChromeCookies(".google.com", profile);
  return getFirefoxCookies(".google.com", profile);
}

const [cmd, ...args] = process.argv.slice(2);

function getFlag(name: string): string | undefined {
  const idx = args.indexOf(`--${name}`);
  if (idx === -1 || !args[idx + 1]) return undefined;
  return args[idx + 1];
}

function getNum(name: string, def: number): number {
  const v = getFlag(name);
  return v ? parseInt(v, 10) || def : def;
}

async function main() {
  switch (cmd) {
    case "search": {
      const query = args.filter((a) => !a.startsWith("--")).join(" ");
      if (!query) throw new Error("Usage: search <query> [--browser chrome|firefox|stored] [--num 10]");
      const browser = getFlag("browser") || "firefox";
      const num = getNum("num", 10);

      let cookies;
      if (browser === "stored") {
        cookies = loadCookies();
        if (!cookies.length) throw new Error("No stored cookies. Run: cookies set <file.json>");
      } else if (browser === "chrome") {
        cookies = await getChromeCookies(".google.com", getFlag("profile"));
      } else {
        cookies = getFirefoxCookies(".google.com", getFlag("profile"));
      }

      const results = await searchGoogle(query, cookies, num);
      if (results.length === 0) {
        console.log("No results found.");
        return;
      }
      results.forEach((r, i) => {
        console.log(`${i + 1}. ${r.title}`);
        console.log(`   ${r.url}`);
        if (r.snippet) console.log(`   ${r.snippet}`);
        console.log();
      });
      break;
    }

    case "yt": {
      const sub = args[0];
      const browser = getFlag("browser") || "firefox";
      if (sub === "search") {
        const query = args.slice(1).filter((a) => !a.startsWith("--")).join(" ");
        if (!query) throw new Error("Usage: yt search <query> [--browser ...] [--num 10]");
        const cookies = await getCookies(browser);
        const results = await searchYouTube(query, cookies, getNum("num", 10));
        results.forEach((r, i) => {
          console.log(`${i + 1}. ${r.title}`);
          console.log(`   ${r.url}`);
          console.log(`   ${r.channel} | ${r.views} | ${r.duration}`);
          if (r.description) console.log(`   ${r.description}`);
          console.log();
        });
      } else if (sub === "video") {
        const url = args[1];
        if (!url) throw new Error("Usage: yt video <url|id> [--browser ...]");
        const cookies = await getCookies(browser);
        const video = await scrapeYouTubeVideo(url, cookies);
        console.log(JSON.stringify(video, null, 2));
      } else if (sub === "comments") {
        const url = args[1];
        if (!url) throw new Error("Usage: yt comments <url|id> [--browser ...] [--num 20]");
        const cookies = await getCookies(browser);
        const comments = await getYouTubeComments(url, cookies, getNum("num", 20));
        comments.forEach((c, i) => {
          console.log(`${i + 1}. ${c.author} (${c.likes} likes, ${c.published})`);
          console.log(`   ${c.text}`);
          console.log();
        });
      } else {
        throw new Error("Usage: yt <search|video|comments> <args>");
      }
      break;
    }

    case "cookies": {
      const sub = args[0];
      if (sub === "set") {
        // Read JSON array from file arg or stdin
        const file = args[1];
        let raw: string;
        if (file && file !== "-") {
          raw = await import("fs").then((fs) => fs.readFileSync(file, "utf-8"));
        } else {
          raw = await new Promise<string>((res) => {
            let d = "";
            process.stdin.on("data", (c) => (d += c));
            process.stdin.on("end", () => res(d));
          });
        }
        const cookies = JSON.parse(raw);
        if (!Array.isArray(cookies)) throw new Error("Expected a JSON array of cookies");
        const n = saveCookies(cookies);
        console.log(`Saved ${n} cookies.`);
      } else if (sub === "list") {
        const cookies = loadCookies();
        console.log(`${cookies.length} stored cookies:`);
        cookies.forEach((c) => console.log(`  ${c.name} (${c.domain})`));
      } else if (sub === "firefox") {
        const domain = args[1] || ".google.com";
        const cookies = getFirefoxCookies(domain.startsWith(".") ? domain : `.${domain}`);
        console.log(JSON.stringify(cookies, null, 2));
      } else if (sub === "chrome") {
        const domain = args[1] || ".google.com";
        const cookies = await getChromeCookies(domain.startsWith(".") ? domain : `.${domain}`);
        console.log(JSON.stringify(cookies, null, 2));
      } else {
        throw new Error("Usage: cookies <set|list|firefox|chrome> [args]");
      }
      break;
    }

    case "config": {
      const sub = args[0] || "show";
      if (sub === "show") {
        showConfig().forEach((l) => console.log(l));
      } else if (sub === "proxy") {
        const mode = args[1];
        if (!mode) throw new Error("Usage: config proxy auto|off|http://host:port");
        console.log(setProxy(mode));
      } else if (sub === "install") {
        const target = (args[1] as "desktop" | "code" | "both") || "both";
        const files = installToClaude(target);
        console.log(`Installed to ${files.length} config(s):`);
        files.forEach((f) => console.log(`  ${f}`));
        console.log("Restart Claude to load the MCP.");
      } else if (sub === "uninstall") {
        const target = (args[1] as "all" | "desktop" | "code") || "all";
        const files = uninstallFromClaude(target);
        if (files.length === 0) console.log("Not installed anywhere.");
        else {
          console.log(`Removed from:`);
          files.forEach((f) => console.log(`  ${f}`));
        }
      } else if (sub === "health") {
        (await healthCheck()).forEach((l) => console.log(l));
      } else {
        throw new Error("Usage: config <show|proxy|install|uninstall|health>");
      }
      break;
    }

    case "harness": {
      const sub = args[0] || "list";
      if (sub === "list") {
        const list = detectHarnesses();
        console.log(`Detected: ${detectedSummary(list)}`);
        console.log("");
        list.forEach((h, i) => {
          const mark = h.installed ? "[installed]" : h.detected ? "[detected]" : "[not found]";
          console.log(`${String(i + 1).padStart(2)}. ${h.name.padEnd(20)} ${mark}`);
          console.log(`     ${h.detail}`);
        });
        console.log("");
        console.log("Install:   harness install <id>   e.g. harness install opencode");
        console.log("Uninstall: harness uninstall <id> e.g. harness uninstall continue");
        console.log("IDs: " + list.map((h) => h.id).join(", "));
      } else if (sub === "install") {
        const id = args[1];
        if (!id) throw new Error("Usage: harness install <id>  (see: harness list)");
        const r = installHarness(id);
        console.log(r.message);
        if (!r.ok) process.exitCode = 1;
      } else if (sub === "uninstall") {
        const id = args[1];
        if (!id) throw new Error("Usage: harness uninstall <id>  (see: harness list)");
        const r = uninstallHarness(id);
        console.log(r.message);
        if (!r.ok) process.exitCode = 1;
      } else {
        throw new Error("Usage: harness <list|install <id>|uninstall <id>>");
      }
      break;
    }

    default:
      console.log(`TrueSearchMCP CLI

Usage:
  search <query> [--browser chrome|firefox|stored] [--num 10]
  yt search <query> [--browser ...] [--num 10]    Search YouTube
  yt video <url|id> [--browser ...]               Scrape video details
  yt comments <url|id> [--browser ...] [--num 20] Get video comments
  cookies set <file.json>     Upload cookies from a JSON file
  cookies list                Show stored cookies
  cookies firefox [domain]    Extract Firefox cookies
  cookies chrome [domain]     Extract Chrome cookies
  config show                 Show configuration
  config proxy auto|off|URL   Set proxy mode
  config install [target]     Add MCP to Claude (desktop|code|both)
  config uninstall [target]   Remove MCP from Claude
  config health               Run health check
  harness list                Auto-detect harnesses on this machine
  harness install <id>        Install MCP into a detected harness
  harness uninstall <id>      Remove MCP from a harness`);
  }
}

main().catch((e) => {
  console.error(`Error: ${e.message}`);
  process.exit(1);
});
