#!/usr/bin/env node
import * as readline from "readline";
import { getChromeCookies } from "./cookies/chrome.js";
import { getFirefoxCookies } from "./cookies/firefox.js";
import { saveCookies, loadCookies } from "./cookies/stored.js";
import { searchGoogle } from "./search.js";
import { searchYouTube, scrapeYouTubeVideo, getYouTubeComments } from "./youtube.js";
import { showConfig, setProxy, installToClaude, uninstallFromClaude, healthCheck } from "./cfg.js";
import type { Cookie } from "./types.js";

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

async function getCookies(browser: string): Promise<Cookie[]> {
  if (browser === "chrome") return await getChromeCookies(".google.com");
  if (browser === "firefox") return getFirefoxCookies(".google.com");
  const c = loadCookies();
  if (!c.length) throw new Error("No stored cookies. Run: cookies save firefox");
  return c;
}

const HELP = `
Commands:
  search <query>              Search Google (uses stored cookies by default)
  search <query> --firefox    Search using Firefox cookies
  yt <query>                  Search YouTube
  yt --firefox <query>        Search YouTube with Firefox cookies
  video <url|id>              Scrape YouTube video details
  comments <url|id>           Get YouTube video comments
  cookies list                Show stored cookies
  cookies set <file.json>     Upload cookies from file
  cookies save firefox        Save Firefox cookies to storage
  cookies save chrome         Save Chrome cookies to storage
  cookies get firefox         Show Firefox cookies as JSON
  cookies get chrome          Show Chrome cookies as JSON
  config                      Show configuration
  config proxy auto|off|URL   Set proxy mode
  config install [target]     Add MCP to Claude (desktop|code|both)
  config uninstall            Remove MCP from Claude
  config health               Run health check
  help                        Show this help
  exit                        Quit
`;

function prompt() {
  rl.question("\n> ", async (line) => {
    const input = line.trim();
    if (!input) return prompt();
    if (input === "exit" || input === "quit") return rl.close();
    if (input === "help") {
      console.log(HELP);
      return prompt();
    }
    try {
      await handle(input);
    } catch (e: any) {
      console.error(`Error: ${e.message}`);
    }
    prompt();
  });
}

async function handle(input: string) {
  const [cmd, ...rest] = input.split(/\s+/);

  if (cmd === "search") {
    const flags = rest.filter((a) => a.startsWith("--"));
    const query = rest.filter((a) => !a.startsWith("--")).join(" ");
    if (!query) throw new Error("Usage: search <query> [--firefox|--chrome]");

    let browser = "stored";
    if (flags.includes("--firefox")) browser = "firefox";
    if (flags.includes("--chrome")) browser = "chrome";

    let cookies;
    if (browser === "stored") {
      cookies = loadCookies();
      if (!cookies.length) throw new Error("No stored cookies. Run: cookies save firefox");
    } else if (browser === "chrome") {
      cookies = await getChromeCookies(".google.com");
    } else {
      cookies = getFirefoxCookies(".google.com");
    }

    console.log(`Searching with ${browser} cookies...`);
    const results = await searchGoogle(query, cookies, 10);
    if (!results.length) return console.log("No results found.");

    results.forEach((r, i) => {
      console.log(`\n${i + 1}. ${r.title}`);
      console.log(`   ${r.url}`);
      if (r.snippet) console.log(`   ${r.snippet}`);
    });
    return;
  }

  if (cmd === "yt") {
    const flags = rest.filter((a) => a.startsWith("--"));
    const query = rest.filter((a) => !a.startsWith("--")).join(" ");
    if (!query) throw new Error("Usage: yt <query> [--firefox|--chrome]");

    let browser = "stored";
    if (flags.includes("--firefox")) browser = "firefox";
    if (flags.includes("--chrome")) browser = "chrome";

    const cookies = await getCookies(browser);
    console.log(`Searching YouTube (${browser})...`);
    const results = await searchYouTube(query, cookies, 10);
    if (!results.length) return console.log("No results found.");

    results.forEach((r, i) => {
      console.log(`\n${i + 1}. ${r.title}`);
      console.log(`   ${r.url}`);
      console.log(`   ${r.channel} | ${r.views} | ${r.duration}`);
      if (r.description) console.log(`   ${r.description}`);
    });
    return;
  }

  if (cmd === "video") {
    const url = rest[0];
    if (!url) throw new Error("Usage: video <url|id>");
    let browser = "stored";
    if (rest.includes("--firefox")) browser = "firefox";
    if (rest.includes("--chrome")) browser = "chrome";
    const cookies = await getCookies(browser);
    const video = await scrapeYouTubeVideo(url, cookies);
    console.log(JSON.stringify(video, null, 2));
    return;
  }

  if (cmd === "comments") {
    const url = rest.find((a) => !a.startsWith("--"));
    if (!url) throw new Error("Usage: comments <url|id>");
    let browser = "stored";
    if (rest.includes("--firefox")) browser = "firefox";
    if (rest.includes("--chrome")) browser = "chrome";
    const cookies = await getCookies(browser);
    const comments = await getYouTubeComments(url, cookies, 20);
    if (!comments.length) return console.log("No comments found.");
    comments.forEach((c, i) => {
      console.log(`\n${i + 1}. ${c.author} (${c.likes} likes, ${c.published})`);
      console.log(`   ${c.text}`);
    });
    return;
  }

  if (cmd === "cookies") {
    const sub = rest[0];

    if (sub === "list") {
      const cookies = loadCookies();
      console.log(`${cookies.length} stored cookies:`);
      cookies.forEach((c) => console.log(`  ${c.name} (${c.domain})`));
      return;
    }

    if (sub === "set") {
      const file = rest[1];
      if (!file) throw new Error("Usage: cookies set <file.json>");
      const fs = await import("fs");
      const cookies = JSON.parse(fs.readFileSync(file, "utf-8"));
      if (!Array.isArray(cookies)) throw new Error("Expected a JSON array");
      const n = saveCookies(cookies);
      console.log(`Saved ${n} cookies.`);
      return;
    }

    if (sub === "save") {
      const which = rest[1];
      if (which === "firefox") {
        const c = getFirefoxCookies(".google.com");
        console.log(`Saved ${saveCookies(c)} Firefox cookies.`);
      } else if (which === "chrome") {
        const c = await getChromeCookies(".google.com");
        console.log(`Saved ${saveCookies(c)} Chrome cookies.`);
      } else {
        throw new Error("Usage: cookies save <firefox|chrome>");
      }
      return;
    }

    if (sub === "get") {
      const which = rest[1];
      if (which === "firefox") {
        console.log(JSON.stringify(getFirefoxCookies(".google.com"), null, 2));
      } else if (which === "chrome") {
        console.log(JSON.stringify(await getChromeCookies(".google.com"), null, 2));
      } else {
        throw new Error("Usage: cookies get <firefox|chrome>");
      }
      return;
    }

    throw new Error("Usage: cookies <list|set|save|get>");
  }

  if (cmd === "config") {
    const sub = rest[0] || "show";
    if (sub === "show") {
      showConfig().forEach((l) => console.log(l));
      return;
    }
    if (sub === "proxy") {
      const mode = rest[1];
      if (!mode) throw new Error("Usage: config proxy auto|off|http://host:port");
      console.log(setProxy(mode));
      return;
    }
    if (sub === "install") {
      const target = (rest[1] as "desktop" | "code" | "both") || "both";
      const files = installToClaude(target);
      console.log(`Installed to ${files.length} config(s):`);
      files.forEach((f) => console.log(`  ${f}`));
      console.log("Restart Claude to load the MCP.");
      return;
    }
    if (sub === "uninstall") {
      const target = (rest[1] as "all" | "desktop" | "code") || "all";
      const files = uninstallFromClaude(target);
      if (!files.length) console.log("Not installed anywhere.");
      else {
        console.log("Removed from:");
        files.forEach((f) => console.log(`  ${f}`));
      }
      return;
    }
    if (sub === "health") {
      (await healthCheck()).forEach((l) => console.log(l));
      return;
    }
    throw new Error("Usage: config <show|proxy|install|uninstall|health>");
  }

  throw new Error(`Unknown command: ${cmd}. Type "help" for commands.`);
}

console.log("TrueSearchMCP — type \"help\" for commands, \"exit\" to quit");
prompt();

rl.on("close", () => {
  console.log("\nBye!");
  process.exit(0);
});
