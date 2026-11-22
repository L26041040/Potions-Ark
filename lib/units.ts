// Rent is stored in 元 and shown and edited in 萬元; area is shown with at most
// two decimals. Missing values read 「未提供」, never 0.

export const NOT_GIVEN = "未提供";

function trim2(n: number): string {
  return String(Math.round(n * 100) / 100);
}

/** 156,000 → 「15.6萬/月」. */
export function formatRent(yuan: number | null): string {
  return yuan ? `${trim2(yuan / 10_000)}萬/月` : NOT_GIVEN;
}

/** 50 → 「50坪」. */
export function formatArea(area: number | null): string {
  return area ? `${trim2(area)}坪` : NOT_GIVEN;
}

/** The exact stored rent in 萬 for the edit form (602,140 → 「60.214」), so saving unchanged keeps it. */
export function rentInput(yuan: number | null): string {
  return yuan ? String(yuan / 10_000) : "";
}

/** 萬 typed in a form → whole 元. Blank is null; anything that is not a positive number is NaN. */
export function parseWan(text: string): number | null {
  const t = text.replace(/[,\s]/g, "").replace(/萬$/, "");
  if (!t) return null;
  if (!/^\d+(?:\.\d+)?$/.test(t) || Number(t) <= 0) return NaN;
  return Math.round(Number(t) * 10_000);
}
