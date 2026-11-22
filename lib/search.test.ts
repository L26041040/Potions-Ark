import { describe, expect, it } from "vitest";
import { matchesQuery } from "./search";
import { normalizeItem, type Item } from "./types";

const item = normalizeItem({
  name: "#稀有釋出#可餐飲#可飲酒",
  info: "",
  address: "台北市大安區",
  note: "備註：優先看",
  contact: "測試不動產 王小姐 Amy 0912-345-678\nLINE：@123abcd",
} as unknown as Item);

describe("matchesQuery", () => {
  it("finds an item by title, note, contact person, company and phone number", () => {
    for (const q of ["稀有釋出", "可飲酒", "優先看", "王小姐", "amy", "測試不動產", "0912-345-678", "0912345678", "@123abcd"]) {
      expect(matchesQuery(item, q), q).toBe(true);
    }
    expect(matchesQuery(item, "信義區")).toBe(false);
  });
});
