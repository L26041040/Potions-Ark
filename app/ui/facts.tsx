import { zoneOf } from "@/lib/compare";
import { confirmedTags } from "@/lib/tags";
import type { Item } from "@/lib/types";
import { formatArea, formatRent, NOT_GIVEN } from "@/lib/units";

// The key numbers shown the same way on cards, list rows and the detail panel.

function Value({ fact, text, className }: { fact: string; text: string; className: string }) {
  return (
    <span data-fact={fact} className={text === NOT_GIVEN ? "font-normal text-stone-400" : className}>
      {text}
    </span>
  );
}

/** Rent and area, the two numbers to compare first. */
export function KeyNumbers({ item, big }: { item: Item; big?: boolean }) {
  return (
    <span className="flex flex-wrap items-baseline gap-x-2">
      <Value fact="rent" text={formatRent(item.rent)} className={`${big ? "text-base" : "text-sm"} font-semibold text-stone-900`} />
      <Value fact="area" text={formatArea(item.area)} className={`${big ? "text-base" : "text-sm"} font-semibold text-stone-900`} />
    </span>
  );
}

/** Floor and 商圈／區域. */
export function PlaceFacts({ item }: { item: Item }) {
  return (
    <span className="flex min-w-0 flex-wrap gap-x-2 text-xs text-stone-600">
      <span>
        樓層 <Value fact="floor" text={item.floor || NOT_GIVEN} className="" />
      </span>
      <span>
        商圈 <Value fact="zone" text={zoneOf(item).value || NOT_GIVEN} className="" />
      </span>
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
