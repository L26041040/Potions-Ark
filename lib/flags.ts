// 股東評價: flaws shareholders mark on an item with one tap. Two fixed levels,
// 重大缺點 (red) and 一般缺點 (orange). A name has one level across the whole
// site: presets use the level defined here, a custom label keeps the level it
// was first saved with. There is no separate list of labels; the custom labels
// are simply those some item uses, so an unused one disappears by itself.

import type { Flag, FlagLevel, Item } from "./types";

export const PRESET_FLAGS: { label: string; level: FlagLevel }[] = [
  { label: "太小", level: "major" },
  { label: "挑高太低", level: "major" },
  { label: "二樓以上", level: "major" },
  { label: "地下室", level: "minor" },
  { label: "租金太高", level: "minor" },
  { label: "頂讓金過高", level: "minor" },
  { label: "屋況差", level: "minor" },
  { label: "位置偏", level: "minor" },
];

export const FLAG_LEVEL_LABEL: Record<FlagLevel, string> = { major: "重大", minor: "一般" };

export const MAX_LABEL_LENGTH = 10;
export const MAX_FLAGS_PER_ITEM = 20;
export const MAX_CUSTOM_LABELS = 30;

/** Surrounding spaces removed and repeated spaces made one, so 「 太遠 」 is 「太遠」. */
export function normalizeLabel(raw: string): string {
  return raw.replace(/[\s　]+/g, " ").trim();
}

export type CatalogEntry = { label: string; level: FlagLevel; preset: boolean };

const PRESET_INDEX = new Map(PRESET_FLAGS.map((p, i) => [p.label, i]));

/**
 * The level each custom name has on the site: the earliest marking wins, so data
 * that somehow holds one name at two levels still reads one way everywhere.
 */
function customLevels(items: Item[]): Map<string, FlagLevel> {
  const earliest = new Map<string, Flag>();
  for (const flag of items.flatMap((i) => i.flags)) {
    if (PRESET_INDEX.has(flag.label)) continue;
    const seen = earliest.get(flag.label);
    if (!seen || flag.at < seen.at) earliest.set(flag.label, flag);
  }
  return new Map([...earliest].map(([label, flag]) => [label, flag.level]));
}

/** The labels to choose from: the presets, then the custom labels any item uses (recycle bin included), by name. */
export function flagCatalog(items: Item[]): CatalogEntry[] {
  const custom = [...customLevels(items)]
    .sort(([a], [b]) => a.localeCompare(b, "zh-Hant"))
    .map(([label, level]) => ({ label, level, preset: false }));
  return [...PRESET_FLAGS.map((p) => ({ ...p, preset: true })), ...custom];
}

/** Gives every flag its site-wide level (applied whenever the data is read). */
export function canonicalizeFlags(items: Item[]): Item[] {
  const custom = customLevels(items);
  for (const item of items) {
    for (const flag of item.flags) {
      const preset = PRESET_FLAGS[PRESET_INDEX.get(flag.label) ?? -1];
      const level = preset ? preset.level : custom.get(flag.label);
      if (level) flag.level = level;
    }
  }
  return items;
}

export type FlagChange =
  | { ok: true; changed: boolean; level?: FlagLevel; created?: boolean }
  | { ok: false; error: string };

/**
 * Selects (on) or unselects (off) a label on `item`, changing `item.flags` in
 * place. The wanted state is sent rather than a toggle, so two people never
 * undo each other into the opposite state. `items` is the whole site, read
 * fresh for this write: the level of an existing name is taken from it, so a
 * write retried after a conflict follows whatever was saved first.
 */
export function setFlag(items: Item[], item: Item, rawLabel: string, on: boolean, requested: FlagLevel, by: string, now: string): FlagChange {
  if (/[\r\n]/.test(rawLabel)) return { ok: false, error: "標籤名稱不能換行" };
  const label = normalizeLabel(rawLabel);
  if (!label) return { ok: false, error: "請輸入標籤名稱" };
  if ([...label].length > MAX_LABEL_LENGTH) return { ok: false, error: `標籤名稱最多 ${MAX_LABEL_LENGTH} 個字` };
  const current = item.flags.find((f) => f.label === label);

  if (!on) {
    if (!current) return { ok: true, changed: false };
    item.flags = item.flags.filter((f) => f !== current);
    return { ok: true, changed: true };
  }
  if (current) return { ok: true, changed: false, level: current.level };
  if (item.flags.length >= MAX_FLAGS_PER_ITEM) return { ok: false, error: `每個物件最多 ${MAX_FLAGS_PER_ITEM} 個評價標籤` };

  const preset = PRESET_FLAGS.find((p) => p.label === label);
  const custom = customLevels(items);
  const existing = preset?.level ?? custom.get(label);
  if (!existing && custom.size >= MAX_CUSTOM_LABELS) {
    return { ok: false, error: `自訂標籤最多 ${MAX_CUSTOM_LABELS} 種，請先取消不用的標籤` };
  }
  const level = existing ?? requested;
  item.flags = [...item.flags, { label, level, by, at: now }];
  return { ok: true, changed: true, level, created: !existing };
}

/** The message for the 「＋自訂」 form when the name already existed and was applied with its own level. */
export function existingLabelNotice(level: FlagLevel): string {
  return `已有此標籤（${FLAG_LEVEL_LABEL[level]}），已直接套用`;
}

/** 重大 first; within a level the presets in their order, then custom labels by name. */
export function sortFlags(flags: Flag[]): Flag[] {
  const rank = (f: Flag) => [f.level === "major" ? 0 : 1, PRESET_INDEX.get(f.label) ?? PRESET_FLAGS.length] as const;
  return [...flags].sort((a, b) => {
    const [la, pa] = rank(a);
    const [lb, pb] = rank(b);
    return la - lb || pa - pb || a.label.localeCompare(b.label, "zh-Hant");
  });
}

/** What a card or list row shows: the first two in display order and how many more there are. */
export function cardFlags(flags: Flag[], max = 2): { shown: Flag[]; more: number } {
  const sorted = sortFlags(flags);
  return { shown: sorted.slice(0, max), more: Math.max(0, sorted.length - max) };
}

export type FlagFilter = { hideMajor: boolean; flag: string | null };

/** 隱藏有重大缺點 keeps items nobody has rated; 只看有此標籤 keeps only items with that label. */
export function matchesFlagFilter(item: Item, q: FlagFilter): boolean {
  if (q.hideMajor && item.flags.some((f) => f.level === "major")) return false;
  if (q.flag !== null && !item.flags.some((f) => f.label === q.flag)) return false;
  return true;
}
