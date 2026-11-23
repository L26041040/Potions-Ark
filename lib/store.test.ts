import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { setFlag } from "./flags";
import { mutate, NO_WRITE } from "./store";
import type { Doc, Item } from "./types";

// Real conditional writes and retries through mutate(), on the local stand-in storage in a temporary folder.
let dir = "";
const item = (id: string) => ({ id, name: id, sourceUrl: "", info: "", note: "", address: "", status: "new", flags: [] }) as unknown as Item;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "potions-store-"));
  process.env.POTIONS_DATA_DIR = dir;
  writeFileSync(path.join(dir, "db.json"), JSON.stringify({ version: 1, items: [item("a"), item("b")], entries: [] } satisfies Doc));
});

const stored = () => JSON.parse(readFileSync(path.join(dir, "db.json"), "utf8")) as Doc;

function mark(id: string, label: string, level: "major" | "minor", by: string) {
  return mutate((d) => {
    const target = d.items.find((i) => i.id === id)!;
    const r = setFlag(d.items, target, label, true, level, by, new Date().toISOString());
    return r.ok && r.changed ? r : NO_WRITE;
  });
}

describe("flags under concurrent writes", () => {
  it("keeps both when two people mark different flags on the same item at once", async () => {
    await Promise.all([mark("a", "太小", "major", "甲"), mark("a", "位置偏", "minor", "乙")]);
    expect(stored().items[0].flags.map((f) => `${f.label}:${f.by}`).sort()).toEqual(["位置偏:乙", "太小:甲"]);
  });

  it("ends with one level when two people create the same new name at different levels at once", async () => {
    for (const n of [1, 2, 3, 4, 5]) {
      const name = `新標籤${n}`;
      await Promise.all([mark("a", name, "major", "甲"), mark("b", name, "minor", "乙")]);
      const levels = new Set(stored().items.flatMap((i) => i.flags).filter((f) => f.label === name).map((f) => f.level));
      expect(levels.size, name).toBe(1);
      expect(stored().items.every((i) => i.flags.some((f) => f.label === name))).toBe(true);
    }
  });
});
