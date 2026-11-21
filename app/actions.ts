"use server";

import { randomBytes } from "node:crypto";
import { fetchPreview } from "@/lib/preview";
import { mutate, NO_WRITE, readDoc } from "@/lib/store";
import { isStatus, type ActionResult, type Doc, type Item, type ItemFields, type Status } from "@/lib/types";
import { cleanUrl, extractUrl, hostOf, nameFromText } from "@/lib/url";

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

export async function addFromPaste(pasted: unknown, nickname: unknown): Promise<ActionResult> {
  return run(async () => {
    const found = extractUrl(text(pasted, 4000));
    const url = found ? cleanUrl(found.url) : null;
    if (!found || !url) return { ok: false, error: "沒有找到網址，請改用「手動新增」" };
    const who = nick(nickname);

    const before = await readDoc();
    const dup = sameUrl(before, url);
    if (dup) return { ok: true, doc: before, id: dup.id, existing: true };

    const preview = await fetchPreview(url);
    const now = new Date().toISOString();
    const item: Item = {
      id: newId(),
      name: preview.title || nameFromText(found.rest) || `來自 ${hostOf(url)} 的物件`,
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
    const { doc, result } = await mutate((d) => {
      const existing = sameUrl(d, url);
      if (existing) return NO_WRITE;
      d.items.push(item);
      return item.id;
    });
    if (result === NO_WRITE) return { ok: true, doc, id: sameUrl(doc, url)?.id, existing: true };
    return { ok: true, doc, id: result, fetched: preview.fetched };
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
