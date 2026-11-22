// Link health of an item's original listing, kept apart from the shareholders'
// four decision statuses. "gone" is only used when the site clearly says so;
// anything uncertain (blocked, challenged, timed out, errors) is "unknown".

import type { Item } from "./types";

export type Health = "unchecked" | "ok" | "gone" | "unknown";

export const HEALTH_LABEL: Record<Health, string> = {
  unchecked: "待檢查",
  ok: "正常",
  gone: "已失效",
  unknown: "無法確認",
};

export const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

export type PageResponse = {
  status: number | null;
  headers: Record<string, string | string[] | undefined>;
  body: string | null;
  error?: "timeout" | "network" | "blocked" | "redirects";
};

// Phrases that removed-listing pages show (591 and the sites in the research notes).
const REMOVED = ["物件找不到了", "物件已下架", "此物件已下架", "找不到物件", "找不到此物件", "物件不存在", "您訪問的頁面不存在", "頁面不存在", "找不到頁面"];

const ERROR_REASON: Record<NonNullable<PageResponse["error"]>, string> = {
  timeout: "逾時，網站沒有回應",
  network: "無法連線到網站",
  blocked: "無法讀取的位址",
  redirects: "轉址次數過多",
};

function removalPhrase(status: number, body: string): string | null {
  const title = body.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "";
  // A long, ordinary page may mention these words in passing, so only the title
  // counts there. Short pages (error stubs) and error statuses are read in full.
  const text = body.length <= 2000 || status !== 200 ? body : title;
  return REMOVED.find((p) => title.includes(p) || text.includes(p)) ?? null;
}

export function classifyHealth(res: PageResponse): { health: Health; reason: string } {
  if (res.error || res.status === null) return { health: "unknown", reason: ERROR_REASON[res.error ?? "network"] };
  const { status } = res;
  if (status === 404 || status === 410) return { health: "gone", reason: `${status}，刊登已不存在` };
  if (res.headers["cf-mitigated"] || res.headers["x-amzn-waf-action"] || status === 202) {
    return { health: "unknown", reason: "網站要求驗證（反機器人）" };
  }
  if (status === 401 || status === 403) return { health: "unknown", reason: `${status}，被網站阻擋` };
  if (status === 429) return { health: "unknown", reason: "429，網站限制請求次數" };
  if (status >= 500) return { health: "unknown", reason: `${status}，網站暫時錯誤` };
  if (status >= 300 && status < 400) return { health: "unknown", reason: `${status}，轉址異常` };
  const phrase = res.body ? removalPhrase(status, res.body) : null;
  if (phrase) return { health: "gone", reason: `頁面顯示「${phrase}」` };
  if (status === 200) return { health: "ok", reason: "正常" };
  return { health: "unknown", reason: `${status}，無法判斷` };
}

/** Due when it has a link, is not 不考慮 or in the recycle bin, and was not checked in the last 24 hours. */
export function isDueForCheck(item: Item, now: number): boolean {
  if (!item.sourceUrl || item.deletedAt || item.status === "rejected") return false;
  if (item.health === "unchecked" || !item.healthAt) return true;
  return now - Date.parse(item.healthAt) >= CHECK_INTERVAL_MS;
}
