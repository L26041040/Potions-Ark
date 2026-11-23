import { describe, expect, it } from "vitest";
import { canonicalizeFlags, cardFlags, existingLabelNotice, flagCatalog, matchesFlagFilter, PRESET_FLAGS, setFlag, sortFlags } from "./flags";
import { normalizeItem, type Flag, type Item } from "./types";

function item(id: string, flags: Flag[] = [], over: Partial<Item> = {}): Item {
  return normalizeItem({ id, name: id, info: "", note: "", address: "", flags, ...over } as unknown as Item);
}
const f = (label: string, level: Flag["level"], at = "2026-11-23T01:00:00.000Z", by = "炒飯"): Flag => ({ label, level, by, at });
const NOW = "2026-11-23T12:00:00.000Z";

describe("preset flags", () => {
  it("has the eight agreed labels in order, with 地下室 as a 一般 (orange) flaw", () => {
    expect(PRESET_FLAGS).toEqual([
      { label: "太小", level: "major" },
      { label: "挑高太低", level: "major" },
      { label: "二樓以上", level: "major" },
      { label: "地下室", level: "minor" },
      { label: "租金太高", level: "minor" },
      { label: "頂讓金過高", level: "minor" },
      { label: "屋況差", level: "minor" },
      { label: "位置偏", level: "minor" },
    ]);
  });
});

describe("setFlag", () => {
  it("selects with who and when, and unselects", () => {
    const a = item("a");
    expect(setFlag([a], a, "太小", true, "major", "阿明", NOW)).toMatchObject({ ok: true, changed: true });
    expect(a.flags).toEqual([{ label: "太小", level: "major", by: "阿明", at: NOW }]);
    expect(setFlag([a], a, "太小", false, "major", "阿明", NOW)).toMatchObject({ ok: true, changed: true });
    expect(a.flags).toEqual([]);
  });

  it("tells the custom form the name is already on this item instead of adding it twice", () => {
    const a = item("a", [f("沒招牌", "major")]);
    expect(setFlag([a], a, "沒招牌", true, "minor", "小美", NOW)).toMatchObject({ ok: true, changed: false, created: false, level: "major" });
    expect(a.flags).toHaveLength(1);
  });

  it("sends the wanted state, so repeating it changes nothing and the last request wins", () => {
    const a = item("a", [f("太小", "major")]);
    expect(setFlag([a], a, "太小", true, "major", "阿明", NOW)).toMatchObject({ ok: true, changed: false });
    expect(a.flags[0].by).toBe("炒飯");
    setFlag([a], a, "太小", false, "major", "阿明", NOW);
    expect(setFlag([a], a, "太小", false, "major", "阿明", NOW)).toMatchObject({ ok: true, changed: false });
    setFlag([a], a, "太小", true, "major", "小美", "2026-11-23T13:00:00.000Z");
    expect(a.flags).toEqual([{ label: "太小", level: "major", by: "小美", at: "2026-11-23T13:00:00.000Z" }]);
  });

  it("always uses the preset level, so 地下室 cannot become a 重大 flaw", () => {
    const a = item("a");
    setFlag([a], a, "地下室", true, "major", "阿明", NOW);
    expect(a.flags[0]).toMatchObject({ label: "地下室", level: "minor" });
  });

  it("gives a new custom label the level it was created with, and every later use the same level", () => {
    const a = item("a");
    const b = item("b");
    expect(setFlag([a, b], a, "太遠", true, "major", "阿明", NOW)).toMatchObject({ ok: true, changed: true, created: true });
    const second = setFlag([a, b], b, " 太遠 ", true, "minor", "小美", NOW);
    expect(second).toMatchObject({ ok: true, changed: true, created: false, level: "major" });
    expect(existingLabelNotice("major")).toBe("已有此標籤（重大），已直接套用");
    expect(b.flags[0]).toMatchObject({ label: "太遠", level: "major" });
  });

  it("matches names ignoring surrounding and repeated spaces, and treats a preset name as the preset", () => {
    const a = item("a");
    const r = setFlag([a], a, "  租金太高 ", true, "major", "阿明", NOW);
    expect(r).toMatchObject({ ok: true, created: false, level: "minor" });
    expect(a.flags[0].label).toBe("租金太高");
    setFlag([a], a, "門口  很窄", true, "minor", "阿明", NOW);
    expect(a.flags[1].label).toBe("門口 很窄");
  });

  it("keeps the whole site to one level when two people create the same name at once (write retried on fresh data)", () => {
    // Both start from the same data; 阿明's write lands first.
    const fresh = () => [item("a"), item("b")];
    const first = fresh();
    setFlag(first, first[0], "沒招牌", true, "major", "阿明", NOW);
    // 小美's first attempt (on the old data) is rejected by the conditional write and re-run on the new data.
    const retry = first.map((i) => normalizeItem(JSON.parse(JSON.stringify(i))));
    const result = setFlag(retry, retry[1], "沒招牌", true, "minor", "小美", NOW);
    expect(result).toMatchObject({ ok: true, level: "major", created: false });
    expect(retry.flatMap((i) => i.flags).map((x) => x.level)).toEqual(["major", "major"]);
  });

  it("enforces name length, line breaks and the limits", () => {
    const a = item("a");
    expect(setFlag([a], a, "", true, "minor", "阿明", NOW)).toMatchObject({ ok: false });
    expect(setFlag([a], a, "一二三四五六七八九十一", true, "minor", "阿明", NOW)).toMatchObject({ ok: false });
    expect(setFlag([a], a, "兩行\n名稱", true, "minor", "阿明", NOW)).toMatchObject({ ok: false });
    const full = item("full", Array.from({ length: 20 }, (_, i) => f(`缺點${i}`, "minor")));
    expect(setFlag([full], full, "太小", true, "major", "阿明", NOW)).toMatchObject({ ok: false });
    const others = Array.from({ length: 30 }, (_, i) => item(`o${i}`, [f(`自訂${i}`, "minor")]));
    const c = item("c");
    expect(setFlag([...others, c], c, "第三十一個", true, "minor", "阿明", NOW)).toMatchObject({ ok: false });
    // An existing custom label can still be used when the limit is reached.
    expect(setFlag([...others, c], c, "自訂3", true, "minor", "阿明", NOW)).toMatchObject({ ok: true });
  });
});

describe("flagCatalog", () => {
  it("lists the presets, then custom labels any item uses (recycle bin included), by name", () => {
    const items = [
      item("a", [f("沒招牌", "major")]),
      item("b", [f("太遠", "minor"), f("太小", "major")], { deletedAt: "2026-11-23T00:00:00Z" }),
    ];
    const labels = flagCatalog(items).map((e) => `${e.label}:${e.level}:${e.preset ? "預設" : "自訂"}`);
    expect(labels.slice(0, 8)).toEqual(PRESET_FLAGS.map((p) => `${p.label}:${p.level}:預設`));
    expect(labels.slice(8)).toEqual(["太遠:minor:自訂", "沒招牌:major:自訂"]);
  });

  it("drops a custom label as soon as no item uses it", () => {
    const a = item("a", [f("沒招牌", "major")]);
    setFlag([a], a, "沒招牌", false, "major", "阿明", NOW);
    expect(flagCatalog([a]).map((e) => e.label)).not.toContain("沒招牌");
  });
});

describe("canonicalizeFlags", () => {
  it("settles data that has one name at two levels: preset level for presets, the earliest marking for custom labels", () => {
    const items = canonicalizeFlags([
      item("a", [f("地下室", "major"), f("沒招牌", "minor", "2026-11-23T05:00:00.000Z")]),
      item("b", [f("沒招牌", "major", "2026-11-23T02:00:00.000Z")]),
    ]);
    expect(items[0].flags.map((x) => x.level)).toEqual(["minor", "major"]);
    expect(items[1].flags[0].level).toBe("major");
  });

  it("normalizes names and keeps one flag per name on an item", () => {
    const [a] = canonicalizeFlags([item("a", [f(" 地下室 ", "major", "2026-11-23T03:00:00.000Z"), f("地下室", "minor", "2026-11-23T01:00:00.000Z"), f("門口  窄", "minor")])]);
    expect(a.flags).toEqual([f("地下室", "minor", "2026-11-23T01:00:00.000Z"), f("門口 窄", "minor")]);
  });
});

describe("display order", () => {
  it("puts 重大 first, presets in order, then custom labels by name, and shows two plus the rest as +N", () => {
    const flags = [f("租金太高", "minor"), f("沒招牌", "major"), f("地下室", "minor"), f("太小", "major"), f("太遠", "minor")];
    expect(sortFlags(flags).map((x) => x.label)).toEqual(["太小", "沒招牌", "地下室", "租金太高", "太遠"]);
    expect(cardFlags(flags)).toEqual({ shown: [f("太小", "major"), f("沒招牌", "major")], more: 3 });
    expect(cardFlags([f("地下室", "minor")])).toEqual({ shown: [f("地下室", "minor")], more: 0 });
    expect(cardFlags([])).toEqual({ shown: [], more: 0 });
  });
});

describe("matchesFlagFilter", () => {
  const plain = item("plain");
  const major = item("major", [f("太小", "major"), f("地下室", "minor")]);
  const minor = item("minor", [f("地下室", "minor")]);
  it("hides items with a 重大 flaw but keeps items nobody has rated", () => {
    const q = { hideMajor: true, flag: null };
    expect([plain, major, minor].filter((i) => matchesFlagFilter(i, q)).map((i) => i.id)).toEqual(["plain", "minor"]);
  });

  it("shows only items with the chosen label, and nothing when it contradicts hiding 重大 flaws", () => {
    expect([plain, major, minor].filter((i) => matchesFlagFilter(i, { hideMajor: false, flag: "地下室" })).map((i) => i.id)).toEqual(["major", "minor"]);
    expect([plain, major, minor].filter((i) => matchesFlagFilter(i, { hideMajor: true, flag: "太小" }))).toEqual([]);
    expect([plain, major, minor].every((i) => matchesFlagFilter(i, { hideMajor: false, flag: null }))).toBe(true);
  });
});
