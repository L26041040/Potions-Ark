// Merges rows of the shareholders' sheet into the shared document. Used once
// per sheet by Claude Code through /api/import; the sheet data itself is sent
// in the request and never stored in the repository.

import { randomBytes } from "node:crypto";
import { mapLimit } from "./concurrency";
import { applyRecord, findSameListing, type MergeOutcome } from "./merge";
import { isGenericDescription, isGenericTitle } from "./meta";
import { fetchPreview, type Preview } from "./preview";
import { isProblem, recordFromRow, type ImportRecord, type SheetRow } from "./sheet";
import { backupDoc, mutate, NO_WRITE, readDoc, type BackupInfo } from "./store";
import type { Doc } from "./types";

/** Rows per request; the caller splits a sheet into requests of this size. */
export const ROWS_PER_CALL = 8;

export type ImportRequest = {
  /** Names the backup taken before the first change; the same name keeps the first backup. */
  importId: string;
  /** Shown as the author of notes and status changes, e.g. 「11月試算表」. */
  by: string;
  /** One time for the whole sheet, so new items keep the sheet's order in the newest-first list. */
  startedAt?: string;
  /** Plan only: report what would happen without reading pages or writing. */
  dryRun?: boolean;
  rows: SheetRow[];
};

export type ImportResult = { ok: true; outcomes: MergeOutcome[]; backup?: BackupInfo; items: number } | { ok: false; error: string };

function newId(): string {
  return randomBytes(6).toString("base64url");
}

function readRequest(input: unknown): ImportRequest | string {
  const body = (input ?? {}) as Partial<ImportRequest>;
  if (typeof body.importId !== "string" || !/^[a-z0-9][a-z0-9-]{2,40}$/.test(body.importId)) return "importId 不正確";
  const by = typeof body.by === "string" ? body.by.replace(/\s+/g, " ").trim().slice(0, 20) : "";
  if (!by) return "請提供匯入者名稱";
  if (!Array.isArray(body.rows) || body.rows.length === 0 || body.rows.length > ROWS_PER_CALL) return `一次最多 ${ROWS_PER_CALL} 列`;
  const rows: SheetRow[] = [];
  for (const raw of body.rows) {
    const r = (raw ?? {}) as Partial<SheetRow>;
    if (typeof r.number !== "string" || typeof r.link !== "string" || !Array.isArray(r.cells)) return "列格式不正確";
    rows.push({ number: r.number.slice(0, 10), link: r.link.slice(0, 2000), cells: r.cells.slice(0, 10).map((c) => (typeof c === "string" ? c.slice(0, 5000) : "")) });
  }
  return { importId: body.importId, by, startedAt: typeof body.startedAt === "string" ? body.startedAt : undefined, dryRun: body.dryRun === true, rows };
}

/** Within a day of now, or now: a bad clock in the request cannot reorder the list. */
function baseTime(startedAt: string | undefined): number {
  const now = Date.now();
  const t = startedAt ? Date.parse(startedAt) : NaN;
  return Number.isFinite(t) && Math.abs(t - now) < 86_400_000 ? t : now;
}

function isShareLink(url: string): boolean {
  try {
    return /(^|\.)591\.to$/.test(new URL(url).hostname);
  } catch {
    return false;
  }
}

/** Share links (591.to) saved on items, resolved to the listing they point to. */
async function resolveShareLinks(doc: Doc): Promise<{ resolved: Map<string, string>; unresolved: string[] }> {
  const shared = doc.items.filter((i) => isShareLink(i.sourceUrl));
  const resolved = new Map<string, string>();
  await mapLimit(shared, 3, async (item) => {
    const preview = await fetchPreview(item.sourceUrl);
    if (preview.listingUrl) resolved.set(item.id, preview.listingUrl);
  });
  return { resolved, unresolved: shared.filter((i) => !resolved.has(i.id)).map((i) => i.sourceUrl) };
}

export async function importRows(input: unknown): Promise<ImportResult> {
  const request = readRequest(input);
  if (typeof request === "string") return { ok: false, error: request };

  const parsed = request.rows.map(recordFromRow);
  const records = parsed.filter((r): r is ImportRecord => !isProblem(r));
  const failed: MergeOutcome[] = parsed.filter(isProblem).map((p) => ({ ref: p.ref, result: p.blank ? "skipped" : "failed", error: p.error }));

  const before = await readDoc();
  const { resolved, unresolved } = await resolveShareLinks(before);
  // An unresolved share link might be one of the sheet's listings; importing anyway could duplicate it.
  if (unresolved.length && !request.dryRun) {
    return { ok: false, error: `有 ${unresolved.length} 個 591 分享連結暫時無法解析（${unresolved.join("、")}），為避免重複，這批沒有匯入` };
  }
  const base = baseTime(request.startedAt);
  const createdAt = (r: ImportRecord) => new Date(base + Math.max(0, 1000 - r.order)).toISOString();

  if (request.dryRun) {
    const plan = structuredClone(before);
    const now = new Date().toISOString();
    const outcomes = records.map((r) => applyRecord(plan, r, { by: request.by, now, createdAt: createdAt(r), newId, resolved }));
    return { ok: true, outcomes: [...failed, ...outcomes], items: plan.items.length };
  }

  const backup = await backupDoc(request.importId);

  // Pages are read for new items, items never checked and items still showing 591's site-wide
  // name or description; everything else is left alone so a re-run changes nothing.
  const toRead = records.filter((r) => {
    const item = findSameListing(before.items, r.sourceUrl, { includeDeleted: true, resolved });
    return !item || item.health === "unchecked" || isGenericTitle(item.name) || isGenericDescription(item.info);
  });
  const pages = new Map<string, Preview>();
  await mapLimit(toRead, 4, async (r) => {
    pages.set(r.sourceUrl, await fetchPreview(r.sourceUrl));
  });

  let outcomes: MergeOutcome[] = [];
  const { doc } = await mutate((d) => {
    // Rebuilt on every attempt: mutate() re-runs this after a write conflict.
    const now = new Date().toISOString();
    outcomes = records.map((r) => applyRecord(d, r, { by: request.by, now, createdAt: createdAt(r), newId, resolved, page: pages.get(r.sourceUrl) }));
    return outcomes.some((o) => o.result === "added" || o.result === "merged") ? true : NO_WRITE;
  });
  return { ok: true, outcomes: [...failed, ...outcomes], backup, items: doc.items.length };
}
