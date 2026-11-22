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
    expect(item).toMatchObject({ contact: "", manual: [] });
  });

  it("keeps v2.2 items' photos, health and facts, and adds the v2.3 contact field empty", () => {
    const v22 = {
      id: "Gb7ylQJk", name: "591", sourceUrl: "https://business.591.com.tw/rent/22383299", coverUrl: "", info: "",
      address: "台北市大安區市民大道四段", rent: 156000, area: 50, floor: "1F/7F",
      photos: [{ id: "p1", source: "listing", url: "https://img1.591.com.tw/house/2026/11/20/1.jpg" }],
      embed: true, status: "shortlisted", health: "ok", healthAt: "2026-11-22T00:00:00Z", healthReason: "HTTP 200",
      note: "", noteBy: "", noteAt: null, createdBy: "炒飯", createdAt: "2026-11-21T20:52:39Z", updatedAt: "2026-11-22T00:00:00Z",
      deletedAt: null, deletedBy: "",
    } as unknown as Item;
    const item = normalizeItem(v22);
    expect(item).toMatchObject({ rent: 156000, area: 50, floor: "1F/7F", status: "shortlisted", health: "ok", contact: "", manual: [] });
    expect(item.photos).toHaveLength(1);
  });

  it("drops unknown names from the manual list", () => {
    const item = normalizeItem({ manual: ["name", "status", "contact"] } as unknown as Item);
    expect(item.manual).toEqual(["name", "contact"]);
  });
});
