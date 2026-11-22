// Pure helpers shared by the browser and the server.

const URL_IN_TEXT = /https?:\/\/[^\s<>"'`，。、；：！？「」『』（）【】《》〈〉]+/i;
const BARE_DOMAIN = /^(?:[a-z0-9-]+\.)+[a-z]{2,}\/[^\s]*/i;

/** Finds the first http(s) URL in pasted text and returns it with the leftover text. */
export function extractUrl(text: string): { url: string; rest: string } | null {
  const trimmed = text.trim();
  let match = trimmed.match(URL_IN_TEXT);
  let url = match ? match[0] : "";
  if (!url) {
    const firstToken = trimmed.split(/\s+/)[0] ?? "";
    const bare = firstToken.match(BARE_DOMAIN);
    if (!bare) return null;
    url = "https://" + bare[0];
    match = bare;
  }
  url = trimUrl(url);
  const rest = (match ? trimmed.replace(match[0], " ") : trimmed).replace(/\s+/g, " ").trim();
  return { url, rest };
}

function trimUrl(url: string): string {
  let out = url.replace(/[.,;:!?'"*~]+$/, "");
  while (/[)\]}]$/.test(out) && count(out, out.at(-1)!) > count(out, opener(out.at(-1)!))) {
    out = out.slice(0, -1);
  }
  return out;
}

export type ExtractedUrls = {
  /** Cleaned, de-duplicated links with the words found on the same line. */
  entries: { url: string; name: string }[];
  /** Links that repeat an earlier one in the same text. */
  duplicates: string[];
  /** Strings that look like links but cannot be parsed. */
  invalid: string[];
};

/** Finds every http(s) link in pasted text (one per line or a whole chat message). No limit on count. */
export function extractAllUrls(text: string): ExtractedUrls {
  const result: ExtractedUrls = { entries: [], duplicates: [], invalid: [] };
  const seen = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    const matches = [...line.matchAll(new RegExp(URL_IN_TEXT.source, "gi"))];
    for (const match of matches) {
      const raw = trimUrl(match[0]);
      const url = cleanUrl(raw);
      if (!url) {
        result.invalid.push(raw);
        continue;
      }
      if (seen.has(url)) {
        result.duplicates.push(raw);
        continue;
      }
      seen.add(url);
      let name = "";
      if (matches.length === 1) {
        const start = match.index ?? 0;
        const before = line.slice(0, start).replace(/[\s:：,，、]+$/, "");
        const after = line.slice(start + raw.length).replace(/^[\s:：,，、。.]+/, "");
        name = nameFromText([before, after].filter(Boolean).join(" "));
      }
      result.entries.push({ url, name });
    }
  }
  return result;
}

function opener(closer: string): string {
  return closer === ")" ? "(" : closer === "]" ? "[" : "{";
}

function count(text: string, ch: string): number {
  return text.split(ch).length - 1;
}

/** Returns a cleaned http(s) URL without fragment and tracking parameters, or null if invalid. */
export function cleanUrl(raw: string): string | null {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  if (u.username || u.password) return null;
  u.hash = "";
  for (const key of [...u.searchParams.keys()]) {
    const k = key.toLowerCase();
    if (k.startsWith("utm_") || k === "fbclid") u.searchParams.delete(key);
  }
  const out = u.toString();
  return out.length > 2000 ? null : out;
}

/** Turns leftover pasted text into a usable name. */
export function nameFromText(rest: string): string {
  return rest
    .replace(/詳情\s*[:：]?\s*$/, "")
    .replace(/[\s,，.。:：;；!！|｜-]+$/, "")
    .trim()
    .slice(0, 120);
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

export function mapsUrl(address: string): string {
  return "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(address);
}
