import { describe, expect, it } from "vitest";
import { applyRecord, findSameListing, NO_PAGE, type MergeContext, type PageFacts } from "./merge";
import { recordFromRow, type ImportRecord } from "./sheet";
import { normalizeItem, type Doc, type Item } from "./types";

let counter = 0;
const newId = () => `id${++counter}`;
const ctx = (over: Partial<MergeContext> = {}): MergeContext => ({ by: "11月試算表", now: "2026-11-22T20:00:00.000Z", createdAt: "2026-11-22T20:00:00.989Z", newId, ...over });

function record(cells: string[], number = "11", link = "https://business.591.com.tw/rent/22383299"): ImportRecord {
  const r = recordFromRow({ number, link, cells });
  if ("error" in r) throw new Error(r.error);
  return r;
}

const row11 = record(["#稀有釋出#可餐飲#可飲酒", "未討論", "", "優先看", "15.6", "50", "", "", "", "測試不動產 王小姐 0912-345-678\n✅@123abcd"]);

function existing(over: Partial<Item>): Item {
  return normalizeItem({
    id: "Gb7ylQJk",
    name: "591房屋交易網 | 租屋買屋實價登錄資訊平台",
    sourceUrl: "https://business.591.com.tw/rent/22383299",
    coverUrl: "https://img1.591.com.tw/house/2026/11/20/1.jpg",
    info: "591房屋交易網是全台灣領先的房地產交易資訊平台之一, 每日90萬人在線找屋",
    address: "台北市大安區市民大道四段",
    rent: 156000,
    area: 50,
    floor: "1F/7F",
    photos: [
      { id: "l1", source: "listing", url: "https://img1.591.com.tw/house/2026/11/20/1.jpg" },
      { id: "u1", source: "upload", url: "/api/photo?p=x", pathname: "x", createdBy: "炒飯" },
    ],
    embed: true,
    status: "shortlisted",
    health: "ok",
    healthAt: "2026-11-22T18:00:00Z",
    healthReason: "HTTP 200",
    note: "",
    noteBy: "",
    noteAt: null,
    createdBy: "炒飯",
    createdAt: "2026-11-21T20:52:39.823Z",
    updatedAt: "2026-11-22T18:36:27.209Z",
    deletedAt: null,
    deletedBy: "",
    ...over,
  } as Item);
}

function docWith(...items: Item[]): Doc {
  return { version: 1, items, entries: [{ id: "c1", itemId: items[0]?.id ?? "", kind: "comment", body: "週末去看", from: null, to: null, nickname: "炒飯", createdAt: "2026-11-22T18:40:00Z" }] };
}

describe("applyRecord", () => {
  it("merges a row into the same listing: fixes a site-name title, adds note and contact, keeps decisions, photos and comments", () => {
    const doc = docWith(existing({}));
    const outcome = applyRecord(doc, row11, ctx());
    expect(outcome).toMatchObject({ result: "merged", id: "Gb7ylQJk", inTrash: false });
    const item = doc.items[0];
    expect(doc.items).toHaveLength(1);
    expect(item).toMatchObject({
      name: "#稀有釋出#可餐飲#可飲酒",
      status: "shortlisted",
      rent: 156000,
      area: 50,
      note: "備註：優先看",
      noteBy: "11月試算表",
      contact: "測試不動產 王小姐 0912-345-678\n✅@123abcd",
      info: "",
      address: "台北市大安區市民大道四段",
      floor: "1F/7F",
    });
    expect(item.photos.map((p) => p.id)).toEqual(["l1", "u1"]);
    expect(doc.entries).toHaveLength(1);
    expect(item.manual).toEqual(expect.arrayContaining(["name", "rent", "area", "contact"]));
  });

  it("is idempotent: the same row again changes nothing and never repeats the note", () => {
    const doc = docWith(existing({}));
    applyRecord(doc, row11, ctx());
    const snapshot = JSON.stringify(doc);
    expect(applyRecord(doc, row11, ctx({ now: "2026-11-23T00:00:00Z" }))).toMatchObject({ result: "unchanged" });
    expect(JSON.stringify(doc)).toBe(snapshot);
  });

  it("keeps a name, contact or rent a shareholder typed, and appends the sheet note after their note", () => {
    const doc = docWith(existing({ name: "大安金店（看過）", contact: "自己問到的電話", rent: 150000, manual: ["name", "contact", "rent"], note: "房東人很好", noteBy: "阿明" }));
    applyRecord(doc, row11, ctx());
    expect(doc.items[0]).toMatchObject({ name: "大安金店（看過）", contact: "自己問到的電話", rent: 150000, note: "房東人很好\n\n備註：優先看" });
  });

  it("adds a new item with the sheet's values first and the page's facts filling the gaps", () => {
    const doc = docWith(existing({}));
    const page: PageFacts = {
      fetched: true,
      title: "頁面標題",
      image: "https://img1.591.com.tw/house/2026/11/20/9.jpg",
      description: "台北市大安區店面出租：租金175000元/月，使用坪數56坪",
      contact: "代理人 李先生\n電話：0900-000-000",
      tags: { food: { value: true, evidence: "可餐飲" } },
      photos: ["https://img1.591.com.tw/house/2026/11/20/9.jpg", "https://img2.591.com.tw/house/2026/11/20/8.jpg"],
      rent: 175000,
      area: 56,
      address: "台北市大安區延吉街62巷",
      floor: "1F/7F",
      embed: true,
      health: "ok",
      healthReason: "HTTP 200",
    };
    const row2 = record(["東區4段223巷", "未討論", "挑高", "看起來矮", "17.5", "56(33+23)", "", "東區", "", ""], "2", "https://business.591.com.tw/rent/21973160");
    const outcome = applyRecord(doc, row2, ctx({ page }));
    expect(outcome.result).toBe("added");
    const item = doc.items.find((i) => i.id === outcome.id)!;
    expect(item).toMatchObject({
      name: "東區4段223巷",
      status: "new",
      rent: 175000,
      area: 56,
      address: "台北市大安區延吉街62巷",
      contact: "代理人 李先生\n電話：0900-000-000",
      info: "台北市大安區店面出租：租金175000元/月，使用坪數56坪\n商圈：東區｜坪數：56(33+23)",
      note: "理由：挑高\n備註：看起來矮",
      createdBy: "11月試算表",
      createdAt: "2026-11-22T20:00:00.989Z",
      health: "ok",
    });
    expect(item.photos).toHaveLength(2);
    expect(item.autoTags).toEqual({ food: { value: true, evidence: "可餐飲" } });
  });

  it("refreshes tags read from the listing but never a shareholder's tag setting", () => {
    const override = { food: { value: false, by: "炒飯", at: "2026-11-22T00:00:00Z" } };
    const doc = docWith(existing({ health: "unchecked", tagOverrides: override }));
    const page: PageFacts = { ...NO_PAGE, fetched: true, tags: { food: { value: true, evidence: "可餐飲" } }, health: "ok", healthReason: "正常" };
    applyRecord(doc, row11, ctx({ page }));
    expect(doc.items[0].tagOverrides).toEqual(override);
    expect(doc.items[0].autoTags).toEqual({ food: { value: true, evidence: "可餐飲" } });
  });

  it("turns X into 不考慮 with a status record, but only for undecided items", () => {
    const doc = docWith(existing({ status: "new" }));
    const rejected = record(["小金店", "X", "空間", "太小", "6.5", "30"]);
    applyRecord(doc, rejected, ctx());
    expect(doc.items[0].status).toBe("rejected");
    expect(doc.entries.at(-1)).toMatchObject({ kind: "status", from: "new", to: "rejected", nickname: "11月試算表" });
    const decided = docWith(existing({ status: "pending" }));
    applyRecord(decided, rejected, ctx());
    expect(decided.items[0].status).toBe("pending");
  });

  it("merges into an item in the recycle bin instead of duplicating it, and leaves it there", () => {
    const doc = docWith(existing({ id: "vqPxR3S4", name: "來自 business.591.com.tw 的物件", deletedAt: "2026-11-22T18:39:19Z", deletedBy: "炒飯", status: "new" }));
    const outcome = applyRecord(doc, row11, ctx());
    expect(outcome).toMatchObject({ result: "merged", inTrash: true });
    expect(doc.items).toHaveLength(1);
    expect(doc.items[0]).toMatchObject({ name: "#稀有釋出#可餐飲#可飲酒", deletedAt: "2026-11-22T18:39:19Z" });
  });

  it("matches an item saved with a 591.to share link once it is resolved, and saves the listing link", () => {
    const doc = docWith(existing({ id: "riO_Sx7q", sourceUrl: "https://591.to/elOPc" }));
    const resolved = new Map([["riO_Sx7q", "https://business.591.com.tw/rent/22383299"]]);
    expect(findSameListing(doc.items, row11.sourceUrl, { includeDeleted: true })).toBeUndefined();
    const outcome = applyRecord(doc, row11, ctx({ resolved }));
    expect(outcome).toMatchObject({ result: "merged", id: "riO_Sx7q" });
    expect(doc.items[0].sourceUrl).toBe("https://business.591.com.tw/rent/22383299");
    expect(doc.items).toHaveLength(1);
  });
});
