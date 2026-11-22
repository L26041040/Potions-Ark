import { randomBytes } from "node:crypto";
import { sniffImage, IMAGE_MIME } from "@/lib/image";
import { MAX_UPLOAD_BYTES, MAX_UPLOADS_PER_ITEM, photoUrl, removePhotos, savePhoto } from "@/lib/photos";
import { mutate, NO_WRITE, readDoc } from "@/lib/store";

// Public upload (there is no login): one photo per request, size and real
// format checked here, a per-item cap, and only for items that are not deleted.

function fail(status: number, error: string) {
  return Response.json({ ok: false, error }, { status });
}

/** Reads the body but stops as soon as it passes the limit, even without a Content-Length header. */
async function readCapped(request: Request): Promise<Uint8Array | null> {
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_UPLOAD_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

function nicknameOf(request: Request): string {
  let raw = request.headers.get("x-nickname") ?? "";
  try {
    raw = decodeURIComponent(raw);
  } catch {
    // Keep the raw header when it is not valid percent-encoding.
  }
  return raw.replace(/\s+/g, " ").trim().slice(0, 20) || "匿名";
}

function uploadsOf(item: { photos: { source: string }[] }) {
  return item.photos.filter((p) => p.source === "upload").length;
}

export async function POST(request: Request, { params }: RouteContext<"/api/items/[id]/photos">) {
  const { id } = await params;
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_UPLOAD_BYTES) return fail(413, "照片超過 4 MB");
  const bytes = await readCapped(request);
  if (!bytes) return fail(413, "照片超過 4 MB");
  if (bytes.length === 0) return fail(400, "沒有收到照片");
  const kind = sniffImage(bytes);
  if (!kind) return fail(415, "只接受 JPEG、PNG、WebP 照片");

  const item = (await readDoc()).items.find((i) => i.id === id);
  if (!item || item.deletedAt) return fail(404, "找不到這個物件，或它在回收桶裡");
  if (uploadsOf(item) >= MAX_UPLOADS_PER_ITEM) return fail(409, `每個物件最多上傳 ${MAX_UPLOADS_PER_ITEM} 張照片`);

  const who = nicknameOf(request);
  const pathname = await savePhoto(id, kind, bytes);
  try {
    const { doc, result } = await mutate((d) => {
      const target = d.items.find((i) => i.id === id);
      if (!target || target.deletedAt || uploadsOf(target) >= MAX_UPLOADS_PER_ITEM) return NO_WRITE;
      const now = new Date().toISOString();
      target.photos.push({ id: randomBytes(6).toString("base64url"), source: "upload", url: photoUrl(pathname), pathname, createdBy: who, createdAt: now });
      target.updatedAt = now;
      return true;
    });
    if (result === NO_WRITE) {
      await removePhotos([pathname]);
      return fail(409, `每個物件最多上傳 ${MAX_UPLOADS_PER_ITEM} 張照片，或物件已被刪除`);
    }
    return Response.json({ ok: true, doc, type: IMAGE_MIME[kind] });
  } catch (error) {
    console.error(error);
    await removePhotos([pathname]).catch(() => {});
    return fail(500, "儲存失敗，請再試一次");
  }
}
