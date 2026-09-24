import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as net from "net";
import { z } from "zod";
import { getChromeCookies } from "./cookies/chrome.js";
import { getFirefoxCookies } from "./cookies/firefox.js";
import { saveCookies, loadCookies } from "./cookies/stored.js";
import { searchGoogle } from "./search.js";
import { searchYouTube, scrapeYouTubeVideo, getYouTubeComments } from "./youtube.js";
import type { Cookie } from "./types.js";

const HEALTH_PORT = 37820;

const server = new McpServer({
  name: "truesearch-mcp",
  version: "1.0.0",
});

const cookieSchema = z.array(
  z.object({
    name: z.string(),
    value: z.string(),
    domain: z.string().optional().default(""),
    path: z.string().optional().default("/"),
    expires: z.number().nullable().optional().default(null),
    httpOnly: z.boolean().optional().default(false),
    secure: z.boolean().optional().default(false),
    sameSite: z
      .enum(["none", "lax", "strict", "no_restriction"])
      .optional()
      .default("none"),
  })
);

server.tool(
  "search_google",
  "Search Google using browser cookies to avoid bot detection",
  {
    query: z.string().describe("The search query"),
    browser: z
      .enum(["chrome", "firefox", "stored"])
      .default("firefox")
      .describe("Cookie source: 'chrome', 'firefox', or 'stored' (uploaded via set_cookies)"),
    profile: z
      .string()
      .optional()
      .describe("Browser profile name (e.g. 'Profile 1', 'default-release')"),
    num_results: z
      .number()
      .min(1)
      .max(50)
      .default(10)
      .describe("Number of results to return"),
  },
  async ({ query, browser, profile, num_results }) => {
    try {
      let cookies: Cookie[];
      if (browser === "stored") {
        cookies = loadCookies();
        if (cookies.length === 0) {
          throw new Error(
            "No stored cookies. Use set_cookies to upload cookies first."
          );
        }
      } else if (browser === "firefox") {
        cookies = getFirefoxCookies(".google.com", profile);
      } else {
        cookies = await getChromeCookies(".google.com", profile);
      }

      const results = await searchGoogle(query, cookies, num_results);
      return {
        content: [
          { type: "text" as const, text: JSON.stringify(results, null, 2) },
        ],
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return {
        isError: true,
        content: [{ type: "text" as const, text: `Error: ${msg}` }],
      };
    }
  }
);

server.tool(
  "set_cookies",
  "Upload cookies to use for searches (e.g. exported from a browser extension or devtools). Saved to disk for future searches.",
  {
    cookies: cookieSchema.describe(
      "Array of cookie objects: {name, value, domain, path?, expires?, httpOnly?, secure?, sameSite?}"
    ),
  },
  async ({ cookies }) => {
    try {
      const count = saveCookies(cookies as Cookie[]);
      return {
        content: [
          {
            type: "text" as const,
            text: `Saved ${count} cookies. Use browser:"stored" in search_google to use them.`,
          },
        ],
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return {
        isError: true,
        content: [{ type: "text" as const, text: `Error: ${msg}` }],
      };
    }
  }
);

server.tool(
  "get_stored_cookies",
  "List cookies previously uploaded via set_cookies",
  {},
  async () => {
    const cookies = loadCookies();
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            { count: cookies.length, cookies: cookies.map((c) => ({ name: c.name, domain: c.domain, valueLength: c.value.length })) },
            null,
            2
          ),
        },
      ],
    };
  }
);

server.tool(
  "get_chrome_cookies",
  "Extract cookies from Google Chrome for a given domain",
  {
    domain: z.string().describe("Domain to get cookies for (e.g. 'google.com')"),
    profile: z
      .string()
      .optional()
      .describe("Chrome profile name (e.g. 'Default', 'Profile 1')"),
  },
  async ({ domain, profile }) => {
    try {
      const domainFilter = domain.startsWith(".") ? domain : `.${domain}`;
      const cookies = await getChromeCookies(domainFilter, profile);
      return {
        content: [
          { type: "text" as const, text: JSON.stringify(cookies, null, 2) },
        ],
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return {
        isError: true,
        content: [{ type: "text" as const, text: `Error: ${msg}` }],
      };
    }
  }
);

server.tool(
  "get_firefox_cookies",
  "Extract cookies from Mozilla Firefox for a given domain",
  {
    domain: z.string().describe("Domain to get cookies for (e.g. 'google.com')"),
    profile: z
      .string()
      .optional()
      .describe("Firefox profile name (e.g. 'default-release', 'default-esr')"),
  },
  async ({ domain, profile }) => {
    try {
      const domainFilter = domain.startsWith(".") ? domain : `.${domain}`;
      const cookies = getFirefoxCookies(domainFilter, profile);
      return {
        content: [
          { type: "text" as const, text: JSON.stringify(cookies, null, 2) },
        ],
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return {
        isError: true,
        content: [{ type: "text" as const, text: `Error: ${msg}` }],
      };
    }
  }
);

async function getCookiesFor(browser: string, profile?: string): Promise<Cookie[]> {
  if (browser === "stored") {
    const cookies = loadCookies();
    if (!cookies.length) throw new Error("No stored cookies. Use set_cookies first.");
    return cookies;
  }
  if (browser === "chrome") return await getChromeCookies(".google.com", profile);
  return getFirefoxCookies(".google.com", profile);
}

server.tool(
  "search_youtube",
  "Search YouTube for videos. Returns titles, URLs, channels, views, and durations.",
  {
    query: z.string().describe("Search query"),
    browser: z
      .enum(["chrome", "firefox", "stored"])
      .default("firefox")
      .describe("Cookie source"),
    num_results: z.number().min(1).max(50).default(10).describe("Number of results"),
  },
  async ({ query, browser, num_results }) => {
    try {
      const cookies = await getCookiesFor(browser);
      const results = await searchYouTube(query, cookies, num_results);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(results, null, 2) }],
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { isError: true, content: [{ type: "text" as const, text: `Error: ${msg}` }] };
    }
  }
);

server.tool(
  "scrape_youtube_video",
  "Get full details of a YouTube video: title, description, views, likes, channel, tags, duration.",
  {
    url: z.string().describe("YouTube video URL or 11-char video ID"),
    browser: z
      .enum(["chrome", "firefox", "stored"])
      .default("firefox")
      .describe("Cookie source"),
  },
  async ({ url, browser }) => {
    try {
      const cookies = await getCookiesFor(browser);
      const video = await scrapeYouTubeVideo(url, cookies);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(video, null, 2) }],
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { isError: true, content: [{ type: "text" as const, text: `Error: ${msg}` }] };
    }
  }
);

server.tool(
  "get_youtube_comments",
  "Get top comments from a YouTube video.",
  {
    url: z.string().describe("YouTube video URL or video ID"),
    browser: z
      .enum(["chrome", "firefox", "stored"])
      .default("firefox")
      .describe("Cookie source"),
    max_comments: z.number().min(1).max(100).default(20).describe("Max comments to return"),
  },
  async ({ url, browser, max_comments }) => {
    try {
      const cookies = await getCookiesFor(browser);
      const comments = await getYouTubeComments(url, cookies, max_comments);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(comments, null, 2) }],
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { isError: true, content: [{ type: "text" as const, text: `Error: ${msg}` }] };
    }
  }
);

async function main() {
  // Health check TCP server (so menu can detect if MCP is running)
  const healthServer = net.createServer((socket) => {
    socket.end(JSON.stringify({ status: "ok", name: "truesearch-mcp", version: "1.0.0", uptime: process.uptime() }));
  });
  healthServer.listen(HEALTH_PORT, "127.0.0.1", () => {
    console.error(`Health check on port ${HEALTH_PORT}`);
  });
  healthServer.on("error", () => {
    console.error(`Health port ${HEALTH_PORT} already in use (another instance running?)`);
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("TrueSearchMCP server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
