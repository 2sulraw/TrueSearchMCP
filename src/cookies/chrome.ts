import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import Database from "better-sqlite3";
import koffi from "koffi";
import type { Cookie } from "../types.js";

const crypt32 = koffi.load("crypt32.dll");
const kernel32 = koffi.load("kernel32.dll");

const DATA_BLOB = koffi.struct("DATA_BLOB", { cbData: "int32", pbData: "void*" });

const CryptUnprotectData = crypt32.func("CryptUnprotectData", "bool", [
  koffi.pointer(DATA_BLOB),
  koffi.pointer("uint16"),
  koffi.pointer(DATA_BLOB),
  "void*",
  "void*",
  "uint32",
  koffi.out(koffi.pointer(DATA_BLOB)),
]);

const LocalFree = kernel32.func("LocalFree", "void*", ["void*"]);

const CRYPTPROTECT_UI_FORBIDDEN = 0x1;

function dpapiDecrypt(encrypted: Buffer): Buffer {
  const input = { cbData: encrypted.length, pbData: encrypted };
  const outputRef = [{ cbData: 0, pbData: null }];
  const ok = CryptUnprotectData(input, null, null, null, null, CRYPTPROTECT_UI_FORBIDDEN, outputRef);
  if (!ok) throw new Error("CryptUnprotectData failed");
  const out = outputRef[0];
  const bytes: Uint8Array = koffi.decode(out.pbData, koffi.array("uint8", out.cbData));
  const result = Buffer.from(bytes);
  LocalFree(out.pbData);
  return result;
}

function getMasterKey(): Buffer {
  const localStatePath = path.join(
    process.env.LOCALAPPDATA || "",
    "Google", "Chrome", "User Data", "Local State"
  );
  const localState = JSON.parse(fs.readFileSync(localStatePath, "utf-8"));
  const encryptedKey = Buffer.from(localState.os_crypt.encrypted_key, "base64");
  return dpapiDecrypt(encryptedKey.subarray(5));
}

function decryptCookie(masterKey: Buffer, encryptedValue: Buffer): string | null {
  if (encryptedValue.length === 0) return "";

  // v10/v11: AES-256-GCM
  if (encryptedValue[0] === 0x76 && encryptedValue[1] === 0x31 &&
      (encryptedValue[2] === 0x30 || encryptedValue[2] === 0x31)) {
    const nonce = encryptedValue.subarray(3, 15);
    const ciphertext = encryptedValue.subarray(15, encryptedValue.length - 16);
    const authTag = encryptedValue.subarray(encryptedValue.length - 16);
    const decipher = crypto.createDecipheriv("aes-256-gcm", masterKey, nonce);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf-8");
  }

  // Legacy: 0x01 prefix (DPAPI direct)
  if (encryptedValue[0] === 0x01) {
    return dpapiDecrypt(encryptedValue.subarray(1)).toString("utf-8");
  }

  // v20 (Chrome 127+ App Bound Encryption) — cannot decrypt externally
  if (encryptedValue[0] === 0x76 && encryptedValue[1] === 0x31 && encryptedValue[2] === 0x32) {
    return null;
  }

  return null;
}

function getProfileDir(profile?: string): string {
  const userData = path.join(process.env.LOCALAPPDATA || "", "Google", "Chrome", "User Data");
  if (profile) return path.join(userData, profile);
  try {
    const localState = JSON.parse(fs.readFileSync(path.join(userData, "Local State"), "utf-8"));
    const name = localState.profile?.name;
    const map: Record<string, string> = { "Person 1": "Default", Default: "Default" };
    return path.join(userData, map[name] || "Default");
  } catch {
    return path.join(userData, "Default");
  }
}

const sameSiteMap: Record<number, Cookie["sameSite"]> = {
  0: "none", 1: "lax", 2: "strict", 3: "no_restriction",
};

function readChromeCookiesDirect(dbPath: string, domain: string): Cookie[] {
  const masterKey = getMasterKey();
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    const rows = db
      .prepare(
        `SELECT name, encrypted_value, host_key, path, expires_utc, is_httponly, is_secure, samesite
         FROM cookies WHERE host_key LIKE ?`
      )
      .all(`%${domain}%`) as {
      name: string; encrypted_value: Buffer; host_key: string; path: string;
      expires_utc: number; is_httponly: number; is_secure: number; samesite: number;
    }[];

    return rows
      .map((row) => {
        const value = decryptCookie(masterKey, row.encrypted_value);
        if (value === null) return null;
        return {
          name: row.name, value, domain: row.host_key, path: row.path,
          expires: row.expires_utc > 0 ? Math.floor(row.expires_utc / 1_000_000 - 11644473600) : null,
          httpOnly: row.is_httponly === 1, secure: row.is_secure === 1,
          sameSite: sameSiteMap[row.samesite] || "none",
        };
      })
      .filter((c): c is Cookie => c !== null);
  } finally {
    db.close();
  }
}

// Chrome DevTools Protocol fallback for v20 (App Bound Encryption) cookies
async function getChromeCookiesViaCDP(domain: string): Promise<Cookie[]> {
  let versionInfo: { webSocketDebuggerUrl?: string };
  try {
    const resp = await fetch("http://127.0.0.1:9222/json/version");
    if (!resp.ok) throw new Error();
    versionInfo = await resp.json();
  } catch {
    throw new Error(
      "Chrome App-Bound Encryption (v20) cannot be decrypted externally. " +
      "To use Chrome cookies: close Chrome, then reopen it with " +
      "`chrome.exe --remote-debugging-port=9222`, and try again. " +
      "Or use the 'firefox' browser option instead."
    );
  }

  if (!versionInfo.webSocketDebuggerUrl) {
    throw new Error("Chrome remote debugging WebSocket URL not found");
  }

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(versionInfo.webSocketDebuggerUrl!);
    const timeout = setTimeout(() => { ws.close(); reject(new Error("CDP timeout")); }, 5000);

    ws.onopen = () => {
      ws.send(JSON.stringify({ id: 1, method: "Storage.getCookies", params: {} }));
    };

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data.toString());
      if (msg.id !== 1) return;
      clearTimeout(timeout);
      ws.close();

      const allCookies: any[] = msg.result?.cookies || [];
      const domainBare = domain.replace(/^\./, "");
      const filtered = allCookies.filter((c) => c.domain.includes(domainBare));

      resolve(
        filtered.map((c) => ({
          name: c.name,
          value: c.value,
          domain: c.domain,
          path: c.path,
          expires: c.expires && c.expires > 0 ? c.expires : null,
          httpOnly: c.httpOnly || false,
          secure: c.secure || false,
          sameSite: (c.sameSite as Cookie["sameSite"]) || "none",
        }))
      );
    };

    ws.onerror = () => {
      clearTimeout(timeout);
      reject(new Error("Chrome DevTools Protocol connection failed"));
    };
  });
}

export async function getChromeCookies(domain: string, profile?: string): Promise<Cookie[]> {
  const profileDir = getProfileDir(profile);
  const dbPath = path.join(profileDir, "Network", "Cookies");

  // Try direct decryption first (works for v10/v11 cookies)
  const dbFile = fs.existsSync(dbPath)
    ? dbPath
    : fs.existsSync(path.join(profileDir, "Cookies"))
      ? path.join(profileDir, "Cookies")
      : null;

  if (dbFile) {
    const cookies = readChromeCookiesDirect(dbFile, domain);
    if (cookies.length > 0) return cookies;
    // All cookies failed to decrypt — likely v20, fall through to CDP
  }

  return getChromeCookiesViaCDP(domain);
}
