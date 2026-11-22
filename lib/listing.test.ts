import { describe, expect, it } from "vitest";
import { parseListing } from "./listing";

// Hand-written page shaped like a 591 shop rental page (values are made up).
function page591(graph: unknown[]): string {
  return `<html><head><title>測試店面 | 店面出租 - 591房屋交易網</title>
<script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@graph": graph })}</script>
</head><body><span class="deposit">押金二個月</span></body></html>`;
}

const listing = {
  "@type": "RealEstateListing",
  offers: { "@type": "Offer", price: 45000, priceCurrency: "TWD" },
};

const place = {
  "@type": "Place",
  name: "測試店面",
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
      photos: [
        "https://img1.591.com.tw/house/2026/07/20/111.jpg!1000x.water2.jpg",
        "https://img2.591.com.tw/house/2026/07/20/222.jpg!1000x.water2.jpg",
      ],
      rent: 45000,
      area: 24.33,
      address: "台北市大同區民樂街99號",
    });
  });

  it("does not take a sale price as monthly rent", () => {
    const details = parseListing(page591([listing, place]), new URL("https://business.591.com.tw/sale/123"), "台北市大同區店面出售：總價5000萬");
    expect(details.rent).toBeNull();
    expect(details.photos).toHaveLength(2);
  });

  it("leaves fields empty instead of failing when the page has no usable data", () => {
    const empty = { photos: [], rent: null, area: null, address: "" };
    expect(parseListing("<html><head></head></html>", new URL("https://business.591.com.tw/rent/1"), "")).toEqual(empty);
    expect(parseListing('<script type="application/ld+json">{not json</script>', new URL("https://business.591.com.tw/rent/1"), "")).toEqual(empty);
  });

  it("only reads structured data on 591, other sites keep just their cover image", () => {
    const details = parseListing(page591([listing, place]), new URL("https://www.example-realty.com.tw/rent/123"), description);
    expect(details).toEqual({ photos: [], rent: null, area: null, address: "" });
  });
});
