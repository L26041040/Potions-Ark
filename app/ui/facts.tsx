import { zoneOf } from "@/lib/compare";
import { cardFlags, sortFlags } from "@/lib/flags";
import { confirmedTags } from "@/lib/tags";
import type { FlagLevel, Item } from "@/lib/types";
import { formatArea, formatRent, NOT_GIVEN } from "@/lib/units";

// The key facts, worked out once and shown the same way on cards, list rows and the detail panel.

/** Display text for rent, area, floor and 商圈／區域; 「未提供」 when missing. */
export function factTexts(item: Item) {
  return {
    rent: formatRent(item.rent),
    area: formatArea(item.area),
    floor: item.floor || NOT_GIVEN,
    zone: zoneOf(item).value || NOT_GIVEN,
  };
}

function Value({ fact, text, className }: { fact: string; text: string; className: string }) {
  return (
    <span data-fact={fact} className={text === NOT_GIVEN ? "font-normal text-stone-400" : className}>
      {text}
    </span>
  );
}

/** Rent and area, the two numbers to compare first. */
export function KeyNumbers({ item, big }: { item: Item; big?: boolean }) {
  const f = factTexts(item);
  const style = `${big ? "text-base" : "text-sm"} font-semibold text-stone-900`;
  return (
    <span className="flex flex-wrap items-baseline gap-x-2">
      <Value fact="rent" text={f.rent} className={style} />
      <Value fact="area" text={f.area} className={style} />
    </span>
  );
}

/** Floor and 商圈／區域. */
export function PlaceFacts({ item }: { item: Item }) {
  const f = factTexts(item);
  return (
    <span className="flex min-w-0 flex-wrap gap-x-2 text-xs text-stone-600">
      <span>
        樓層 <Value fact="floor" text={f.floor} className="" />
      </span>
      <span>
        商圈 <Value fact="zone" text={f.zone} className="" />
      </span>
    </span>
  );
}

export const FLAG_RING: Record<FlagLevel, string> = { major: "text-rose-700 ring-rose-500", minor: "text-orange-700 ring-orange-400" };

/** 股東評價 on cards and list rows: 重大 first, two at most, the rest as +N, on one line. */
export function FlagChips({ item }: { item: Item }) {
  const { shown, more } = cardFlags(item.flags);
  if (!shown.length) return null;
  return (
    <span
      className="flex min-w-0 flex-nowrap items-center gap-1 overflow-hidden px-px py-px"
      data-flags={sortFlags(item.flags).map((f) => f.label).join("、")}
    >
      <span className="sr-only">股東評價：</span>
      {shown.map((f) => (
        <span
          key={f.label}
          title={f.label}
          data-flag={f.level}
          className={`min-w-0 max-w-[7rem] truncate rounded-full bg-white px-1.5 py-px text-[11px] font-medium ring-1 ${FLAG_RING[f.level]}`}
        >
          {f.label}
        </span>
      ))}
      {more > 0 && (
        <span data-flag="more" className="shrink-0 rounded-full bg-stone-100 px-1.5 py-px text-[11px] text-stone-600">
          +{more}
        </span>
      )}
    </span>
  );
}

/** Store conditions confirmed as 是. */
export function TagChips({ item }: { item: Item }) {
  const tags = confirmedTags(item);
  if (!tags.length) return null;
  return (
    <span className="flex flex-wrap gap-1" data-fact="tags">
      {tags.map((t) => (
        <span key={t} className="rounded-full bg-emerald-50 px-1.5 py-px text-[11px] font-medium text-emerald-800 ring-1 ring-emerald-200">
          {t}
        </span>
      ))}
    </span>
  );
}
