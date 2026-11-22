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

/** A positive number typed in a form (「1,200」, or 「50坪」 when the unit is given). Blank is null; anything else is NaN. */
export function parseAmount(text: string, unit = ""): number | null {
  let t = text.replace(/[,\s]/g, "");
  if (unit && t.endsWith(unit)) t = t.slice(0, -unit.length);
  if (!t) return null;
  return /^\d+(?:\.\d+)?$/.test(t) && Number(t) > 0 ? Number(t) : NaN;
}

/** The exact stored rent in 萬 for the edit form (602,140 → 「60.214」), so saving unchanged keeps it. */
export function toWanInput(yuan: number | null): string {
  return yuan ? String(yuan / 10_000) : "";
}

/** 萬 typed in a form → whole 元. Blank is null; anything that is not a positive number is NaN. */
export function fromWanInput(text: string): number | null {
  const wan = parseAmount(text, "萬");
  return wan === null || Number.isNaN(wan) ? wan : Math.round(wan * 10_000);
}
