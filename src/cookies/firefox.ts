import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import Database from "better-sqlite3";
import type { Cookie } from "../types.js";

function findFirefoxProfilesIni(): string {
  return path.join(process.env.APPDATA || "", "Mozilla", "Firefox", "profiles.ini");
}

function findFirefoxProfile(profile?: string): string {
  const profilesIni = findFirefoxProfilesIni();

  if (!fs.existsSync(profilesIni)) {
    throw new Error("Firefox profiles.ini not found. Is Firefox installed?");
  }

  const lines = fs.readFileSync(profilesIni, "utf-8").split(/\r?\n/);
  const firefoxDir = path.join(process.env.APPDATA || "", "Mozilla", "Firefox");

  let currentProfile: { name?: string; path?: string; isRelative?: boolean } = {};
  const profiles: Array<{ name: string; fullPath: string }> = [];

  const flush = () => {
    if (!currentProfile.path) return;
    const full = currentProfile.isRelative
      ? path.join(firefoxDir, currentProfile.path)
      : currentProfile.path;
    profiles.push({ name: currentProfile.name || "", fullPath: full });
    currentProfile = {};
  };

  for (const line of lines) {
    // profiles.ini uses [Profile0], [Profile1], etc — not [Profile]
    if (line.startsWith("[Profile")) {
      flush();
    } else if (line.startsWith("Name=")) {
      currentProfile.name = line.substring(5);
    } else if (line.startsWith("Path=")) {
      currentProfile.path = line.substring(5);
    } else if (line.startsWith("IsRelative=")) {
      currentProfile.isRelative = line.substring(11) === "1";
    }
  }
  flush();

  if (profiles.length === 0) throw new Error("No Firefox profiles found");

  if (profile) {
    const match = profiles.find((p) => p.name.toLowerCase() === profile.toLowerCase());
    if (match) return match.fullPath;
  }

  // Prefer default-release over default (check release first)
  const preferred =
    profiles.find((p) => p.name.toLowerCase().includes("default-release")) ||
    profiles.find((p) => p.name.toLowerCase() === "default") ||
    profiles[0];
  return preferred.fullPath;
}

export function getFirefoxCookies(domain: string, profile?: string): Cookie[] {
  const profileDir = findFirefoxProfile(profile);
  const dbPath = path.join(profileDir, "cookies.sqlite");

  if (!fs.existsSync(dbPath)) {
    throw new Error(`Firefox cookies.sqlite not found at: ${dbPath}`);
  }

  // Copy to temp to avoid Firefox's SQLite lock
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ff-cookies-"));
  const tmpDb = path.join(tmpDir, "cookies.sqlite");
  fs.copyFileSync(dbPath, tmpDb);

  try {
    const db = new Database(tmpDb, { readonly: true });
    try {
      const rows = db
        .prepare(
          `SELECT name, value, host, path, expiry, isSecure, isHttpOnly, sameSite
           FROM moz_cookies WHERE host LIKE ?`
        )
        .all(`%${domain}%`) as {
        name: string;
        value: string;
        host: string;
        path: string;
        expiry: number;
        isSecure: number;
        isHttpOnly: number;
        sameSite: number;
      }[];

      const sameSiteMap: Record<number, Cookie["sameSite"]> = {
        0: "none",
        1: "lax",
        2: "strict",
        3: "no_restriction",
      };

      return rows.map((row) => ({
        name: row.name,
        value: row.value,
        domain: row.host,
        path: row.path,
        expires: row.expiry > 0 ? row.expiry : null,
        httpOnly: row.isHttpOnly === 1,
        secure: row.isSecure === 1,
        sameSite: sameSiteMap[row.sameSite] || "none",
      }));
    } finally {
      db.close();
    }
  } finally {
    // SQLite also creates -wal/-shm sidecars; delete all three or rmdir fails and leaks cookie data
    try {
      for (const f of [tmpDb, `${tmpDb}-wal`, `${tmpDb}-shm`]) {
        if (fs.existsSync(f)) fs.unlinkSync(f);
      }
      fs.rmdirSync(tmpDir);
    } catch { /* best effort */ }
  }
}
