import { describe, expect, it } from "vitest";
import { classifyHealth, isDueForCheck } from "./health";
import type { Item } from "./types";

const page = (title: string, body = "") => `<html><head><title>${title}</title></head><body>${body}</body></html>`;
const longListing = page("信義區金店面 | 店面出租 - 591房屋交易網", "<p>屋況良好</p>".repeat(400) + "<footer>已下架的物件不會顯示在搜尋結果</footer>");

describe("classifyHealth", () => {
  it("marks a listing gone only on 404, 410 or a page that clearly says it was removed", () => {
    expect(classifyHealth({ status: 404, headers: {}, body: '{"error":true,"statusCode":404,"message":"物件找不到了"}' }).health).toBe("gone");
    expect(classifyHealth({ status: 410, headers: {}, body: null }).health).toBe("gone");
    expect(classifyHealth({ status: 200, headers: {}, body: page("591房屋交易網--對不起，您訪問的頁面不存在") }).health).toBe("gone");
    expect(classifyHealth({ status: 200, headers: {}, body: '<script>alert("找不到物件");history.back();</script>' }).health).toBe("gone");
    expect(classifyHealth({ status: 420, headers: {}, body: page("住商不動產", "<h1>物件已下架</h1>") }).health).toBe("gone");
  });

  it("never calls a listing gone when the site only blocked or failed to answer", () => {
    for (const status of [401, 403, 429, 500, 502, 503]) {
      expect(classifyHealth({ status, headers: {}, body: page("Forbidden") }).health).toBe("unknown");
    }
    expect(classifyHealth({ status: 202, headers: { "x-amzn-waf-action": "challenge" }, body: "" }).health).toBe("unknown");
    expect(classifyHealth({ status: 403, headers: { "cf-mitigated": "challenge" }, body: page("Just a moment...") }).health).toBe("unknown");
    expect(classifyHealth({ status: null, headers: {}, body: null, error: "timeout" }).health).toBe("unknown");
    expect(classifyHealth({ status: null, headers: {}, body: null, error: "network" }).health).toBe("unknown");
  });

  it("treats an ordinary page as a live listing, even if removal words appear deep in a long page", () => {
    expect(classifyHealth({ status: 200, headers: {}, body: longListing }).health).toBe("ok");
  });

  it("gives a short reason a shareholder can read", () => {
    expect(classifyHealth({ status: 404, headers: {}, body: null }).reason).toContain("404");
    expect(classifyHealth({ status: 403, headers: {}, body: null }).reason).toContain("阻擋");
    expect(classifyHealth({ status: null, headers: {}, body: null, error: "timeout" }).reason).toContain("逾時");
  });
});

const DAY = 24 * 60 * 60 * 1000;
const now = Date.parse("2026-11-22T12:00:00Z");

function item(over: Partial<Item>): Item {
  return {
    id: "a",
    name: "測試",
    sourceUrl: "https://business.591.com.tw/rent/1",
    coverUrl: "",
    info: "",
    address: "",
    rent: null,
    area: null,
    floor: "",
    contact: "",
    zone: "",
    tagOverrides: {},
    autoTags: {},
    manual: [],
    photos: [],
    embed: true,
    status: "new",
    note: "",
    noteBy: "",
    noteAt: null,
    createdBy: "",
    createdAt: "2026-11-01T00:00:00Z",
    updatedAt: "2026-11-01T00:00:00Z",
    deletedAt: null,
    deletedBy: "",
    health: "ok",
    healthAt: new Date(now - 2 * DAY).toISOString(),
    healthReason: "",
    ...over,
  };
}

describe("isDueForCheck", () => {
  it("is due when never checked or last checked more than 24 hours ago", () => {
    expect(isDueForCheck(item({ health: "unchecked", healthAt: null }), now)).toBe(true);
    expect(isDueForCheck(item({ healthAt: new Date(now - DAY - 60_000).toISOString() }), now)).toBe(true);
  });

  it("is not due within 24 hours of the last check", () => {
    expect(isDueForCheck(item({ healthAt: new Date(now - DAY + 60_000).toISOString() }), now)).toBe(false);
  });

  it("skips items marked 不考慮, items in the recycle bin and items without a link", () => {
    expect(isDueForCheck(item({ status: "rejected" }), now)).toBe(false);
    expect(isDueForCheck(item({ deletedAt: "2026-11-20T00:00:00Z" }), now)).toBe(false);
    expect(isDueForCheck(item({ sourceUrl: "" }), now)).toBe(false);
  });
});
