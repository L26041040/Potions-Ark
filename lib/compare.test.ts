import { describe, expect, it } from "vitest";
import { includesGroundFloor, matchesQuick, sortItems, zoneOf, type QuickFilter } from "./compare";
import { normalizeItem, type Item } from "./types";

function item(over: Partial<Item>): Item {
  return normalizeItem({ id: "x", name: "", info: "", note: "", address: "", createdAt: "2026-11-22T00:00:00Z", ...over } as Item);
}

describe("zoneOf", () => {
  it("prefers the shareholder's value, then the sheet's 商圈, then the district in the address", () => {
    expect(zoneOf(item({ zone: "東區", info: "商圈：國館", address: "台北市大安區延吉街" }))).toEqual({ value: "東區", source: "股東填寫" });
    expect(zoneOf(item({ info: "台北市大安區店面出租：租金80000元/月\n挑高：3.6｜商圈：臨江夜市", address: "台北市大安區光復南路" }))).toEqual({ value: "臨江夜市", source: "試算表商圈" });
    expect(zoneOf(item({ info: "商圈：國館", address: "延吉街165-2" }))).toEqual({ value: "國館", source: "試算表商圈" });
    expect(zoneOf(item({ address: "台北市大安區市民大道四段" }))).toEqual({ value: "大安區", source: "地址" });
    expect(zoneOf(item({ address: "大安區四維路76巷19號" }))).toEqual({ value: "大安區", source: "地址" });
    expect(zoneOf(item({ address: "台北市中山區新生北路二段68巷" }))).toEqual({ value: "中山區", source: "地址" });
  });

  it("is empty when nothing says it", () => {
    expect(zoneOf(item({ address: "延吉街165-2" }))).toEqual({ value: "", source: "" });
  });
});

describe("includesGroundFloor", () => {
  it("reads the floor before the slash, including combined floors", () => {
    for (const f of ["1F", "1F+B1", "B1+1F", "1F~2F", "1+2F", "1F/7F", "1F/1F", "B1~2F", "1樓"]) expect(includesGroundFloor(f), f).toBe(true);
    for (const f of ["2F", "2F/16F", "B1", "B1/7F", "2F~3F"]) expect(includesGroundFloor(f), f).toBe(false);
  });

  it("does not know when the floor is blank or unreadable", () => {
    expect(includesGroundFloor("")).toBeNull();
    expect(includesGroundFloor("整棟")).toBeNull();
  });
});

describe("matchesQuick", () => {
  const none: QuickFilter = { maxRent: null, minArea: null, groundFloor: false };
  const a = item({ rent: 156000, area: 50, floor: "1F/7F" });
  const b = item({ rent: 220000, area: 36.58, floor: "2F/16F" });
  const missing = item({ rent: null, area: null, floor: "" });

  it("keeps everything when no condition is set", () => {
    expect([a, b, missing].every((i) => matchesQuick(i, none))).toBe(true);
  });

  it("filters by highest rent, lowest area and ground floor, alone and together", () => {
    expect(matchesQuick(a, { ...none, maxRent: 160000 })).toBe(true);
    expect(matchesQuick(b, { ...none, maxRent: 160000 })).toBe(false);
    expect(matchesQuick(a, { ...none, minArea: 40 })).toBe(true);
    expect(matchesQuick(b, { ...none, minArea: 40 })).toBe(false);
    expect(matchesQuick(a, { ...none, groundFloor: true })).toBe(true);
    expect(matchesQuick(b, { ...none, groundFloor: true })).toBe(false);
    expect(matchesQuick(a, { maxRent: 160000, minArea: 50, groundFloor: true })).toBe(true);
    expect(matchesQuick(a, { maxRent: 150000, minArea: 50, groundFloor: true })).toBe(false);
  });

  it("never counts an item without the data as matching", () => {
    expect(matchesQuick(missing, { ...none, maxRent: 9_000_000 })).toBe(false);
    expect(matchesQuick(missing, { ...none, minArea: 1 })).toBe(false);
    expect(matchesQuick(missing, { ...none, groundFloor: true })).toBe(false);
  });
});

describe("sortItems", () => {
  const items = [
    item({ id: "old-cheap", createdAt: "2026-11-20T00:00:00Z", rent: 80000, area: 30 }),
    item({ id: "new-dear", createdAt: "2026-11-22T00:00:00Z", rent: 250000, area: 45 }),
    item({ id: "mid-norent", createdAt: "2026-11-21T00:00:00Z", rent: null, area: 50 }),
    item({ id: "mid-same", createdAt: "2026-11-21T12:00:00Z", rent: 80000, area: null }),
  ];
  const ids = (key: Parameters<typeof sortItems>[1]) => sortItems(items, key).map((i) => i.id);

  it("orders by newest, oldest, rent and area both ways", () => {
    expect(ids("newest")).toEqual(["new-dear", "mid-same", "mid-norent", "old-cheap"]);
    expect(ids("oldest")).toEqual(["old-cheap", "mid-norent", "mid-same", "new-dear"]);
    expect(ids("rentAsc")).toEqual(["mid-same", "old-cheap", "new-dear", "mid-norent"]);
    expect(ids("rentDesc")).toEqual(["new-dear", "mid-same", "old-cheap", "mid-norent"]);
    expect(ids("areaAsc")).toEqual(["old-cheap", "new-dear", "mid-norent", "mid-same"]);
    expect(ids("areaDesc")).toEqual(["mid-norent", "new-dear", "old-cheap", "mid-same"]);
  });

  it("keeps items without the value last and equal values in newest-first order, without touching the input", () => {
    const before = items.map((i) => i.id);
    sortItems(items, "rentAsc");
    expect(items.map((i) => i.id)).toEqual(before);
    // 80000 twice: the newer (mid-same) stays ahead of the older (old-cheap), in both directions.
    expect(ids("rentAsc").slice(0, 2)).toEqual(["mid-same", "old-cheap"]);
    expect(ids("rentDesc").slice(1, 3)).toEqual(["mid-same", "old-cheap"]);
  });
});
