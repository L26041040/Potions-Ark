import { describe, expect, it } from "vitest";
import { listingKey, parseContact, parseListing, resolve591Share } from "./listing";
import { isGenericDescription, isGenericTitle, parseMeta } from "./meta";

// Hand-written page shaped like a 591 shop rental page (values are made up).
function page591(graph: unknown[], body = "", title = "測試店面 | 店面出租 - 591房屋交易網"): string {
  return `<html><head><title>${title}</title>
<script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@graph": graph })}</script>
</head><body><span class="deposit">押金二個月</span>${body}</body></html>`;
}

// Shaped like 591's agent card and 屋況介紹 (names and numbers are made up).
const contactHtml = `<h2>屋況介紹</h2><div class="house-condition-header"><section data-v-1 class="contact">
<div class="contact-info"><p class="base-info-pc"><span data-v-1 class="name"><em data-v-1>仲介:</em> 王測試</span><span class="is-recmoney">(收服務費)</span></p>
<div class="base-info-mobile"><p><span>仲介</span><em></em><span>收服務費</span></p><p class="econ-text">測試不動產</p></div></div></section>
<div class="contact-tools"><a class="contact-action" title="撥打電話"><div data-gtm-behavior="call"><em>打電話</em></div></a></div></div>
<div class="house-condition-content"><div class="article"><p dir="auto"><span>測試不動產&nbsp;王小姐&nbsp;&nbsp;0912-345-678</span></p>
<p><span>✅@123abcd&nbsp;(可加賴方便聯絡)</span></p><p>(107)329691字號 不動產營業員</p></div></div>
<section class="contact-card"><p>0999-888-7770999-888-777</p></section>`;

const listing = {
  "@type": "RealEstateListing",
  offers: { "@type": "Offer", price: 45000, priceCurrency: "TWD" },
};

const place = {
  "@type": "Place",
  name: "測試店面",
  additionalProperty: [
    { "@type": "PropertyValue", name: "樓層", value: "1F/5F" },
    { "@type": "PropertyValue", name: "用途", value: "商業用" },
  ],
  address: { addressRegion: "台北市", addressLocality: "大同區", streetAddress: "大同區民樂街99號" },
  image: [
    "https://img1.591.com.tw/house/2026/07/20/111.jpg!1000x.water2.jpg",
    "https://img2.591.com.tw/house/2026/07/20/111.jpg!1000x.water2.jpg",
    "https://img2.591.com.tw/house/2026/07/20/222.jpg!1000x.water2.jpg",
    "https://img1.591.com.tw/house_refresh_ai/2026/07/20/333.jpg",
    "https://img1.591.com.tw/user/avatar/444.jpg",
    "https://images.591.com.tw/index/medium/no-photo-new.png",
  ],
};

const description = "台北市大同區店面出租：租金45000元/月，使用坪數24.333坪，位於大同區民樂街99號";

describe("parseListing", () => {
  it("reads the listing's own photos, rent, area and address from a 591 shop rental page", () => {
    const details = parseListing(page591([listing, place]), new URL("https://business.591.com.tw/rent/123"), description);
    expect(details).toEqual({
      title: "測試店面",
      contact: "",
      tags: {},
      photos: [
        "https://img1.591.com.tw/house/2026/07/20/111.jpg!1000x.water2.jpg",
        "https://img2.591.com.tw/house/2026/07/20/222.jpg!1000x.water2.jpg",
      ],
      rent: 45000,
      area: 24.33,
      address: "台北市大同區民樂街99號",
      floor: "1F/5F",
    });
  });

  it("reads only shop rental pages: sale and residential pages keep just their cover, and a sale price is never rent", () => {
    const none = { title: "", contact: "", tags: {}, photos: [], rent: null, area: null, address: "", floor: "" };
    expect(parseListing(page591([listing, place]), new URL("https://business.591.com.tw/sale/123"), "台北市大同區店面出售：總價5000萬")).toEqual(none);
    expect(parseListing(page591([listing, place]), new URL("https://rent.591.com.tw/123"), description)).toEqual(none);
  });

  it("leaves fields empty instead of failing when the page has no usable data", () => {
    const empty = { title: "", contact: "", tags: {}, photos: [], rent: null, area: null, address: "", floor: "" };
    expect(parseListing("<html><head></head></html>", new URL("https://business.591.com.tw/rent/1"), "")).toEqual(empty);
    expect(parseListing('<script type="application/ld+json">{not json</script>', new URL("https://business.591.com.tw/rent/1"), "")).toEqual(empty);
  });

  it("only reads structured data on 591, other sites keep just their cover image", () => {
    const details = parseListing(page591([listing, place]), new URL("https://www.example-realty.com.tw/rent/123"), description);
    expect(details).toEqual({ title: "", contact: "", tags: {}, photos: [], rent: null, area: null, address: "", floor: "" });
  });

  it("takes the title from the listing's structured data even when og:title only names the site", () => {
    const generic = page591([listing, { ...place, name: "#稀有釋出#可餐飲#可飲酒" }], "", "591房屋交易網 | 租屋買屋實價登錄資訊平台");
    const url = new URL("https://business.591.com.tw/rent/22383299");
    expect(parseMeta(generic, url).title).toBe("");
    expect(parseListing(generic, url, "").title).toBe("#稀有釋出#可餐飲#可飲酒");
    // Without Place.name, the RealEstateListing name is used without its site suffix; a generic one is ignored.
    const named = page591([{ ...listing, name: "測試金店面 | 店面出租 - 591房屋交易網" }]);
    expect(parseListing(named, url, "").title).toBe("測試金店面");
    expect(parseListing(page591([{ ...listing, name: "591房屋交易網" }]), url, "").title).toBe("");
  });

  it("reads the public agent card and the numbers written in the description, not the call button's number", () => {
    const url = new URL("https://business.591.com.tw/rent/1");
    expect(parseListing(page591([listing, place], contactHtml), url, "").contact).toBe("仲介 王測試｜測試不動產\n電話：0912-345-678\nLINE：@123abcd");
    expect(parseContact(contactHtml)).not.toContain("0999");
    // A name the card shortens (「京安國...」) is left out; an owner without a company is just role and name.
    expect(parseContact(contactHtml.replace("王測試", "測試國..."))).toMatch(/^仲介｜測試不動產/);
    expect(parseContact('<span class="name"><em>屋主:</em> 張先生</span>')).toBe("屋主 張先生");
    expect(parseContact("<p>沒有聯絡資料</p>")).toBe("");
  });

  it("reads store conditions the listing text states explicitly, with the words that decided them", () => {
    const url = new URL("https://business.591.com.tw/rent/1");
    const body = '<div class="article"><p>本店面可餐飲、可營登</p><p>不可飲酒</p><p>看起來是頂讓</p></div><section class="contact-card">可飲酒</section>';
    expect(parseListing(page591([listing, place], body), url, "").tags).toEqual({
      food: { value: true, evidence: "本店面可餐飲、可營登" },
      alcohol: { value: false, evidence: "不可飲酒" },
    });
  });
});

describe("generic site titles", () => {
  it("recognises names that only say 591 and our own fallback name", () => {
    for (const t of ["591", "591房屋交易網", "591房屋交易網 | 租屋買屋實價登錄資訊平台", "591租屋網", "來自 business.591.com.tw 的物件", "店面出租", ""]) {
      expect(isGenericTitle(t), t).toBe(true);
    }
    for (const t of ["#稀有釋出#可餐飲#可飲酒", "N66租忠孝復興站可餐飲東區商圈黃金店面", "SOGO百貨B1商場", "591巷口金店面"]) {
      expect(isGenericTitle(t), t).toBe(false);
    }
    expect(isGenericDescription("591房屋交易網是全台灣領先的房地產交易資訊平台之一, 提供新建案、中古屋、租屋、店面等交易資訊,每日90萬人在線找屋")).toBe(true);
    expect(isGenericDescription("台北市大安區店面出租：租金156000元/月，使用坪數50坪")).toBe(false);
  });
});

describe("listingKey", () => {
  it("gives every form of the same 591 listing one key, and none to other sites or share links", () => {
    const key = "591:business:22383299";
    expect(listingKey("https://business.591.com.tw/rent/22383299")).toBe(key);
    expect(listingKey("https://business.591.com.tw/rent/22383299?from=list")).toBe(key);
    expect(listingKey("http://business.591.com.tw/rent/22383299/")).toBe(key);
    expect(listingKey("https://line-liff.591.com.tw/redirect?url=https%3A%2F%2Fbusiness.591.com.tw%2Frent%2F22383299")).toBe(key);
    expect(listingKey("https://rent.591.com.tw/rent-detail-123.html")).toBe("591:rent:123");
    expect(listingKey("https://rent.591.com.tw/123")).toBe("591:rent:123");
    expect(listingKey("https://591.to/elOPc")).toBeNull();
    expect(listingKey("https://www.example.com/rent/22383299")).toBeNull();
    expect(listingKey("not a url")).toBeNull();
  });
});

describe("resolve591Share", () => {
  it("takes the listing link out of 591's app share redirect page", () => {
    const hop = new URL(
      "https://line-liff.591.com.tw/redirect?url=https%3A%2F%2Fbusiness.591.com.tw%2Frent%2F22383299&sid=abc&utm_source=%E5%85%B6%E4%BB%96",
    );
    expect(resolve591Share(hop).toString()).toBe("https://business.591.com.tw/rent/22383299");
  });

  it("leaves other links alone and never follows the hop to another site", () => {
    expect(resolve591Share(new URL("https://business.591.com.tw/rent/1")).toString()).toBe("https://business.591.com.tw/rent/1");
    const outside = new URL("https://line-liff.591.com.tw/redirect?url=https%3A%2F%2Fevil.example%2Fphish");
    expect(resolve591Share(outside).toString()).toBe(outside.toString());
    const fake = new URL("https://line-liff.591.com.tw.evil.example/redirect?url=https%3A%2F%2Fbusiness.591.com.tw%2Frent%2F1");
    expect(resolve591Share(fake).toString()).toBe(fake.toString());
  });
});
