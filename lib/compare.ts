// Comparing items in the warehouse: 商圈／區域, whether the shop includes the
// ground floor, the quick filters and the shared sort order. Pure; the data is
// never changed, only how it is shown.

import type { Item } from "./types";

export type Zone = { value: string; source: "" | "股東填寫" | "試算表商圈" | "地址" };

/** 商圈或區域 without the shareholder's value: the sheet's 「商圈：X」 in the information, else the district in the address. */
export function autoZoneOf(item: Item): Zone {
  const sheet = item.info.match(/商圈：([^｜\n]+)/)?.[1].trim();
  if (sheet) return { value: sheet, source: "試算表商圈" };
  // An optional postal code and 台灣, then the city or county, then the district: 「106台北市大安區…」.
  const district = item.address.trim().match(/^\d{0,6}(?:台灣|臺灣)?(?:[一-鿿]{2}[市縣])?([一-鿿]{1,3}區)/)?.[1];
  if (district) return { value: district, source: "地址" };
  return { value: "", source: "" };
}

/** 商圈或區域: the shareholder's value first, then the automatic one. */
export function zoneOf(item: Item): Zone {
  if (item.zone.trim()) return { value: item.zone.trim(), source: "股東填寫" };
  return autoZoneOf(item);
}

function floorNumber(token: string): number | null {
  const m = token.match(/^(B)?(\d+)F?$/);
  if (!m) return null;
  return m[1] ? -Number(m[2]) : Number(m[2]);
}

/**
 * Whether the shop includes the ground floor, read from the part before the
 * slash (「1F/7F」 is floor 1 of 7): 1F, 1F+B1, 1F~2F and 1+2F do, 2F and B1
 * do not. Null when the floor is blank or unreadable.
 */
export function includesGroundFloor(floor: string): boolean | null {
  const unit = floor.toUpperCase().replace(/樓/g, "F").replace(/\s+/g, "").split("/")[0];
  if (!unit) return null;
  let ground = false;
  for (const part of unit.split(/[+＋、,]/)) {
    const ends = part.split(/[~～至\-–]/).map(floorNumber);
    if (!ends.length || ends.some((n) => n === null)) return null;
    const nums = ends as number[];
    if (Math.min(...nums) <= 1 && Math.max(...nums) >= 1) ground = true;
  }
  return ground;
}

export type QuickFilter = {
  /** Highest rent in 元, or null. */
  maxRent: number | null;
  minArea: number | null;
  groundFloor: boolean;
};

/** An item without the data a condition needs never matches that condition. */
export function matchesQuick(item: Item, q: QuickFilter): boolean {
  if (q.maxRent !== null && (item.rent === null || item.rent > q.maxRent)) return false;
  if (q.minArea !== null && (item.area === null || item.area < q.minArea)) return false;
  if (q.groundFloor && includesGroundFloor(item.floor) !== true) return false;
  return true;
}

export type SortKey = "newest" | "oldest" | "rentAsc" | "rentDesc" | "areaAsc" | "areaDesc";

export const SORT_LABEL: Record<SortKey, string> = {
  newest: "最新新增",
  oldest: "最早新增",
  rentAsc: "租金低到高",
  rentDesc: "租金高到低",
  areaAsc: "坪數小到大",
  areaDesc: "坪數大到小",
};

const BY_VALUE: Partial<Record<SortKey, { field: "rent" | "area"; dir: 1 | -1 }>> = {
  rentAsc: { field: "rent", dir: 1 },
  rentDesc: { field: "rent", dir: -1 },
  areaAsc: { field: "area", dir: 1 },
  areaDesc: { field: "area", dir: -1 },
};

/**
 * A sorted copy. Items without the value always come last, and equal values
 * keep the newest-first order.
 */
export function sortItems(items: Item[], key: SortKey): Item[] {
  const newest = [...items].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  if (key === "oldest") return newest.reverse();
  const by = BY_VALUE[key];
  if (!by) return newest;
  const { field, dir } = by;
  return newest.sort((a, b) => {
    const x = a[field];
    const y = b[field];
    if (x === null || y === null) return x === y ? 0 : x === null ? 1 : -1;
    return (x - y) * dir;
  });
}
