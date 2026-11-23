import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { BlobError, BlobPreconditionFailedError, get, put } from "@vercel/blob";
import { canonicalizeFlags } from "./flags";
import { emptyDoc, normalizeItem, type Doc } from "./types";

// The whole shared dataset is one JSON document. Writes are conditional on the
// version that was read, so two people saving at once never overwrite each other.

type Snapshot = { doc: Doc; etag: string | null };

interface Backend {
  read(): Promise<Snapshot>;
  /** Returns false when the document changed since it was read. */
  write(doc: Doc, etag: string | null): Promise<boolean>;
}

/** Production and every other environment keep separate data. */
export const STORAGE_ENV = process.env.VERCEL_ENV === "production" ? "prod" : "dev";
const BLOB_PATH = `${STORAGE_ENV}/potions-ark-db.json`;

// A compressed response can carry a weakened ETag (W/"...") that never matches
// the stored version, so the document is read uncompressed and the ETag is
// taken in its strong form.
function strongEtag(etag: string): string {
  return etag.replace(/^W\//, "");
}

const blobBackend: Backend = {
  async read() {
    const res = await get(BLOB_PATH, { access: "private", useCache: false, headers: { "accept-encoding": "identity" } });
    if (!res || res.statusCode !== 200) return { doc: emptyDoc(), etag: null };
    const text = await new Response(res.stream).text();
    return { doc: parse(text), etag: strongEtag(res.blob.etag) };
  },
  async write(doc, etag) {
    try {
      await put(BLOB_PATH, JSON.stringify(doc), {
        access: "private",
        contentType: "application/json",
        addRandomSuffix: false,
        ...(etag ? { ifMatch: etag } : { allowOverwrite: false }),
      });
      return true;
    } catch (error) {
      if (error instanceof BlobPreconditionFailedError) {
        console.warn("blob write conflict", { readEtag: etag });
        return false;
      }
      if (!etag && error instanceof BlobError && /exist/i.test(error.message)) return false;
      throw error;
    }
  },
};

const LOCAL_FILE = path.join(process.cwd(), ".data", "db.json");

// The local file stands in for Blob's conditional write: writes take turns
// (one server process) and replace the file in one step, so two saves at the
// same moment behave as on Blob: one wins, the other sees a conflict and retries.
let localTurn: Promise<unknown> = Promise.resolve();

const localBackend: Backend = {
  async read() {
    try {
      const text = await readFile(LOCAL_FILE, "utf8");
      return { doc: parse(text), etag: hash(text) };
    } catch {
      return { doc: emptyDoc(), etag: null };
    }
  },
  async write(doc, etag) {
    const turn = localTurn.then(async () => {
      const current = await this.read();
      if (current.etag !== etag) return false;
      await mkdir(path.dirname(LOCAL_FILE), { recursive: true });
      const temp = `${LOCAL_FILE}.${process.pid}.${Date.now()}.tmp`;
      await writeFile(temp, JSON.stringify(doc));
      await rename(temp, LOCAL_FILE);
      return true;
    });
    localTurn = turn.catch(() => undefined);
    return turn;
  },
};

/** True when the Vercel Blob store is configured; throws on Vercel when it is missing. */
export function usesBlob(): boolean {
  if (process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID) return true;
  if (process.env.VERCEL) throw new Error("雲端儲存尚未設定");
  return false;
}

function backend(): Backend {
  return usesBlob() ? blobBackend : localBackend;
}

function parse(text: string): Doc {
  const data = JSON.parse(text) as Partial<Doc>;
  // Each rating flag name gets its one site-wide level whenever the data is read.
  return { version: 1, items: canonicalizeFlags((data.items ?? []).map(normalizeItem)), entries: data.entries ?? [] };
}

function hash(text: string): string {
  return createHash("sha1").update(text).digest("hex");
}

/** What a backup holds, so a caller can compare it with the data before a change. */
export type BackupInfo = { pathname: string; items: number; entries: number; created: boolean };

/**
 * Saves a copy of the shared document, byte for byte, before a bulk change
 * such as a sheet import. Calling it again with the same name keeps the first
 * copy, so a re-run never replaces the original backup with changed data.
 */
export async function backupDoc(name: string): Promise<BackupInfo> {
  if (!/^[a-z0-9][a-z0-9-]{2,40}$/.test(name)) throw new Error("備份名稱不正確");
  const pathname = `${STORAGE_ENV}/backups/${name}.json`;
  const count = (text: string, created: boolean): BackupInfo => {
    const doc = parse(text);
    return { pathname, items: doc.items.length, entries: doc.entries.length, created };
  };
  if (usesBlob()) {
    const existing = await get(pathname, { access: "private", useCache: false, headers: { "accept-encoding": "identity" } });
    if (existing && existing.statusCode === 200) return count(await new Response(existing.stream).text(), false);
    const current = await get(BLOB_PATH, { access: "private", useCache: false, headers: { "accept-encoding": "identity" } });
    const text = current && current.statusCode === 200 ? await new Response(current.stream).text() : JSON.stringify(emptyDoc());
    await put(pathname, text, { access: "private", contentType: "application/json", addRandomSuffix: false, allowOverwrite: false });
    return count(text, true);
  }
  const file = path.join(process.cwd(), ".data", "backups", `${name}.json`);
  try {
    return count(await readFile(file, "utf8"), false);
  } catch {
    const text = await readFile(LOCAL_FILE, "utf8").catch(() => JSON.stringify(emptyDoc()));
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, text, { flag: "wx" });
    return count(text, true);
  }
}

export async function readDoc(): Promise<Doc> {
  return (await backend().read()).doc;
}

/** Marker a mutation returns when nothing needs to be written. */
export const NO_WRITE = Symbol("no-write");

/**
 * Reads the latest document, applies `change` to it and writes it back.
 * Retries from a fresh read when someone else saved in between.
 */
export async function mutate<T>(change: (doc: Doc) => T | typeof NO_WRITE): Promise<{ doc: Doc; result: T | typeof NO_WRITE }> {
  const store = backend();
  for (let attempt = 0; attempt < 6; attempt++) {
    const { doc, etag } = await store.read();
    const result = change(doc);
    if (result === NO_WRITE) return { doc, result };
    if (await store.write(doc, etag)) return { doc, result };
    await new Promise((r) => setTimeout(r, 80 * (attempt + 1) + Math.random() * 120));
  }
  throw new Error("同時有其他人在修改，請再試一次");
}
