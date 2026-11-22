// Pure extraction of a listing's photos and key facts from a 591 page.
// Only 591 is read this way; other sites keep the single og:image cover.

export type ListingDetails = {
  photos: string[];
  rent: number | null;
  area: number | null;
  address: string;
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

export function parseListing(html: string, pageUrl: URL, description: string): ListingDetails {
  const details: ListingDetails = { photos: [], rent: null, area: null, address: "" };
  if (!is591(pageUrl)) return details;
  const nodes = jsonLdNodes(html);

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

  // offers.price is the monthly rent only on rental pages; on sale pages it is the total price.
  if (/\/rent\//.test(pageUrl.pathname)) {
    for (const node of nodes) {
      if (!typesOf(node).includes("RealEstateListing")) continue;
      const price = Number((node.offers as Node | undefined)?.price);
      if (Number.isFinite(price) && price > 0) details.rent = Math.round(price);
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
