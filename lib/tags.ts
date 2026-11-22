// Store-condition tags (可餐飲, 可飲酒, 頂讓) read only from explicit wording.
// Negations are 否; a sentence with hedged wording (看起來, 可能, 嗎, ？) or
// about past use (之前, 原本) decides nothing, neither does indirect wording
// (禁油煙), and a shareholder's setting always wins.

import type { AutoTag, Item, TagKey } from "./types";
import { TAG_KEYS } from "./types";

export const TAG_LABEL: Record<TagKey, string> = { food: "可餐飲", alcohol: "可飲酒", transfer: "頂讓" };

const RULES: Record<TagKey, { no: RegExp; yes: RegExp }> = {
  food: {
    no: /(?:不可|不得|禁止|嚴禁|禁|不能|無法|不允許|不接受)(?:以|做|作|經營|營業)?餐飲業?/g,
    yes: /可(?:以)?(?:做|作|經營)?餐飲|餐飲業?可(?![能否])|合法餐飲/g,
  },
  alcohol: {
    no: /(?:不可|不得|禁止|嚴禁|禁|不能|無法)(?:飲酒|喝酒|賣酒|售酒|販酒)/g,
    yes: /可(?:以)?(?:飲酒|喝酒|賣酒|售酒|販酒)|(?:飲酒|喝酒)可(?![能否])/g,
  },
  transfer: {
    no: /(?:無|不|免|非|不需|不用)頂讓/g,
    yes: /頂讓/g,
  },
};

const UNSURE = /看起來|可能|好像|應該|疑似|似乎|大概|也許|嗎|[?？]/;
const PAST = /之前|以前|原本|原為|前身|前租客|曾經|過去/;

/** Sentences that state each tag (yes) or rule it out (no). */
type Mentions = Record<TagKey, { yes: string[]; no: string[] }>;

function mentions(text: string): Mentions {
  const out = Object.fromEntries(TAG_KEYS.map((k) => [k, { yes: [] as string[], no: [] as string[] }])) as Mentions;
  // 🉑 is written for 可 (「🉑餐飲」). A sentence ends at a line break, 。；！？ or the ｜ titles use;
  // a hedge anywhere in it makes the whole sentence uncertain.
  for (const raw of text.replace(/🉑/g, "可").split(/(?<=[\n。；;！!？?｜|])/)) {
    const clause = raw.trim();
    if (!clause || UNSURE.test(clause) || PAST.test(clause)) continue;
    const evidence = clause.replace(/[｜|]$/, "").slice(0, 40);
    for (const key of TAG_KEYS) {
      const { no, yes } = RULES[key];
      // Negations are taken out first so 「不可餐飲」 can never match 「可餐飲」.
      const masked = clause.replace(no, (m) => {
        out[key].no.push(evidence);
        return " ".repeat(m.length);
      });
      if (new RegExp(yes.source).test(masked)) out[key].yes.push(evidence);
    }
  }
  return out;
}

/** Tags a text mentions; a text that says both yes and no is recorded as undecided (null). */
export function detectTags(text: string): Partial<Record<TagKey, AutoTag>> {
  const found = mentions(text);
  const tags: Partial<Record<TagKey, AutoTag>> = {};
  for (const key of TAG_KEYS) {
    const { yes, no } = found[key];
    if (yes.length && no.length) tags[key] = { value: null, evidence: `${yes[0]} ／ ${no[0]}` };
    else if (yes.length) tags[key] = { value: true, evidence: yes[0] };
    else if (no.length) tags[key] = { value: false, evidence: no[0] };
  }
  return tags;
}

export type TagView = {
  label: string;
  state: "yes" | "no" | "unknown";
  /** Set by a shareholder; then `by` names who. */
  manual?: boolean;
  source?: string;
  evidence?: string;
  by?: string;
  /** Sources disagree; a shareholder needs to decide. */
  conflict?: boolean;
};

/** Each tag's final state: the shareholder's setting, else what the item's own texts and the 591 listing say. */
export function tagsOf(item: Item): Record<TagKey, TagView> {
  const texts: [string, string][] = [
    ["標題", item.name],
    ["重要備註", item.note],
    ["物件資訊", item.info],
  ];
  const found = texts.map(([source, text]) => [source, mentions(text)] as const);
  const result = {} as Record<TagKey, TagView>;
  for (const key of TAG_KEYS) {
    const base = { label: TAG_LABEL[key] };
    const override = item.tagOverrides[key];
    if (override) {
      result[key] = { ...base, state: override.value ? "yes" : "no", manual: true, source: "股東填寫", by: override.by };
      continue;
    }
    const yes: [string, string][] = [];
    const no: [string, string][] = [];
    for (const [source, f] of found) {
      for (const e of f[key].yes) yes.push([source, e]);
      for (const e of f[key].no) no.push([source, e]);
    }
    const auto = item.autoTags[key];
    if (auto?.value === true) yes.push(["591 刊登內容", auto.evidence]);
    else if (auto?.value === false) no.push(["591 刊登內容", auto.evidence]);
    else if (auto) {
      // The listing text itself says both.
      yes.push(["591 刊登內容", auto.evidence]);
      no.push(["591 刊登內容", auto.evidence]);
    }
    if (yes.length && no.length) {
      result[key] = { ...base, state: "unknown", conflict: true, source: [...new Set([...yes, ...no].map(([s]) => s))].join("、"), evidence: `${yes[0][1]} ／ ${no[0][1]}` };
    } else if (yes.length) {
      result[key] = { ...base, state: "yes", source: yes[0][0], evidence: yes[0][1] };
    } else if (no.length) {
      result[key] = { ...base, state: "no", source: no[0][0], evidence: no[0][1] };
    } else {
      result[key] = { ...base, state: "unknown" };
    }
  }
  return result;
}

/** Labels of the tags confirmed as 是, for cards and the list. */
export function confirmedTags(item: Item): string[] {
  const tags = tagsOf(item);
  return TAG_KEYS.filter((k) => tags[k].state === "yes").map((k) => TAG_LABEL[k]);
}
