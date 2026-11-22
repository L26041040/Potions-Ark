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

// Titles and descriptions that name the site instead of the listing. 591
// serves these when it does not render the listing (for example to some
// servers), so they must never become an item's name or information.
const GENERIC_TITLES = [
  /^591(?:房屋交易網|租屋網|房屋交易|售屋網)?(?:\s*[|｜:：\-–—].*)?$/i,
  /^來自\s*\S+\s*的物件$/,
  /^(?:店面|店舖|辦公|住宅|廠房|土地)?(?:出租|出售|租屋|買屋|售屋)$/,
];

/** True for a missing name or one that only names the site (「591」, 「591房屋交易網 | …」). */
export function isGenericTitle(title: string): boolean {
  const t = title.trim();
  return !t || GENERIC_TITLES.some((r) => r.test(t));
}

/** True for 591's site-wide description, which says nothing about the listing. */
export function isGenericDescription(text: string): boolean {
  return /591房屋交易網是|每日\d+萬人在線找屋/.test(text);
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
  const rawTitle = cleanTitle(clean(meta.get("og:title") ?? meta.get("twitter:title") ?? titleTag, 200)).slice(0, 120);
  const title = isGenericTitle(rawTitle) ? "" : rawTitle;
  const rawDescription = cleanDescription(
    clean(meta.get("og:description") ?? meta.get("description") ?? meta.get("twitter:description") ?? "", 400),
  ).slice(0, 300);
  const description = isGenericDescription(rawDescription) ? "" : rawDescription;
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
