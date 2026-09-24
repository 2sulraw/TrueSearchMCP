export interface Cookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number | null;
  httpOnly: boolean;
  secure: boolean;
  sameSite: "none" | "lax" | "strict" | "no_restriction";
}

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}
