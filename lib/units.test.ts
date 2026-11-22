import { describe, expect, it } from "vitest";
import { formatArea, formatRent, fromWanInput, parseAmount, toWanInput } from "./units";

describe("rent in 萬元", () => {
  it("shows rent stored in 元 as 萬/月 with at most two decimals", () => {
    expect(formatRent(156000)).toBe("15.6萬/月");
    expect(formatRent(200000)).toBe("20萬/月");
    expect(formatRent(72000)).toBe("7.2萬/月");
    expect(formatRent(156500)).toBe("15.65萬/月");
    expect(formatRent(106800)).toBe("10.68萬/月");
    expect(formatRent(602000)).toBe("60.2萬/月");
    expect(formatRent(602140)).toBe("60.21萬/月");
  });

  it("says 未提供 instead of 0 when there is no rent", () => {
    expect(formatRent(null)).toBe("未提供");
    expect(formatRent(0)).toBe("未提供");
  });

  it("turns 萬 typed in the form into whole 元 without floating-point drift", () => {
    expect(fromWanInput("15.6")).toBe(156000);
    expect(fromWanInput("10.68")).toBe(106800);
    expect(fromWanInput(" 7.2 萬 ")).toBe(72000);
    expect(fromWanInput("1,200")).toBe(12000000);
    expect(fromWanInput("")).toBeNull();
    expect(fromWanInput("面議")).toBeNaN();
    expect(fromWanInput("-3")).toBeNaN();
  });

  it("fills the form with the exact stored value so saving unchanged keeps it", () => {
    expect(toWanInput(602140)).toBe("60.214");
    expect(toWanInput(106800)).toBe("10.68");
    expect(toWanInput(null)).toBe("");
    expect(fromWanInput(toWanInput(602140))).toBe(602140);
    expect(fromWanInput(toWanInput(156789))).toBe(156789);
  });
});

describe("parseAmount", () => {
  it("reads positive numbers typed with commas or the unit, and rejects anything else", () => {
    expect(parseAmount("40")).toBe(40);
    expect(parseAmount("1,200.5")).toBe(1200.5);
    expect(parseAmount("50坪", "坪")).toBe(50);
    expect(parseAmount("")).toBeNull();
    expect(parseAmount("大")).toBeNaN();
    expect(parseAmount("0")).toBeNaN();
  });
});

describe("area", () => {
  it("shows at most two decimals and 未提供 when missing", () => {
    expect(formatArea(50)).toBe("50坪");
    expect(formatArea(36.58)).toBe("36.58坪");
    expect(formatArea(24.333)).toBe("24.33坪");
    expect(formatArea(null)).toBe("未提供");
    expect(formatArea(0)).toBe("未提供");
  });
});
