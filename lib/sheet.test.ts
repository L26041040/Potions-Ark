import { describe, expect, it } from "vitest";
import { parseArea, parseRent, recordFromRow } from "./sheet";

// Rows shaped like the shareholders' sheet; contact details are made up.
describe("recordFromRow", () => {
  it("maps every column: 萬元 rent, status, notes, compound size, extras and contact", () => {
    const record = recordFromRow({
      number: "11",
      link: "https://business.591.com.tw/rent/22383299",
      cells: ["#稀有釋出#可餐飲#可飲酒\r\n", "未討論", "", "優先看", "15.6", "50", "", "", "", "測試不動產 王小姐  Amy  0912-345-678\r\n\r\n\r\n✅@123abcd (可加賴)"],
    });
    expect(record).toEqual({
      ref: "#11",
      order: 11,
      sourceUrl: "https://business.591.com.tw/rent/22383299",
      name: "#稀有釋出#可餐飲#可飲酒",
      status: "new",
      note: "備註：優先看",
      rent: 156000,
      area: 50,
      info: "",
      address: "",
      contact: "測試不動產 王小姐 Amy 0912-345-678\n✅@123abcd (可加賴)",
    });
  });

  it("keeps reasons and multi-line notes in full and turns X into 不考慮", () => {
    const record = recordFromRow({ number: "7", link: "https://business.591.com.tw/rent/1", cells: ["小金店\r\n", "X", "空間", "太小\n再想想", "6.5", "30"] });
    expect(record).toMatchObject({ status: "rejected", note: "理由：空間\n備註：太小\n再想想", rent: 65000, area: 30, contact: "" });
  });

  it("keeps 挑高, 商圈 and a compound size in the information, skipping unknown marks", () => {
    expect(recordFromRow({ number: "2", link: "https://business.591.com.tw/rent/2", cells: ["東區", "未討論", "", "", "17.5", "56(33+23)", "", "東區"] })).toMatchObject({
      area: 56,
      info: "商圈：東區｜坪數：56(33+23)",
    });
    expect(recordFromRow({ number: "1", link: "https://business.591.com.tw/rent/3", cells: ["延吉街", "未討論", "", "", "8", "55", "?", "國館", "延吉街1號"] })).toMatchObject({
      info: "商圈：國館",
      address: "延吉街1號",
    });
    expect(recordFromRow({ number: "36", link: "https://business.591.com.tw/rent/4", cells: ["中山區", "未討論", "", "", "10", "24.92+10.25", "3.9"] })).toMatchObject({
      area: 35.17,
      info: "挑高：3.9｜坪數：24.92+10.25",
    });
  });

  it("does not import rows that only have a number, nor rows without a title or link", () => {
    expect(recordFromRow({ number: "40", link: "", cells: ["", "未討論"] })).toEqual({ ref: "#40", error: "空白列（只有編號），不匯入", blank: true });
    expect(recordFromRow({ number: "41", link: "https://business.591.com.tw/rent/5", cells: ["", "未討論"] })).toMatchObject({ error: "沒有標題" });
    expect(recordFromRow({ number: "42", link: "", cells: ["有標題", "未討論"] })).toMatchObject({ error: "編號欄沒有 591 連結" });
  });
});

describe("parseRent / parseArea", () => {
  it("reads 萬元 and leaves unreadable values empty instead of guessing", () => {
    expect(parseRent("15.6")).toBe(156000);
    expect(parseRent("10.68")).toBe(106800);
    expect(parseRent("面議")).toBeNull();
    expect(parseRent("")).toBeNull();
    expect(parseArea("36.58")).toEqual({ area: 36.58, compound: false });
    expect(parseArea("68(36+32)")).toEqual({ area: 68, compound: true });
    expect(parseArea("約50坪左右")).toEqual({ area: null, compound: true });
  });
});
