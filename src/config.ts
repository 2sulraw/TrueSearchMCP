import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const CONFIG_PATH = path.join(__dirname, "..", ".config.json");

export interface Config {
  proxy: string; // "auto" | "off" | "http://host:port"
}

const DEFAULTS: Config = { proxy: "auto" };

export function loadConfig(): Config {
  try {
    return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8")) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveConfig(cfg: Partial<Config>): Config {
  const merged = { ...loadConfig(), ...cfg };
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(merged, null, 2));
  return merged;
}
