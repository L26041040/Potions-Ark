import { describe, expect, it } from "vitest";
import { normalizeItem, type Item } from "./types";

describe("normalizeItem", () => {
  it("keeps everything an item saved before v2.2 had and fills the new fields with safe defaults", () => {
    // Shape of an item saved by v2.1 (the live site's existing data).
    const old = {
      id: "abc123",
      name: "近捷運金店面",
      sourceUrl: "https://business.591.com.tw/rent/1",
      coverUrl: "https://img1.591.com.tw/house/2026/10/18/1.jpg!730x460.water2.jpg",
      info: "租金45000元/月",
      address: "",
      embed: true,
      status: "pending",
      note: "下週看屋",
      noteBy: "阿明",
      noteAt: "2026-11-21T10:00:00Z",
      createdBy: "阿明",
      createdAt: "2026-11-21T09:00:00Z",
      updatedAt: "2026-11-21T10:00:00Z",
      deletedAt: null,
      deletedBy: "",
    } as unknown as Item;
    const item = normalizeItem(old);
    expect(item).toMatchObject({ id: "abc123", name: "近捷運金店面", status: "pending", note: "下週看屋", noteBy: "阿明", coverUrl: old.coverUrl });
    expect(item).toMatchObject({ photos: [], rent: null, area: null, health: "unchecked", healthAt: null, healthReason: "" });
  });
});
