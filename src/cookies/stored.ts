import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import type { Cookie } from "../types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const COOKIES_FILE = path.join(__dirname, "..", "..", ".cookies.json");

export function saveCookies(cookies: Cookie[]): number {
  fs.writeFileSync(COOKIES_FILE, JSON.stringify(cookies, null, 2));
  return cookies.length;
}

export function loadCookies(): Cookie[] {
  try {
    return JSON.parse(fs.readFileSync(COOKIES_FILE, "utf-8"));
  } catch {
    return [];
  }
}
