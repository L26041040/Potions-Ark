"use client";

import { useEffect, useRef, useState } from "react";
import type { Doc, Item, Photo } from "@/lib/types";

const MAX_BYTES = 1024 * 1024;

/** Shrinks a photo in the browser to a JPEG of at most 1 MB with the long edge at 1600px or less. */
async function compressImage(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" }).catch(() => null);
  if (!bitmap) throw new Error(`無法讀取「${file.name}」，請改用 JPEG 或 PNG`);
  let scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  for (let round = 0; round < 6; round++) {
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.85, 0.75, 0.65, 0.55]) {
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
      if (blob && blob.size <= MAX_BYTES) return blob;
    }
    scale *= 0.75;
  }
  throw new Error(`「${file.name}」太大，無法壓縮`);
}

async function uploadOne(itemId: string, file: File, nickname: string): Promise<Doc> {
  const body = await compressImage(file);
  const res = await fetch(`/api/items/${encodeURIComponent(itemId)}/photos`, {
    method: "POST",
    body,
    headers: { "content-type": "image/jpeg", "x-nickname": encodeURIComponent(nickname) },
  });
  const data = (await res.json().catch(() => null)) as { ok: boolean; doc?: Doc; error?: string } | null;
  if (!res.ok || !data?.ok || !data.doc) throw new Error(data?.error || "上傳失敗，請再試一次");
  return data.doc;
}

/** Photos to show: the listing's (or, without them, the existing cover), then the uploaded ones. */
export function photosOf(item: Item): Photo[] {
  const listing = item.photos.filter((p) => p.source === "listing");
  const uploads = item.photos.filter((p) => p.source === "upload");
  const cover: Photo[] = item.coverUrl ? [{ id: "cover", source: "listing", url: item.coverUrl }] : [];
  return [...(listing.length ? listing : cover), ...uploads];
}

function Lightbox({ photos, index, onIndex, onClose }: { photos: Photo[]; index: number; onIndex: (i: number) => void; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft") onIndex(Math.max(0, index - 1));
      else if (e.key === "ArrowRight") onIndex(Math.min(photos.length - 1, index + 1));
      else return;
      e.stopPropagation();
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [index, photos.length, onIndex, onClose]);
  const photo = photos[index];
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/90" role="dialog" aria-modal="true" aria-label="放大檢視照片" onClick={onClose}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={photo.url} alt="" referrerPolicy="no-referrer" className="max-h-full max-w-full object-contain" onClick={(e) => e.stopPropagation()} />
      <span className="absolute left-1/2 top-3 -translate-x-1/2 rounded-full bg-black/60 px-3 py-1 text-sm text-white">
        {index + 1} / {photos.length}
      </span>
      <button type="button" aria-label="關閉放大檢視" onClick={onClose} className="absolute right-3 top-3 rounded-full bg-black/60 px-3 py-1.5 text-lg text-white">✕</button>
      {index > 0 && (
        <button type="button" aria-label="上一張" onClick={(e) => { e.stopPropagation(); onIndex(index - 1); }} className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-black/60 px-3 py-2 text-2xl text-white">‹</button>
      )}
      {index < photos.length - 1 && (
        <button type="button" aria-label="下一張" onClick={(e) => { e.stopPropagation(); onIndex(index + 1); }} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-black/60 px-3 py-2 text-2xl text-white">›</button>
      )}
    </div>
  );
}

export function PhotoViewer({
  item,
  nickname,
  requireNick,
  onDoc,
  onDeleteUpload,
  onError,
}: {
  item: Item;
  nickname: string;
  requireNick: () => Promise<string | null>;
  onDoc: (doc: Doc) => void;
  onDeleteUpload: (photoId: string) => void;
  onError: (message: string) => void;
}) {
  const photos = photosOf(item);
  const [index, setIndex] = useState(0);
  const [failed, setFailed] = useState<Set<string>>(() => new Set());
  const [zoom, setZoom] = useState(false);
  const [uploading, setUploading] = useState<{ done: number; total: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const current = photos[Math.min(index, photos.length - 1)];
  const at = current ? photos.indexOf(current) : 0;
  const markFailed = (url: string) => setFailed((prev) => (prev.has(url) ? prev : new Set(prev).add(url)));

  async function upload(files: FileList | null) {
    const list = [...(files ?? [])];
    if (fileRef.current) fileRef.current.value = "";
    if (!list.length) return;
    const nick = nickname || (await requireNick());
    if (!nick) return;
    setUploading({ done: 0, total: list.length });
    for (const [i, file] of list.entries()) {
      try {
        onDoc(await uploadOne(item.id, file, nick));
      } catch (e) {
        onError(e instanceof Error ? e.message : "上傳失敗");
      }
      setUploading({ done: i + 1, total: list.length });
    }
    setUploading(null);
    setIndex(photosOf(item).length);
  }

  const uploadButton = (
    <>
      <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => upload(e.target.files)} aria-label="選擇照片" />
      <button
        type="button"
        disabled={Boolean(uploading)}
        onClick={() => fileRef.current?.click()}
        className="rounded-lg bg-white px-3 py-1.5 text-sm ring-1 ring-stone-300 hover:bg-stone-50 disabled:opacity-50"
      >
        {uploading ? `上傳中 ${uploading.done}/${uploading.total}` : "上傳照片或截圖"}
      </button>
    </>
  );

  if (!current) {
    return (
      <div className="flex aspect-[4/3] w-full flex-col items-center justify-center gap-3 rounded-xl bg-stone-100 text-center">
        <p className="text-sm text-stone-500">還沒有照片。可以上傳照片或截圖。</p>
        {uploadButton}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="relative aspect-[4/3] w-full overflow-hidden rounded-xl bg-stone-900">
        {failed.has(current.url) ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 p-4 text-center text-stone-200">
            <p className="text-sm">這張照片無法顯示（原站可能已移除）。可以用下方「上傳照片或截圖」代替。</p>
          </div>
        ) : (
          <button type="button" className="block h-full w-full" onClick={() => setZoom(true)} aria-label="放大檢視">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              key={current.url}
              src={current.url}
              alt={`照片 ${at + 1}`}
              referrerPolicy="no-referrer"
              onError={() => markFailed(current.url)}
              className="h-full w-full object-contain"
              data-photo-source={current.source}
            />
          </button>
        )}
        <span className="absolute left-2 top-2 rounded-full bg-black/60 px-2 py-0.5 text-xs text-white" aria-label="照片位置">
          {at + 1} / {photos.length}
        </span>
        {at > 0 && (
          <button type="button" aria-label="上一張照片" onClick={() => setIndex(at - 1)} className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-black/50 px-2.5 py-1 text-xl text-white">‹</button>
        )}
        {at < photos.length - 1 && (
          <button type="button" aria-label="下一張照片" onClick={() => setIndex(at + 1)} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-black/50 px-2.5 py-1 text-xl text-white">›</button>
        )}
      </div>

      {photos.length > 1 && (
        <div className="flex gap-1.5 overflow-x-auto pb-1" role="list" aria-label="照片縮圖">
          {photos.map((p, i) => (
            <button
              key={p.id + i}
              type="button"
              role="listitem"
              onClick={() => setIndex(i)}
              className={`h-14 w-20 shrink-0 overflow-hidden rounded-md bg-stone-200 ring-2 ${i === at ? "ring-stone-900" : "ring-transparent"}`}
              aria-label={`第 ${i + 1} 張照片`}
            >
              {failed.has(p.url) ? (
                <span className="flex h-full items-center justify-center text-xs text-stone-500">無法顯示</span>
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={p.url} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => markFailed(p.url)} className="h-full w-full object-cover" />
              )}
            </button>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {uploadButton}
        {current.source === "upload" && (
          <button
            type="button"
            onClick={() => window.confirm("確定要刪除這張上傳的照片嗎？") && onDeleteUpload(current.id)}
            className="rounded-lg bg-white px-3 py-1.5 text-sm text-rose-700 ring-1 ring-stone-300 hover:bg-rose-50"
          >
            刪除這張照片
          </button>
        )}
        <span className="text-xs text-stone-500">{current.source === "upload" ? `上傳者：${current.createdBy || "匿名"}` : "照片來自原始刊登"}</span>
      </div>

      {zoom && <Lightbox photos={photos} index={at} onIndex={setIndex} onClose={() => setZoom(false)} />}
    </div>
  );
}
