// Pure HTML metadata extraction: title, cover image and a short description.

export type PageMeta = { title: string; image: string; description: string };

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code[0] === "#") {
      const n = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : whole;
    }
    return ENTITIES[code.toLowerCase()] ?? whole;
  });
}

function clean(text: string, max: number): string {
  return decodeEntities(text).replace(/\s+/g, " ").trim().slice(0, max);
}

/** Removes the site-name suffix 591 appends to its titles. */
export function cleanTitle(title: string): string {
  return title.replace(/\s*(?:[|｜]\s*[^|｜]{1,12}?\s*)?-\s*591(?:房屋交易網|租屋網)\s*$/, "").trim();
}

function cleanDescription(text: string): string {
  return text.replace(/[，,]?\s*更多[^，,]{0,12}詳情[，,]?\s*就上591[！!]?\s*$/, "").trim();
}

export function parseMeta(html: string, pageUrl: URL): PageMeta {
  const headEnd = html.search(/<\/head>/i);
  const head = headEnd > 0 ? html.slice(0, headEnd) : html.slice(0, 300_000);
  const meta = new Map<string, string>();
  for (const tag of head.match(/<meta\s[^>]*>/gi) ?? []) {
    const attrs = new Map<string, string>();
    for (const m of tag.matchAll(/([a-zA-Z:_-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
      attrs.set(m[1].toLowerCase(), m[3] ?? m[4] ?? m[5] ?? "");
    }
    const key = (attrs.get("property") ?? attrs.get("name") ?? "").toLowerCase();
    const content = attrs.get("content");
    if (key && content && !meta.has(key)) meta.set(key, content);
  }
  const titleTag = head.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "";
  const title = cleanTitle(clean(meta.get("og:title") ?? meta.get("twitter:title") ?? titleTag, 200)).slice(0, 120);
  const description = cleanDescription(
    clean(meta.get("og:description") ?? meta.get("description") ?? meta.get("twitter:description") ?? "", 400),
  ).slice(0, 300);
  let image = "";
  const rawImage = meta.get("og:image") ?? meta.get("og:image:url") ?? meta.get("twitter:image");
  if (rawImage) {
    try {
      const resolved = new URL(decodeEntities(rawImage).trim(), pageUrl);
      if (resolved.protocol === "https:" || resolved.protocol === "http:") image = resolved.toString().slice(0, 2000);
    } catch {
      image = "";
    }
  }
  return { title, image, description };
}
