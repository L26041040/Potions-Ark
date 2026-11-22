// Pure extraction of a listing's photos and key facts from a 591 page.
// Only 591 is read this way; other sites keep the single og:image cover.

import { findLineIds, findPhones } from "./contact";
import { cleanTitle, decodeEntities, isGenericTitle } from "./meta";

export type ListingDetails = {
  /** The listing's own title from its structured data (JSON-LD), without the site name. */
  title: string;
  /** Public contact details shown on the page: agent card and numbers written in the description. */
  contact: string;
  photos: string[];
  rent: number | null;
  area: number | null;
  address: string;
  floor: string;
};

const MAX_PHOTOS = 30;
// The listing's own photos live under /house/YYYY/MM/DD/; avatars, AI-edited
// images and placeholders live elsewhere and are skipped.
const PHOTO = /^https?:\/\/img\d*\.591\.com\.tw\/(house\/\d{4}\/\d{2}\/\d{2}\/\d+\.(?:jpe?g|png|webp|gif))(![^\s"'<>]*)?$/i;
const AREA = /(?:使用坪數|面積|坪數)\s*([\d,]+(?:\.\d+)?)\s*坪/;

type Node = Record<string, unknown>;

function jsonLdNodes(html: string): Node[] {
  const nodes: Node[] = [];
  for (const m of html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const data = JSON.parse(m[1]) as unknown;
      const list = Array.isArray(data) ? data : [data];
      for (const entry of list) {
        if (!entry || typeof entry !== "object") continue;
        const graph = (entry as Node)["@graph"];
        if (Array.isArray(graph)) nodes.push(...graph.filter((n): n is Node => Boolean(n) && typeof n === "object"));
        else nodes.push(entry as Node);
      }
    } catch {
      // Malformed JSON-LD is ignored; the item is still saved.
    }
  }
  return nodes;
}

function typesOf(node: Node): string[] {
  const t = node["@type"];
  return (Array.isArray(t) ? t : [t]).filter((x): x is string => typeof x === "string");
}

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function is591(url: URL): boolean {
  return url.hostname === "591.com.tw" || url.hostname.endsWith(".591.com.tw");
}

/** Only 591 shop rental pages are read in detail; every other page keeps its og:image cover. */
export function isShopRental591(url: URL): boolean {
  return url.hostname === "business.591.com.tw" && /^\/rent\/\d+/.test(url.pathname);
}

/**
 * One key per 591 listing, whatever form the link takes (web, mobile, with
 * extra parameters), so the same listing is never saved twice. Null for other
 * sites and for share links (591.to), which must be resolved first.
 */
export function listingKey(raw: string): string | null {
  let url: URL;
  try {
    url = resolve591Share(new URL(raw));
  } catch {
    return null;
  }
  if (!is591(url)) return null;
  const host = url.hostname.replace(/^www\./, "");
  const path = url.pathname;
  let m = path.match(/^\/(?:m\/)?rent\/(\d+)/);
  if (host === "business.591.com.tw" && m) return `591:business:${m[1]}`;
  m = path.match(/^\/v2\/business\/rent\/(\d+)/);
  if (host === "m.591.com.tw" && m) return `591:business:${m[1]}`;
  m = path.match(/^\/(?:rent-detail-)?(\d+)(?:\.html)?$/);
  if (host === "rent.591.com.tw" && m) return `591:rent:${m[1]}`;
  m = path.match(/^\/v2\/rent\/(\d+)/);
  if (host === "m.591.com.tw" && m) return `591:rent:${m[1]}`;
  return null;
}

function htmlText(fragment: string): string {
  return decodeEntities(
    fragment
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/<br\s*\/?>|<\/(?:p|div|li|h\d)>/gi, "\n")
      .replace(/<[^>]+>/g, ""),
  );
}

/**
 * Contact details a 591 page shows publicly: the role, name and company on
 * the agent card, plus phone numbers and LINE IDs the poster wrote in the
 * description. Numbers revealed only by the call button are not read.
 */
export function parseContact(html: string): string {
  const lines: string[] = [];
  const card = html.match(/<span[^>]*class="name"[^>]*>\s*<em[^>]*>\s*([^<:：]{1,6})[:：]?\s*<\/em>\s*([^<]{0,30})<\/span>/);
  const company = htmlText(html.match(/class="econ-text"[^>]*>([^<]{1,60})</)?.[1] ?? "").trim();
  if (card) {
    const role = card[1].trim();
    // The card shortens long names to 「京安國...」; those are left out.
    const name = htmlText(card[2]).trim();
    const who = [role, /(?:\.\.\.|…)$/.test(name) ? "" : name].filter(Boolean).join(" ");
    lines.push([who, company].filter(Boolean).join("｜"));
  } else if (company) {
    lines.push(company);
  }
  const start = html.search(/class="article/);
  if (start >= 0) {
    const end = html.indexOf("<section", start);
    const text = htmlText(html.slice(start, end > start ? end : start + 30_000));
    const phones = findPhones(text).slice(0, 3);
    const lineIds = findLineIds(text).slice(0, 2);
    if (phones.length) lines.push("電話：" + phones.join("、"));
    if (lineIds.length) lines.push("LINE：" + lineIds.join("、"));
  }
  return lines.filter(Boolean).join("\n").slice(0, 500);
}

export function parseListing(html: string, pageUrl: URL, description: string): ListingDetails {
  const details: ListingDetails = { title: "", contact: "", photos: [], rent: null, area: null, address: "", floor: "" };
  if (!isShopRental591(pageUrl)) return details;
  const nodes = jsonLdNodes(html);

  // Place.name is the listing title as posted; RealEstateListing.name carries the site suffix.
  for (const type of ["Place", "RealEstateListing"]) {
    const node = nodes.find((n) => typesOf(n).includes(type) && str(n.name));
    const title = node ? cleanTitle(decodeEntities(str(node.name)).replace(/\s+/g, " ")).slice(0, 120) : "";
    if (title && !isGenericTitle(title)) {
      details.title = title;
      break;
    }
  }
  details.contact = parseContact(html);

  const seen = new Set<string>();
  for (const node of nodes) {
    const images = node.image;
    if (!Array.isArray(images)) continue;
    for (const raw of images) {
      const url = typeof raw === "string" ? raw : str((raw as Node | null)?.url);
      const match = url.match(PHOTO);
      if (!match || seen.has(match[1])) continue;
      seen.add(match[1]);
      details.photos.push(url);
      if (details.photos.length >= MAX_PHOTOS) break;
    }
    if (details.photos.length) break;
  }

  for (const node of nodes) {
    if (!typesOf(node).includes("RealEstateListing")) continue;
    const price = Number((node.offers as Node | undefined)?.price);
    if (Number.isFinite(price) && price > 0) details.rent = Math.round(price);
  }

  for (const node of nodes) {
    const props = node.additionalProperty;
    if (!Array.isArray(props)) continue;
    const floor = props.find((p) => str((p as Node | null)?.name) === "樓層") as Node | undefined;
    if (floor) {
      details.floor = str(floor.value).slice(0, 40);
      break;
    }
  }

  for (const node of nodes) {
    const address = node.address as Node | undefined;
    if (!address || typeof address !== "object") continue;
    const street = str(address.streetAddress);
    if (street) {
      const region = str(address.addressRegion);
      details.address = (street.startsWith(region) ? street : region + street).slice(0, 200);
      break;
    }
  }

  const area = description.match(AREA);
  if (area) {
    const value = Number(area[1].replace(/,/g, ""));
    if (Number.isFinite(value) && value > 0) details.area = Math.round(value * 100) / 100;
  }
  return details;
}

/**
 * 591's app shares links as 591.to/…, which redirect to a LINE hand-off page
 * whose `url` parameter holds the real listing. Take that listing directly;
 * only 591's own hosts are accepted, so this can never lead elsewhere.
 */
export function resolve591Share(url: URL): URL {
  if (url.hostname !== "line-liff.591.com.tw" || !url.pathname.startsWith("/redirect")) return url;
  const inner = url.searchParams.get("url");
  if (!inner) return url;
  try {
    const target = new URL(inner);
    return (target.protocol === "https:" || target.protocol === "http:") && is591(target) ? target : url;
  } catch {
    return url;
  }
}
