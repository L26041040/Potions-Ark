"use server";

import { randomBytes } from "node:crypto";
import { fetchPreview, type Preview } from "@/lib/preview";
import { mutate, NO_WRITE, readDoc } from "@/lib/store";
import { isStatus, type ActionResult, type AddOutcome, type Doc, type Item, type ItemFields, type Status } from "@/lib/types";
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

function newItem(url: string, name: string, preview: Preview, who: string, now: string): Item {
  return {
    id: newId(),
    name: preview.title || name || `來自 ${hostOf(url)} 的物件`,
    sourceUrl: url,
    coverUrl: preview.image,
    info: preview.description,
    address: "",
    embed: preview.embed,
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
    embed: typeof input.embed === "boolean" ? input.embed : sourceUrl.startsWith("https:"),
  };
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
      Object.assign(findItem(d, id), fields, { updatedAt: new Date().toISOString() });
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
