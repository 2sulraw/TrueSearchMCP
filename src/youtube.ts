import * as cheerio from "cheerio";
import { fetchWithProxy } from "./proxy.js";
import type { Cookie } from "./types.js";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export interface YouTubeResult {
  title: string;
  url: string;
  videoId: string;
  channel: string;
  views: string;
  duration: string;
  description: string;
}

export interface YouTubeVideo {
  title: string;
  url: string;
  videoId: string;
  channel: string;
  channelUrl: string;
  views: string;
  likes: string;
  published: string;
  duration: string;
  description: string;
  tags: string[];
  category: string;
  embeddingAllowed: boolean;
}

function cookiesToHeader(cookies: Cookie[]): string {
  return cookies.map((c) => `${c.name}=${c.value}`).join("; ");
}

function buildHeaders(cookies: Cookie[], referer?: string): Record<string, string> {
  const headers: Record<string, string> = {
    "User-Agent": USER_AGENT,
    Accept:
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "same-origin",
    "Sec-Fetch-User": "?1",
    "Upgrade-Insecure-Requests": "1",
    "Sec-Ch-Ua": '"Chromium";v="131", "Not_A Brand";v="24"',
    "Sec-Ch-Ua-Mobile": "?0",
    "Sec-Ch-Ua-Platform": '"Windows"',
  };
  if (referer) headers["Referer"] = referer;
  if (cookies.length > 0) headers["Cookie"] = cookiesToHeader(cookies);
  return headers;
}

async function fetchPage(url: string, cookies: Cookie[]): Promise<string> {
  const resp = await fetchWithProxy(url, { headers: buildHeaders(cookies), redirect: "follow" });
  if (!resp.ok) throw new Error(`HTTP ${resp.status} fetching ${url}`);
  return resp.text();
}

export async function searchYouTube(
  query: string,
  cookies: Cookie[],
  numResults: number = 10
): Promise<YouTubeResult[]> {
  const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}&sp=EgIQAQ%253D%253D`;
  const html = await fetchPage(url, cookies);
  const $ = cheerio.load(html);

  // YouTube embeds results in ytInitialData JSON
  const scriptMatch = html.match(/var ytInitialData = ({.+?});<\/script>/);
  if (!scriptMatch) throw new Error("Could not find ytInitialData in YouTube response");

  const data = JSON.parse(scriptMatch[1]);
  const results: YouTubeResult[] = [];

  // Walk the JSON to find video renderers
  function walk(obj: any): void {
    if (results.length >= numResults) return;
    if (typeof obj !== "object" || obj === null) return;

    if (obj.videoRenderer && results.length < numResults) {
      const vr = obj.videoRenderer;
      const videoId = vr.videoId || "";
      const title = vr.title?.runs?.map((r: any) => r.text).join("") || "";
      const channel = vr.ownerText?.runs?.[0]?.text || vr.longBylineText?.runs?.[0]?.text || "";
      const views = vr.viewCountText?.simpleText || "";
      const duration = vr.lengthText?.simpleText || "";
      const description =
        vr.detailedMetadataSnippets?.[0]?.snippetText?.runs?.map((r: any) => r.text).join("") || "";

      if (videoId && title) {
        results.push({
          title,
          url: `https://www.youtube.com/watch?v=${videoId}`,
          videoId,
          channel,
          views,
          duration,
          description,
        });
      }
    }

    for (const key of Object.keys(obj)) {
      if (results.length >= numResults) return;
      walk(obj[key]);
    }
  }

  walk(data);
  return results;
}

export async function scrapeYouTubeVideo(
  input: string,
  cookies: Cookie[]
): Promise<YouTubeVideo> {
  // Accept full URL or just video ID
  const videoIdMatch = input.match(/(?:v=|youtu\.be\/|shorts\/|embed\/)([a-zA-Z0-9_-]{11})/);
  const videoId = videoIdMatch ? videoIdMatch[1] : input.length === 11 ? input : null;
  if (!videoId) throw new Error(`Could not extract video ID from: ${input}`);

  const url = `https://www.youtube.com/watch?v=${videoId}`;
  const html = await fetchPage(url, cookies);

  // Extract ytInitialPlayerResponse for details
  const playerMatch = html.match(/ytInitialPlayerResponse\s*=\s*({.+?})\s*;/);
  // Extract ytInitialData for more metadata
  const dataMatch = html.match(/var ytInitialData = ({.+?});<\/script>/);

  if (!playerMatch && !dataMatch) throw new Error("Could not parse YouTube video page");

  const player = playerMatch ? JSON.parse(playerMatch[1]) : null;
  const data = dataMatch ? JSON.parse(dataMatch[1]) : null;

  const details = player?.videoDetails || {};
  const microformat = player?.microformat?.playerMicroformatRenderer || {};

  // Get likes/engagement from ytInitialData
  let likes = "";
  let commentCount = "";
  let tags: string[] = [];
  let category = "";
  let embeddingAllowed = false;

  if (data) {
    function walkForLikes(obj: any): void {
      if (typeof obj !== "object" || obj === null) return;
      if (obj.toggleButtonRenderer?.defaultText?.accessibility?.accessibilityData?.label) {
        const label = obj.toggleButtonRenderer.defaultText.accessibility.accessibilityData.label;
        if (/like/i.test(label) && !likes) {
          likes = label.replace(/.*?(\d[\d,.\sKMB]*).*/i, "$1").trim();
        }
      }
      if (obj.commentCountRenderer?.count?.simpleText && !commentCount) {
        commentCount = obj.commentCountRenderer.count.simpleText;
      }
      for (const key of Object.keys(obj)) walkForLikes(obj[key]);
    }
    walkForLikes(data);
  }

  if (player?.videoDetails?.keywords) tags = player.videoDetails.keywords;
  if (microformat?.category) category = microformat.category;
  if (player?.playabilityStatus?.reason?.includes("embed")) embeddingAllowed = false;
  embeddingAllowed = !player?.playabilityStatus?.reason?.includes("disabled");

  return {
    title: details.title || "",
    url,
    videoId,
    channel: details.author || "",
    channelUrl: microformat?.ownerProfileUrl || "",
    views: details.viewCount ? parseInt(details.viewCount).toLocaleString() : "",
    likes,
    published: microformat?.publishDate || "",
    duration: details.lengthSeconds
      ? `${Math.floor(details.lengthSeconds / 60)}:${(details.lengthSeconds % 60).toString().padStart(2, "0")}`
      : "",
    description: details.shortDescription || "",
    tags,
    category,
    embeddingAllowed,
  };
}

export async function getYouTubeComments(
  input: string,
  cookies: Cookie[],
  maxComments: number = 20
): Promise<Array<{ author: string; text: string; likes: string; published: string }>> {
  const videoIdMatch = input.match(/(?:v=|youtu\.be\/|shorts\/)([a-zA-Z0-9_-]{11})/);
  const videoId = videoIdMatch ? videoIdMatch[1] : input.length === 11 ? input : null;
  if (!videoId) throw new Error(`Could not extract video ID from: ${input}`);

  const headers = { ...buildHeaders(cookies), "Content-Type": "application/json" };
  const context = { client: { clientName: "WEB", clientVersion: "2.20240101.00.00", hl: "en", gl: "US" } };

  // Step 1: Get the video page to find the comments continuation token
  const nextResp = await fetchWithProxy("https://www.youtube.com/youtubei/v1/next", {
    method: "POST",
    headers,
    body: JSON.stringify({ context, videoId }),
  });
  if (!nextResp.ok) throw new Error(`InnerTube HTTP ${nextResp.status}`);
  const nextData = await nextResp.json();

  const tokenMatch = JSON.stringify(nextData).match(/"continuationCommand":\{"token":"([^"]+)"/);
  if (!tokenMatch) return [];

  // Step 2: Fetch comments via continuation token
  const cResp = await fetchWithProxy("https://www.youtube.com/youtubei/v1/next", {
    method: "POST",
    headers,
    body: JSON.stringify({ context, continuation: tokenMatch[1] }),
  });
  if (!cResp.ok) throw new Error(`Comments HTTP ${cResp.status}`);
  const cData = await cResp.json();

  // Step 3: Extract comments from frameworkUpdates mutations
  const mutations = cData.frameworkUpdates?.entityBatchUpdate?.mutations || [];
  const likesMap: Record<string, string> = {};

  // Build likes map from toolbar mutations
  for (const m of mutations) {
    const p = m.payload;
    if (p?.commentToolbarEntityPayload?.likeCountNotliked) {
      likesMap[m.payload?.key || ""] = p.commentToolbarEntityPayload.likeCountNotliked;
    }
    // Also check toolbarStateEntityPayload
    if (p?.toolbarStateEntityPayload?.likeCountNotliked) {
      likesMap[p.key || ""] = p.toolbarStateEntityPayload.likeCountNotliked;
    }
  }

  const comments: Array<{ author: string; text: string; likes: string; published: string }> = [];

  for (const m of mutations) {
    if (comments.length >= maxComments) break;
    const cep = m.payload?.commentEntityPayload;
    if (!cep?.properties?.content?.content) continue;

    const text = cep.properties.content.content;
    const author = cep.author?.displayName || "";
    const published = cep.properties.publishedTime || "";
    const likes = likesMap[cep.key] || likesMap[m.payload?.key || ""] || "0";

    comments.push({ author, text, likes, published });
  }

  return comments;
}
