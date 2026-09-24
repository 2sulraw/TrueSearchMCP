import * as cheerio from "cheerio";
import { fetchWithProxy } from "./proxy.js";
import type { Cookie, SearchResult } from "./types.js";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

function cookiesToHeader(cookies: Cookie[]): string {
  return cookies.map((c) => `${c.name}=${c.value}`).join("; ");
}

function isGoogleInternal(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    // keep google-owned content results (youtube, blogspot) but drop nav chrome
    return /(^|\.)google\./.test(host) || host === "gstatic.com" || host === "schema.org";
  } catch {
    return true;
  }
}

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"').trim();
}

function parseSearchResults(html: string, numResults: number): SearchResult[] {
  const $ = cheerio.load(html);
  const results: SearchResult[] = [];
  const seen = new Set<string>();

  const push = (title: string, url: string, snippet: string) => {
    if (results.length >= numResults) return;
    if (!title || !url || !url.startsWith("http")) return;
    if (isGoogleInternal(url)) return;
    if (seen.has(url)) return;
    seen.add(url);
    results.push({ title: stripTags(title), url, snippet: stripTags(snippet) });
  };

  // Primary: organic results are <a href="https://...">…<h3>Title</h3></a>
  // (verified against live HTML — div.g and AF_initDataCallback are both absent)
  $('a[href^="http"]:has(h3)').each((_, el) => {
    if (results.length >= numResults) return false;
    const href = ($(el).attr("href") || "").split("#")[0];
    const title = $(el).find("h3").first().text().trim();
    if (!title) return;

    // Snippet lives in the result's data-hveid container: div.VwiC3b / div[data-sncf]
    const container = $(el).closest("[data-hveid], div.tF2Cxc");
    const snippet =
      container.find("div[data-sncf] .VwiC3b, div.VwiC3b").first().text().trim() ||
      container.find("div.VwiC3b").first().text().trim();

    push(title, href, snippet);
  });

  // Fallback 1: legacy markup — div.g containers
  if (results.length < numResults) {
    $("div.g").each((_, el) => {
      if (results.length >= numResults) return false;
      const anchor = $(el).find("a[href]").first();
      const href = (anchor.attr("href") || "").split("#")[0];
      const title = $(el).find("h3").first().text().trim();
      const snippet =
        $(el).find("div[data-sncf], div.VwiC3b, span.aCOpRe").first().text().trim() ||
        $(el).find("div:not(:has(h3)):not(:has(a))").first().text().trim();
      push(title, href, snippet);
    });
  }

  // Fallback 2: raw regex — <a href="http…"> … <h3>Title</h3> even across odd nesting
  if (results.length < numResults) {
    const re = /<a\s+[^>]*href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) && results.length < numResults) {
      const h3 = m[2].match(/<h3[^>]*>([\s\S]*?)<\/h3>/);
      if (h3) push(stripTags(h3[1]), m[1].split("#")[0], "");
    }
  }

  return results.slice(0, numResults);
}

export async function searchGoogle(
  query: string,
  cookies: Cookie[],
  numResults: number = 10
): Promise<SearchResult[]> {
  const url = new URL("https://www.google.com/search");
  url.searchParams.set("q", query);
  url.searchParams.set("num", String(numResults));
  url.searchParams.set("hl", "en");

  const headers: Record<string, string> = {
    "User-Agent": USER_AGENT,
    Accept:
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
    Referer: "https://www.google.com/",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "same-origin",
    "Sec-Ch-Ua": '"Chromium";v="131", "Not_A Brand";v="24"',
    "Sec-Ch-Ua-Mobile": "?0",
    "Sec-Ch-Ua-Platform": '"Windows"',
    "Upgrade-Insecure-Requests": "1",
  };

  if (cookies.length > 0) {
    headers["Cookie"] = cookiesToHeader(cookies);
  }

  const response = await fetchWithProxy(url.toString(), {
    headers,
    redirect: "follow",
  });

  if (!response.ok) {
    throw new Error(`Google search failed with status ${response.status}`);
  }

  const html = await response.text();

  // Check for CAPTCHA / bot detection
  if (
    html.includes("unusual traffic") ||
    html.includes("captcha") ||
    html.includes("To continue, please")
  ) {
    throw new Error(
      "Google detected automated traffic. Try using a different browser profile or close and reopen your browser first."
    );
  }

  return parseSearchResults(html, numResults);
}
