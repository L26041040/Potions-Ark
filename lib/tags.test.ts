import { describe, expect, it } from "vitest";
import { detectTags, tagsOf } from "./tags";
import { normalizeItem, type Item } from "./types";

const value = (text: string) => Object.fromEntries(Object.entries(detectTags(text)).map(([k, v]) => [k, v?.value]));

describe("detectTags", () => {
  it("marks explicit positive wording as 是", () => {
    expect(value("#稀有釋出#可餐飲#可飲酒")).toEqual({ food: true, alcohol: true });
    expect(value("仁愛圓環商圈VS大安路面寬小金店餐飲可")).toEqual({ food: true });
    expect(value("商三特🔥忠孝復興🚇微風廣場旁🉑餐飲")).toEqual({ food: true });
    expect(value("本店面可做餐飲")).toEqual({ food: true });
    expect(value("信義區合法餐飲店面天然瓦斯挑高排煙")).toEqual({ food: true });
    expect(value("六張犁MRT|港式餐酒館頂讓1F+B1")).toEqual({ transfer: true });
    expect(value("是頂讓，80萬")).toEqual({ transfer: true });
  });

  it("marks negations as 否 and never reads 「不可餐飲」 as 可餐飲", () => {
    expect(value("不可餐飲")).toEqual({ food: false });
    expect(value("禁止餐飲業")).toEqual({ food: false });
    expect(value("不可飲酒")).toEqual({ alcohol: false });
    expect(value("無頂讓金")).toEqual({ transfer: false });
  });

  it("does not guess from related words, past use or hedged wording", () => {
    expect(value("禁油煙")).toEqual({});
    expect(value("不可明火")).toEqual({});
    expect(value("之前是餐酒館")).toEqual({});
    expect(value("看起來是頂讓")).toEqual({});
    expect(value("可能可餐飲，要再問")).toEqual({});
    expect(value("可餐飲？")).toEqual({});
    expect(value("適合高級西餐廳\n可能可以往米其林拚的那種")).toEqual({});
    // A hedge covers the whole sentence, not just up to the next comma.
    expect(value("好像是餐廳，要頂讓")).toEqual({});
    expect(value("看起來是之前店家，頂讓中")).toEqual({});
    // Past use and questions settle nothing.
    expect(value("之前是可餐飲的店")).toEqual({});
    expect(value("餐飲可否再問")).toEqual({});
    expect(value("可餐飲嗎")).toEqual({});
    // A plain statement on its own line still counts.
    expect(value("店面漂亮\n是頂讓，80萬")).toEqual({ transfer: true });
  });

  it("records a listing text that says both yes and no as undecided", () => {
    expect(detectTags("可餐飲\n不可餐飲").food).toEqual({ value: null, evidence: "可餐飲 ／ 不可餐飲" });
  });

  it("keeps the words that decided it", () => {
    expect(detectTags("東區~10米邊間~可餐飲").food).toEqual({ value: true, evidence: "東區~10米邊間~可餐飲" });
  });
});

function item(over: Partial<Item>): Item {
  return normalizeItem({ id: "a", name: "", info: "", note: "", address: "", ...over } as Item);
}

describe("tagsOf", () => {
  it("reads title, notes and information, and names where each tag came from", () => {
    const tags = tagsOf(item({ name: "#稀有釋出#可餐飲#可飲酒", note: "備註：是頂讓，80萬" }));
    expect(tags.food).toMatchObject({ state: "yes", source: "標題" });
    expect(tags.alcohol).toMatchObject({ state: "yes", source: "標題" });
    expect(tags.transfer).toMatchObject({ state: "yes", source: "重要備註" });
  });

  it("uses what the 591 listing text said when it was read", () => {
    const tags = tagsOf(item({ name: "金店面", autoTags: { food: { value: true, evidence: "可餐飲、可營登" } } }));
    expect(tags.food).toMatchObject({ state: "yes", source: "591 刊登內容", evidence: "可餐飲、可營登" });
  });

  it("stays 未確認 when the 591 text disagrees with itself, even if the title says yes", () => {
    const tags = tagsOf(item({ name: "#可餐飲", autoTags: { food: { value: null, evidence: "可餐飲 ／ 不可餐飲" } } }));
    expect(tags.food).toMatchObject({ state: "unknown", conflict: true });
  });

  it("is 未確認 when nothing is said or sources disagree", () => {
    expect(tagsOf(item({ name: "大安區商圈高密度住宅區金店面" })).food.state).toBe("unknown");
    const both = tagsOf(item({ name: "可餐飲金店", note: "房東說不可餐飲" }));
    expect(both.food).toMatchObject({ state: "unknown", conflict: true });
  });

  it("always lets a shareholder's setting win", () => {
    const tags = tagsOf(item({ name: "#可餐飲", tagOverrides: { food: { value: false, by: "炒飯", at: "2026-11-23T00:00:00Z" } } }));
    expect(tags.food).toMatchObject({ state: "no", source: "股東填寫", by: "炒飯" });
    const set = tagsOf(item({ name: "金店面", tagOverrides: { transfer: { value: true, by: "阿明", at: "2026-11-23T00:00:00Z" } } }));
    expect(set.transfer).toMatchObject({ state: "yes", source: "股東填寫" });
  });
});
