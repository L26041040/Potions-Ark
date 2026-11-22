"use server";

import { randomBytes } from "node:crypto";
import { fetchPreview, type Preview } from "@/lib/preview";
import { removePhotos } from "@/lib/photos";
import { mapLimit } from "@/lib/concurrency";
import { isDueForCheck } from "@/lib/health";
import { findSameListing, itemFromPage } from "@/lib/merge";
import { isGenericDescription, isGenericTitle } from "@/lib/meta";
import { tidyContact } from "@/lib/contact";
import { mutate, NO_WRITE, readDoc } from "@/lib/store";
import {
  isStatus,
  MANUAL_FIELDS,
  TAG_KEYS,
  type ActionResult,
  type AddOutcome,
  type Doc,
  type Item,
  type ItemFields,
  type LinkCheck,
  type Photo,
  type Status,
  type TagKey,
} from "@/lib/types";
import { cleanUrl, nameFromText } from "@/lib/url";

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

/** An item outside the recycle bin with the same link or the same 591 listing. */
function sameUrl(doc: Doc, url: string): Item | undefined {
  return findSameListing(doc.items, url, { includeDeleted: false });
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

function linkCheck(preview: Preview, at: string): LinkCheck {
  return { health: preview.health, healthAt: at, healthReason: preview.healthReason };
}

const UNCHECKED: LinkCheck = { health: "unchecked", healthAt: null, healthReason: "" };

function listingPhotos(urls: string[]): Photo[] {
  return urls.map((url) => ({ id: newId(), source: "listing", url }));
}

function newItem(url: string, name: string, preview: Preview, who: string, now: string): Item {
  return itemFromPage(newId(), url, name, preview, who, now, newId);
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
    // Rebuilt on every attempt: mutate() re-runs this callback after a write conflict.
    let decided: AddOutcome[] = [];
    const { doc } = await mutate((d) => {
      decided = [];
      for (const c of candidates) {
        const preview = previews.get(c.url);
        // A share link (591.to) is saved as the listing it points to, so it matches the web link too.
        const listingUrl = (preview?.listingUrl && cleanUrl(preview.listingUrl)) || c.url;
        const existing = sameUrl(d, c.url) ?? sameUrl(d, listingUrl);
        if (existing || !preview) {
          decided.push({ url: c.url, result: "duplicate", id: existing?.id });
          continue;
        }
        const item = newItem(listingUrl, c.name, preview, who, now);
        d.items.push(item);
        decided.push({ url: c.url, result: "added", id: item.id, needsFill: !preview.fetched });
      }
      return decided.some((o) => o.result === "added") ? true : NO_WRITE;
    });
    return { ok: true, doc, outcomes: [...outcomes, ...decided] };
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
    floor: text(input.floor, 40),
    contact: tidyContact(text(input.contact, 2000)),
    zone: text(input.zone, 40),
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
    const manual = MANUAL_FIELDS.filter((f) => fields[f] !== "" && fields[f] !== null);
    const { doc } = await mutate((d) => {
      d.items.push({
        id,
        ...fields,
        manual,
        tagOverrides: {},
        autoTags: {},
        photos: [],
        ...UNCHECKED,
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
      const relink = item.sourceUrl !== fields.sourceUrl ? UNCHECKED : {};
      // Fields changed by hand are never overwritten by a later page read.
      const edited = MANUAL_FIELDS.filter((f) => item[f] !== fields[f]);
      const manual = [...new Set([...item.manual, ...edited])];
      Object.assign(item, fields, relink, { manual, updatedAt: new Date().toISOString() });
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
 * list (uploads are kept); facts only fill fields that are still empty. A name
 * or information that only names the site (「591房屋交易網」) is corrected; a
 * name a shareholder typed is kept. When the page cannot be read, nothing but
 * the link check changes.
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
        Object.assign(findItem(d, id), linkCheck(preview, checkedAt));
        return true;
      });
      return { ok: false, error: `讀不到原始網頁的資料（${preview.healthReason}），照片與資訊未變更`, doc };
    }
    const { doc } = await mutate((d) => {
      const item = findItem(d, id);
      Object.assign(item, linkCheck(preview, checkedAt));
      // A saved share link (591.to) is replaced by the listing it points to, unless another item already has it.
      const listingUrl = preview.listingUrl ? cleanUrl(preview.listingUrl) : null;
      if (listingUrl && listingUrl !== item.sourceUrl && !sameUrl(d, listingUrl)) item.sourceUrl = listingUrl;
      const uploads = item.photos.filter((p) => p.source === "upload");
      item.photos = [...(preview.photos.length ? listingPhotos(preview.photos) : item.photos.filter((p) => p.source === "listing")), ...uploads];
      if (preview.title && preview.title !== item.name && (isGenericTitle(item.name) || !item.manual.includes("name"))) {
        item.name = preview.title;
      }
      if (isGenericDescription(item.info)) item.info = "";
      if (!item.coverUrl && preview.image) item.coverUrl = preview.image;
      if (!item.info && preview.description) item.info = preview.description;
      if (!item.contact && preview.contact) item.contact = preview.contact;
      // Tags read from the listing are refreshed; shareholders' settings (tagOverrides) are never touched.
      item.autoTags = preview.tags;
      if (!item.address && preview.address) item.address = preview.address;
      if (item.rent === null && preview.rent !== null) item.rent = preview.rent;
      if (item.area === null && preview.area !== null) item.area = preview.area;
      if (!item.floor && preview.floor) item.floor = preview.floor;
      item.updatedAt = new Date().toISOString();
      return true;
    });
    return { ok: true, doc };
  });
}

/** Sets a store-condition tag to 是 (true) or 否 (false), or hands it back to automatic reading (null). */
export async function setTag(id: unknown, key: unknown, value: unknown, nickname: unknown): Promise<ActionResult> {
  return run(async () => {
    if (!TAG_KEYS.includes(key as TagKey)) return { ok: false, error: "條件不正確" };
    if (value !== true && value !== false && value !== null) return { ok: false, error: "條件不正確" };
    const who = nick(nickname);
    const { doc } = await mutate((d) => {
      const item = findItem(d, id);
      const tag = key as TagKey;
      const current = item.tagOverrides[tag];
      if (value === null ? !current : current?.value === value) return NO_WRITE;
      const next = { ...item.tagOverrides };
      if (value === null) delete next[tag];
      else next[tag] = { value, by: who, at: new Date().toISOString() };
      item.tagOverrides = next;
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
        Object.assign(item, linkCheck(preview, checkedAt));
        changed = true;
      }
      return changed ? true : NO_WRITE;
    });
    return { ok: true, doc };
  });
}
