import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { BlobError, BlobPreconditionFailedError, get, put } from "@vercel/blob";
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
    const current = await this.read();
    if (current.etag !== etag) return false;
    await mkdir(path.dirname(LOCAL_FILE), { recursive: true });
    await writeFile(LOCAL_FILE, JSON.stringify(doc));
    return true;
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
  return { version: 1, items: (data.items ?? []).map(normalizeItem), entries: data.entries ?? [] };
}

function hash(text: string): string {
  return createHash("sha1").update(text).digest("hex");
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
