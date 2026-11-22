import { describe, expect, it } from "vitest";
import { extractAllUrls } from "./url";

describe("extractAllUrls", () => {
  it("finds one URL per line", () => {
    const result = extractAllUrls("https://business.591.com.tw/rent/111\nhttps://business.591.com.tw/rent/222\n");
    expect(result.entries.map((e) => e.url)).toEqual([
      "https://business.591.com.tw/rent/111",
      "https://business.591.com.tw/rent/222",
    ]);
    expect(result.duplicates).toEqual([]);
    expect(result.invalid).toEqual([]);
  });

  it("finds every URL in a pasted LINE message and keeps the words on its line as a fallback name", () => {
    const message = [
      "大哥這幾間可以看看",
      "信義區金店面 近捷運 https://business.591.com.tw/rent/333?utm_source=line",
      "【591】大安區角間：https://rent.591.com.tw/444 來自【591】",
      "還有這間https://www.sinyi.com.tw/rent/houseno/C1，不錯",
    ].join("\n");
    const { entries } = extractAllUrls(message);
    expect(entries).toEqual([
      { url: "https://business.591.com.tw/rent/333", name: "信義區金店面 近捷運" },
      { url: "https://rent.591.com.tw/444", name: "【591】大安區角間 來自【591】" },
      { url: "https://www.sinyi.com.tw/rent/houseno/C1", name: "還有這間 不錯" },
    ]);
  });

  it("counts a link pasted twice in the same batch as a duplicate, ignoring tracking parameters", () => {
    const result = extractAllUrls(
      "https://business.591.com.tw/rent/555\nhttps://business.591.com.tw/rent/555?fbclid=x\nhttps://business.591.com.tw/rent/555#photos",
    );
    expect(result.entries.map((e) => e.url)).toEqual(["https://business.591.com.tw/rent/555"]);
    expect(result.duplicates).toHaveLength(2);
  });

  it("leaves no name when one line holds several links", () => {
    const { entries } = extractAllUrls("兩間 https://a.example.com/1 https://b.example.com/2");
    expect(entries).toEqual([
      { url: "https://a.example.com/1", name: "" },
      { url: "https://b.example.com/2", name: "" },
    ]);
  });

  it("reports a link that cannot be parsed as invalid instead of dropping it silently", () => {
    const result = extractAllUrls("http://%zz/listing\nhttps://business.591.com.tw/rent/666");
    expect(result.invalid).toEqual(["http://%zz/listing"]);
    expect(result.entries.map((e) => e.url)).toEqual(["https://business.591.com.tw/rent/666"]);
  });

  it("has no cap on how many links are taken", () => {
    const text = Array.from({ length: 250 }, (_, i) => `https://business.591.com.tw/rent/${1000 + i}`).join("\n");
    expect(extractAllUrls(text).entries).toHaveLength(250);
  });
});
