import { describe, expect, it } from "vitest";
import { contactParts, findLineIds, findPhones, matchesPhone, tidyContact } from "./contact";

// All numbers and IDs below are made up.
describe("contactParts", () => {
  it("links mobile and landline numbers as calls and LINE IDs as LINE links", () => {
    const parts = contactParts("測試不動產 王小姐 Amy 0912-345-678\n✅@123abcd (可加賴)\n公司 (02)2345-6789");
    const links = parts.filter((p) => p.kind !== "text");
    expect(links).toEqual([
      { kind: "tel", text: "0912-345-678", href: "tel:0912345678" },
      { kind: "line", text: "@123abcd", href: "https://line.me/R/ti/p/%40123abcd" },
      { kind: "tel", text: "(02)2345-6789", href: "tel:0223456789" },
    ]);
    expect(parts.map((p) => p.text).join("")).toBe("測試不動產 王小姐 Amy 0912-345-678\n✅@123abcd (可加賴)\n公司 (02)2345-6789");
  });

  it("reads labelled LINE IDs and leaves phone numbers used as LINE IDs as phone links", () => {
    const links = (text: string) => contactParts(text).filter((p) => p.kind !== "text").map((p) => `${p.kind}:${p.text}`);
    expect(links("可以加我Line：tester1234")).toEqual(["line:tester1234"]);
    expect(links("LINE ID : ab0000 ")).toEqual(["line:ab0000"]);
    expect(links("Line ID： @001abcd (前面@要加)")).toEqual(["line:@001abcd"]);
    expect(links("LINE搜尋電話：0900-000-111")).toEqual(["tel:0900-000-111"]);
    expect(links("PHONE：0900111222")).toEqual(["tel:0900111222"]);
    expect(links("電洽:0900-111222手機+line/王先生")).toEqual(["tel:0900-111222"]);
  });

  it("does not treat e-mail addresses, license numbers or prices as contacts", () => {
    expect(contactParts("信箱 test0900@example.com").filter((p) => p.kind !== "text")).toEqual([]);
    expect(contactParts("(107)329691字號 租金156000元").filter((p) => p.kind !== "text")).toEqual([]);
  });
});

describe("findPhones / findLineIds", () => {
  it("returns each number and ID once", () => {
    const text = "電話：0912-345-678\n手機 0912345678\n02-2345-6789\nLINE ID：@abc123\n@ABC123";
    expect(findPhones(text)).toEqual(["0912-345-678", "02-2345-6789"]);
    expect(findLineIds(text)).toEqual(["@abc123"]);
  });
});

describe("tidyContact", () => {
  it("removes empty lines and repeated spaces from pasted text", () => {
    expect(tidyContact("測試不動產 王小姐  Amy  0912-345-678\r\n\r\n\r\n✅@123abcd (可加賴)")).toBe(
      "測試不動產 王小姐 Amy 0912-345-678\n✅@123abcd (可加賴)",
    );
  });
});

describe("matchesPhone", () => {
  it("matches a number typed with or without dashes, but not digits spread over lines", () => {
    const text = "王小姐 0912-345-678\n02-2345-6789";
    expect(matchesPhone(text, "0912345678")).toBe(true);
    expect(matchesPhone(text, "0912-345-678")).toBe(true);
    expect(matchesPhone(text, "345678")).toBe(true);
    expect(matchesPhone(text, "6780223")).toBe(false);
    expect(matchesPhone(text, "王小姐")).toBe(false);
  });
});
