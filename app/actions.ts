"use server";

import { randomBytes } from "node:crypto";
import { fetchPreview, type Preview } from "@/lib/preview";
import { removePhotos } from "@/lib/photos";
import { isDueForCheck } from "@/lib/health";
import { mutate, NO_WRITE, readDoc } from "@/lib/store";
import { isStatus, type ActionResult, type AddOutcome, type Doc, type Item, type ItemFields, type Photo, type Status } from "@/lib/types";
import { cleanUrl, hostOf, nameFromText } from "@/lib/url";

// No login: every visitor may read and write. Inputs are still validated and
// trimmed so a bad request cannot corrupt the shared document.

function newId(): string {
  return randomBytes(6).toString("base64url");
}

function nick(value: unknown): string {
  const text = typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, 20) : "";
  return text || "匿名";
}

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function optionalUrl(value: unknown): string {
  const raw = text(value, 2000);
  return raw ? cleanUrl(raw) ?? "" : "";
}

function findItem(doc: Doc, id: unknown): Item {
  const item = doc.items.find((i) => i.id === id);
  if (!item) throw new Error("找不到這個物件，請重新整理");
  return item;
}

function sameUrl(doc: Doc, url: string): Item | undefined {
  return doc.items.find((i) => !i.deletedAt && i.sourceUrl === url);
}

async function run(work: () => Promise<ActionResult>): Promise<ActionResult> {
  try {
    return await work();
  } catch (error) {
    console.error(error);
    const message = error instanceof Error ? error.message : "";
    return { ok: false, error: /[一-鿿]/.test(message) ? message : "儲存失敗，請稍後再試" };
  }
}

export async function loadDoc(): Promise<ActionResult> {
  return run(async () => ({ ok: true, doc: await readDoc() }));
}

/** Links sent per call. The browser splits any number of links into calls of this size. */
const URLS_PER_CALL = 8;
const FETCH_CONCURRENCY = 4;

async function mapLimit<T, R>(items: T[], limit: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await work(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

function listingPhotos(urls: string[]): Photo[] {
  return urls.map((url) => ({ id: newId(), source: "listing", url }));
}

function newItem(url: string, name: string, preview: Preview, who: string, now: string): Item {
  return {
    id: newId(),
    name: preview.title || name || `來自 ${hostOf(url)} 的物件`,
    sourceUrl: url,
    coverUrl: preview.image,
    info: preview.description,
    address: preview.address,
    rent: preview.rent,
    area: preview.area,
    photos: listingPhotos(preview.photos),
    embed: preview.embed,
    health: preview.health,
    healthAt: now,
    healthReason: preview.healthReason,
    status: "new",
    note: "",
    noteBy: "",
    noteAt: null,
    createdBy: who,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    deletedBy: "",
  };
}

/**
 * Adds a small batch of links: pages are read a few at a time, then the whole
 * batch is written once. Duplicates are decided at write time, so sending the
 * same links again after an interruption never creates a second item.
 */
export async function addUrls(input: unknown, nickname: unknown): Promise<ActionResult> {
  return run(async () => {
    if (!Array.isArray(input) || input.length === 0 || input.length > URLS_PER_CALL) {
      return { ok: false, error: "一次最多送出 " + URLS_PER_CALL + " 個網址，請重新整理後再試" };
    }
    const who = nick(nickname);
    const outcomes: AddOutcome[] = [];
    const candidates: { url: string; name: string }[] = [];
    for (const entry of input) {
      const raw = text((entry as { url?: unknown })?.url, 2000);
      const url = raw ? cleanUrl(raw) : null;
      if (!url) outcomes.push({ url: raw, result: "failed", error: "網址無效" });
      else candidates.push({ url, name: nameFromText(text((entry as { name?: unknown })?.name, 400)) });
    }

    const before = await readDoc();
    const toFetch = candidates.filter((c) => !sameUrl(before, c.url));
    const previews = new Map<string, Preview>();
    await mapLimit(toFetch, FETCH_CONCURRENCY, async (c) => {
      previews.set(c.url, await fetchPreview(c.url));
    });

    const now = new Date().toISOString();
    const { doc } = await mutate((d) => {
      const decided: AddOutcome[] = [];
      for (const c of candidates) {
        const existing = sameUrl(d, c.url);
        const preview = previews.get(c.url);
        if (existing || !preview) {
          decided.push({ url: c.url, result: "duplicate", id: existing?.id });
          continue;
        }
        const item = newItem(c.url, c.name, preview, who, now);
        d.items.push(item);
        decided.push({ url: c.url, result: "added", id: item.id, needsFill: !preview.fetched });
      }
      outcomes.push(...decided);
      return decided.some((o) => o.result === "added") ? true : NO_WRITE;
    });
    return { ok: true, doc, outcomes };
  });
}

function readFields(input: Partial<ItemFields>): ItemFields {
  const sourceUrl = optionalUrl(input.sourceUrl);
  return {
    name: text(input.name, 120),
    sourceUrl,
    coverUrl: optionalUrl(input.coverUrl),
    info: text(input.info, 500),
    address: text(input.address, 200),
    rent: positiveNumber(input.rent, 100_000_000),
    area: positiveNumber(input.area, 100_000),
    embed: typeof input.embed === "boolean" ? input.embed : sourceUrl.startsWith("https:"),
  };
}

function positiveNumber(value: unknown, max: number): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value.replace(/,/g, "")) : NaN;
  return Number.isFinite(n) && n > 0 && n <= max ? Math.round(n * 100) / 100 : null;
}

export async function addManual(input: Partial<ItemFields>, nickname: unknown): Promise<ActionResult> {
  return run(async () => {
    const fields = readFields(input ?? {});
    if (!fields.name) return { ok: false, error: "請填寫名稱" };
    const now = new Date().toISOString();
    const id = newId();
    const { doc } = await mutate((d) => {
      d.items.push({
        id,
        ...fields,
        photos: [],
        health: "unchecked",
        healthAt: null,
        healthReason: "",
        status: "new",
        note: "",
        noteBy: "",
        noteAt: null,
        createdBy: nick(nickname),
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
        deletedBy: "",
      });
      return id;
    });
    return { ok: true, doc, id };
  });
}

export async function updateItem(id: unknown, input: Partial<ItemFields>): Promise<ActionResult> {
  return run(async () => {
    const fields = readFields(input ?? {});
    if (!fields.name) return { ok: false, error: "名稱不能空白" };
    const { doc } = await mutate((d) => {
      const item = findItem(d, id);
      // A changed link has not been checked yet.
      const relink = item.sourceUrl !== fields.sourceUrl ? { health: "unchecked" as const, healthAt: null, healthReason: "" } : {};
      Object.assign(item, fields, relink, { updatedAt: new Date().toISOString() });
      return true;
    });
    return { ok: true, doc };
  });
}

export async function setStatus(id: unknown, status: unknown, nickname: unknown): Promise<ActionResult> {
  return run(async () => {
    if (!isStatus(status)) return { ok: false, error: "狀態不正確" };
    const who = nick(nickname);
    const { doc } = await mutate((d) => {
      const item = findItem(d, id);
      if (item.status === status) return NO_WRITE;
      const now = new Date().toISOString();
      d.entries.push({
        id: newId(),
        itemId: item.id,
        kind: "status",
        body: "",
        from: item.status,
        to: status as Status,
        nickname: who,
        createdAt: now,
      });
      item.status = status;
      item.updatedAt = now;
      return true;
    });
    return { ok: true, doc };
  });
}

export async function saveNote(id: unknown, note: unknown, nickname: unknown): Promise<ActionResult> {
  return run(async () => {
    const value = text(note, 5000);
    const who = nick(nickname);
    const { doc } = await mutate((d) => {
      const item = findItem(d, id);
      const now = new Date().toISOString();
      Object.assign(item, { note: value, noteBy: who, noteAt: now, updatedAt: now });
      return true;
    });
    return { ok: true, doc };
  });
}

export async function addComment(id: unknown, body: unknown, nickname: unknown): Promise<ActionResult> {
  return run(async () => {
    const value = text(body, 2000);
    if (!value) return { ok: false, error: "留言不能空白" };
    const who = nick(nickname);
    const { doc } = await mutate((d) => {
      const item = findItem(d, id);
      d.entries.push({
        id: newId(),
        itemId: item.id,
        kind: "comment",
        body: value,
        from: null,
        to: null,
        nickname: who,
        createdAt: new Date().toISOString(),
      });
      return true;
    });
    return { ok: true, doc };
  });
}

export async function setDeleted(id: unknown, deleted: unknown, nickname: unknown): Promise<ActionResult> {
  return run(async () => {
    const who = nick(nickname);
    const { doc } = await mutate((d) => {
      const item = findItem(d, id);
      if (deleted === true) {
        if (item.deletedAt) return NO_WRITE;
        item.deletedAt = new Date().toISOString();
        item.deletedBy = who;
      } else {
        if (!item.deletedAt) return NO_WRITE;
        item.deletedAt = null;
        item.deletedBy = "";
      }
      return true;
    });
    return { ok: true, doc };
  });
}

/**
 * Reads the original listing again. Listing photos are replaced by the fresh
 * list (uploads are kept); facts only fill fields that are still empty.
 */
export async function refetchItem(id: unknown): Promise<ActionResult> {
  return run(async () => {
    const current = findItem(await readDoc(), id);
    if (!current.sourceUrl) return { ok: false, error: "這個物件沒有原始網址" };
    const preview = await fetchPreview(current.sourceUrl);
    const checkedAt = new Date().toISOString();
    if (!preview.fetched) {
      // Photos and facts stay as they were; the link check itself is still recorded.
      const { doc } = await mutate((d) => {
        Object.assign(findItem(d, id), { health: preview.health, healthAt: checkedAt, healthReason: preview.healthReason });
        return true;
      });
      return { ok: false, error: `讀不到原始網頁的資料（${preview.healthReason}），照片與資訊未變更`, doc };
    }
    const { doc } = await mutate((d) => {
      const item = findItem(d, id);
      Object.assign(item, { health: preview.health, healthAt: checkedAt, healthReason: preview.healthReason });
      const uploads = item.photos.filter((p) => p.source === "upload");
      item.photos = [...(preview.photos.length ? listingPhotos(preview.photos) : item.photos.filter((p) => p.source === "listing")), ...uploads];
      if (!item.coverUrl && preview.image) item.coverUrl = preview.image;
      if (!item.info && preview.description) item.info = preview.description;
      if (!item.address && preview.address) item.address = preview.address;
      if (item.rent === null && preview.rent !== null) item.rent = preview.rent;
      if (item.area === null && preview.area !== null) item.area = preview.area;
      item.embed = preview.embed;
      item.updatedAt = new Date().toISOString();
      return true;
    });
    return { ok: true, doc };
  });
}

/** Deletes a photo a shareholder uploaded. Listing photos cannot be deleted. */
export async function deleteUpload(itemId: unknown, photoId: unknown): Promise<ActionResult> {
  return run(async () => {
    let removed: Photo | undefined;
    const { doc } = await mutate((d) => {
      const item = findItem(d, itemId);
      removed = item.photos.find((p) => p.id === photoId && p.source === "upload");
      if (!removed) return NO_WRITE;
      item.photos = item.photos.filter((p) => p !== removed);
      item.updatedAt = new Date().toISOString();
      return true;
    });
    if (removed?.pathname) await removePhotos([removed.pathname]).catch((e) => console.error("photo delete failed", e));
    return { ok: true, doc };
  });
}

const CHECKS_PER_CALL = 8;

/**
 * Re-checks the links of items that are due (24 hours since the last check,
 * not 不考慮, not in the recycle bin). Called in the background when someone
 * opens the warehouse; there is no schedule. One write per call.
 */
export async function recheckLinks(ids: unknown): Promise<ActionResult> {
  return run(async () => {
    if (!Array.isArray(ids) || ids.length === 0 || ids.length > CHECKS_PER_CALL) {
      return { ok: false, error: "檢查清單不正確" };
    }
    const now = Date.now();
    const before = await readDoc();
    const due = before.items.filter((i) => ids.includes(i.id) && isDueForCheck(i, now));
    if (!due.length) return { ok: true, doc: before };
    const results = new Map<string, Preview>();
    await mapLimit(due, 3, async (item) => {
      results.set(item.id, await fetchPreview(item.sourceUrl));
    });
    const checkedAt = new Date().toISOString();
    const { doc } = await mutate((d) => {
      let changed = false;
      for (const item of d.items) {
        const preview = results.get(item.id);
        // Someone else may have checked it meanwhile; then keep theirs.
        if (!preview || !isDueForCheck(item, now)) continue;
        Object.assign(item, { health: preview.health, healthAt: checkedAt, healthReason: preview.healthReason });
        changed = true;
      }
      return changed ? true : NO_WRITE;
    });
    return { ok: true, doc };
  });
}
