import { randomBytes } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { del, get, put } from "@vercel/blob";
import { IMAGE_MIME, type ImageKind } from "./image";
import { STORAGE_ENV, usesBlob } from "./store";

// Uploaded photos live in the same private Blob store as the data and are
// served through /api/photo with a long cache. Listing photos are never copied.

export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
export const MAX_UPLOADS_PER_ITEM = 30;

const PATH = /^(prod|dev)\/photos\/[A-Za-z0-9_-]{1,32}\/[A-Za-z0-9_.-]{1,160}$/;
const LOCAL_DIR = path.join(process.cwd(), ".data");

export function isOwnPhotoPath(pathname: string): boolean {
  return PATH.test(pathname) && pathname.startsWith(`${STORAGE_ENV}/`) && !pathname.includes("..");
}

export function photoUrl(pathname: string): string {
  return `/api/photo?p=${encodeURIComponent(pathname)}`;
}

export async function savePhoto(itemId: string, kind: ImageKind, bytes: Uint8Array): Promise<string> {
  const base = `${STORAGE_ENV}/photos/${itemId}/${randomBytes(6).toString("base64url")}`;
  const ext = kind === "jpeg" ? "jpg" : kind;
  if (usesBlob()) {
    const blob = await put(`${base}.${ext}`, Buffer.from(bytes), {
      access: "private",
      contentType: IMAGE_MIME[kind],
      addRandomSuffix: true,
    });
    return blob.pathname;
  }
  const pathname = `${base}-${randomBytes(9).toString("base64url")}.${ext}`;
  await mkdir(path.dirname(path.join(LOCAL_DIR, pathname)), { recursive: true });
  await writeFile(path.join(LOCAL_DIR, pathname), bytes);
  return pathname;
}

export async function openPhoto(pathname: string): Promise<{ body: ReadableStream | Uint8Array; contentType: string } | null> {
  if (usesBlob()) {
    const res = await get(pathname, { access: "private" });
    if (!res || res.statusCode !== 200) return null;
    return { body: res.stream, contentType: res.blob.contentType };
  }
  try {
    const body = await readFile(path.join(LOCAL_DIR, pathname));
    const ext = pathname.split(".").pop();
    return { body, contentType: ext === "png" ? IMAGE_MIME.png : ext === "webp" ? IMAGE_MIME.webp : IMAGE_MIME.jpeg };
  } catch {
    return null;
  }
}

export async function removePhotos(pathnames: string[]): Promise<void> {
  const own = pathnames.filter(isOwnPhotoPath);
  if (!own.length) return;
  if (usesBlob()) {
    await del(own);
    return;
  }
  await Promise.all(own.map((p) => unlink(path.join(LOCAL_DIR, p)).catch(() => {})));
}
