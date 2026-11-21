"use client";

import { useState, type FormEvent } from "react";
import { STATUS_LABEL, type Entry, type Item, type Status } from "@/lib/types";
import { hostOf, mapsUrl } from "@/lib/url";
import { Cover, formatTime, openSource, StatusButtons } from "./bits";

export type DetailProps = {
  item: Item | null;
  entries: Entry[];
  prevId: string | null;
  nextId: string | null;
  onNavigate: (id: string) => void;
  onClose: () => void;
  onStatus: (status: Status) => void;
  onEdit: () => void;
  onDelete: () => void;
  onRestore: () => void;
  onSaveNote: (note: string) => Promise<boolean>;
  onComment: (body: string) => Promise<boolean>;
};

const button = "rounded-lg px-2.5 py-1.5 text-sm ring-1 ring-stone-300 bg-white hover:bg-stone-50 whitespace-nowrap";

function NavButtons({ prevId, nextId, onNavigate }: Pick<DetailProps, "prevId" | "nextId" | "onNavigate">) {
  return (
    <div className="flex shrink-0 gap-1">
      <button type="button" className={`${button} disabled:opacity-30`} disabled={!prevId} onClick={() => prevId && onNavigate(prevId)} aria-label="上一間">
        ‹ 上一間
      </button>
      <button type="button" className={`${button} disabled:opacity-30`} disabled={!nextId} onClick={() => nextId && onNavigate(nextId)} aria-label="下一間">
        下一間 ›
      </button>
    </div>
  );
}

function Actions({ item, onEdit, onDelete, onRestore }: { item: Item } & Pick<DetailProps, "onEdit" | "onDelete" | "onRestore">) {
  return (
    <>
      {item.address && (
        <a className={button} href={mapsUrl(item.address)} target="_blank" rel="noopener noreferrer">
          Google Maps
        </a>
      )}
      <button type="button" className={button} onClick={onEdit}>編輯</button>
      {item.deletedAt ? (
        <button type="button" className={button} onClick={onRestore}>還原</button>
      ) : (
        <button type="button" className={`${button} text-rose-700`} onClick={onDelete}>刪除</button>
      )}
    </>
  );
}

function DeletedBanner({ item, onRestore }: { item: Item; onRestore: () => void }) {
  if (!item.deletedAt) return null;
  return (
    <div className="flex items-center gap-2 bg-rose-50 px-3 py-2 text-sm text-rose-800">
      <span className="flex-1">這個物件在回收桶裡（{item.deletedBy || "有人"} 於 {formatTime(item.deletedAt)} 刪除）。</span>
      <button type="button" onClick={onRestore} className="rounded-md bg-white px-2 py-1 font-medium ring-1 ring-rose-300">還原</button>
    </div>
  );
}

function OpenSourceButton({ url, big = false }: { url: string; big?: boolean }) {
  return (
    <button
      type="button"
      onClick={() => openSource(url)}
      className={
        big
          ? "w-full rounded-xl bg-stone-900 px-4 py-3 text-base font-medium text-white shadow-sm active:bg-stone-700"
          : "whitespace-nowrap rounded-lg bg-stone-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-stone-700"
      }
    >
      開啟原始網頁 ↗
    </button>
  );
}

function SourceView({ item }: { item: Item }) {
  if (item.sourceUrl && item.embed) {
    return (
      <div className="flex h-full flex-col">
        <p className="shrink-0 border-b bg-stone-50 px-3 py-1 text-xs text-stone-500">
          原始網頁：{hostOf(item.sourceUrl)}。畫面空白或被拒絕時，按上方「開啟原始網頁」，或在「編輯」取消嵌入。
        </p>
        <iframe
          key={item.id + item.sourceUrl}
          src={item.sourceUrl}
          title="原始網頁"
          className="min-h-0 w-full flex-1 border-0 bg-white"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
          referrerPolicy="no-referrer"
        />
      </div>
    );
  }
  return (
    <div className="flex h-full items-center justify-center overflow-y-auto p-6">
      <div className="w-full max-w-md space-y-3 text-center">
        <Cover item={item} className="mx-auto aspect-[4/3] w-full rounded-xl" />
        <h3 className="text-lg font-semibold">{item.name}</h3>
        {item.info && <p className="whitespace-pre-wrap text-sm text-stone-600">{item.info}</p>}
        {item.sourceUrl ? (
          <>
            <p className="text-sm text-stone-500">這個網站（{hostOf(item.sourceUrl)}）不允許嵌入，請另開視窗查看。另開的視窗會重複使用，可以擺在旁邊並排看。</p>
            <OpenSourceButton url={item.sourceUrl} big />
          </>
        ) : (
          <p className="text-sm text-stone-500">這個物件沒有原始網址，可以按「編輯」補上。</p>
        )}
      </div>
    </div>
  );
}

function Discussion({ item, entries, onSaveNote, onComment }: Pick<DetailProps, "entries" | "onSaveNote" | "onComment"> & { item: Item }) {
  const [base, setBase] = useState(item.note);
  const [draft, setDraft] = useState(item.note);
  const [savingNote, setSavingNote] = useState(false);
  const [comment, setComment] = useState("");
  const [sending, setSending] = useState(false);

  // Someone else saved a new note: follow it unless we are mid-edit.
  if (item.note !== base) {
    setBase(item.note);
    if (draft === base) setDraft(item.note);
  }

  const saveNote = async () => {
    setSavingNote(true);
    await onSaveNote(draft);
    setSavingNote(false);
  };
  const send = async (e: FormEvent) => {
    e.preventDefault();
    if (!comment.trim()) return;
    setSending(true);
    if (await onComment(comment)) setComment("");
    setSending(false);
  };
  const timeline = entries.filter((e) => e.itemId === item.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return (
    <div className="space-y-4">
      <section>
        <h3 className="mb-1.5 text-sm font-semibold">重要備註</h3>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={4}
          maxLength={5000}
          placeholder="目前的結論、要確認的事項…"
          className="w-full rounded-lg border border-stone-300 px-3 py-2 text-[16px] focus:border-stone-500 focus:outline-none sm:text-sm"
          aria-label="重要備註"
        />
        <div className="mt-1 flex items-center gap-2">
          <span className="flex-1 text-xs text-stone-500">{item.noteAt ? `最後更新：${item.noteBy} · ${formatTime(item.noteAt)}` : "尚無備註"}</span>
          <button
            type="button"
            onClick={saveNote}
            disabled={savingNote || draft === item.note}
            className="rounded-lg bg-stone-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-30"
          >
            {savingNote ? "儲存中…" : "儲存備註"}
          </button>
        </div>
      </section>

      <section>
        <h3 className="mb-1.5 text-sm font-semibold">留言（{timeline.filter((e) => e.kind === "comment").length}）</h3>
        <form onSubmit={send} className="space-y-1.5">
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send(e);
            }}
            rows={2}
            maxLength={2000}
            placeholder="寫下你的看法…"
            className="w-full rounded-lg border border-stone-300 px-3 py-2 text-[16px] focus:border-stone-500 focus:outline-none sm:text-sm"
            aria-label="留言"
          />
          <div className="flex justify-end">
            <button type="submit" disabled={sending || !comment.trim()} className="rounded-lg bg-stone-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-30">
              {sending ? "送出中…" : "送出留言"}
            </button>
          </div>
        </form>
        <ol className="mt-3 space-y-2.5">
          {timeline.length === 0 && <li className="text-sm text-stone-400">還沒有留言。</li>}
          {timeline.map((e) =>
            e.kind === "status" ? (
              <li key={e.id} className="text-xs text-stone-500">
                {e.nickname} 將狀態從「{e.from ? STATUS_LABEL[e.from] : ""}」改為「{e.to ? STATUS_LABEL[e.to] : ""}」 · {formatTime(e.createdAt)}
              </li>
            ) : (
              <li key={e.id} className="rounded-lg bg-stone-50 px-3 py-2">
                <div className="flex items-baseline gap-2 text-xs">
                  <span className="font-semibold text-stone-800">{e.nickname}</span>
                  <span className="text-stone-400">{formatTime(e.createdAt)}</span>
                </div>
                <p className="mt-0.5 whitespace-pre-wrap break-words text-sm">{e.body}</p>
              </li>
            ),
          )}
        </ol>
      </section>
    </div>
  );
}

function NotFound({ onClose }: { onClose: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
      <p className="text-stone-600">找不到這個物件，可能已被刪除或網址有誤。</p>
      <button type="button" className={button} onClick={onClose}>回到倉庫</button>
    </div>
  );
}

export function DesktopDetail(props: DetailProps) {
  const { item, entries, onClose, onStatus } = props;
  const [showDiscussion, setShowDiscussion] = useState(true);
  if (!item) return <NotFound onClose={onClose} />;
  const comments = entries.filter((e) => e.itemId === item.id && e.kind === "comment").length;
  return (
    <div className="flex h-full flex-col bg-white">
      <div className="shrink-0 space-y-2 border-b px-3 py-2">
        <div className="flex items-center gap-2">
          <NavButtons {...props} />
          <h2 className="min-w-0 flex-1 truncate text-base font-semibold" title={item.name}>{item.name}</h2>
          <button type="button" onClick={onClose} className="rounded-lg px-2.5 py-1 text-lg leading-none text-stone-500 hover:bg-stone-100" aria-label="關閉">
            ✕
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusButtons status={item.status} onChange={onStatus} />
          <span className="mx-0.5 hidden h-5 w-px bg-stone-200 xl:block" />
          {item.sourceUrl && <OpenSourceButton url={item.sourceUrl} />}
          <Actions {...props} item={item} />
          <button type="button" className={`${button} ml-auto`} onClick={() => setShowDiscussion((v) => !v)} aria-expanded={showDiscussion}>
            {showDiscussion ? "收合討論" : `展開討論（${comments}）`}
          </button>
        </div>
      </div>
      <DeletedBanner item={item} onRestore={props.onRestore} />
      <div className="flex min-h-0 flex-1 flex-col xl:flex-row">
        <div className="min-h-0 min-w-0 flex-1 bg-stone-100">
          <SourceView item={item} />
        </div>
        {showDiscussion && (
          <aside className="h-[42%] shrink-0 overflow-y-auto border-t p-3 xl:h-auto xl:w-[360px] xl:border-l xl:border-t-0 2xl:w-[400px]" aria-label="討論區">
            <Discussion key={item.id} {...props} item={item} />
          </aside>
        )}
      </div>
    </div>
  );
}

export function MobileDetail(props: DetailProps) {
  const { item, onClose, onStatus } = props;
  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-white">
      <div className="flex shrink-0 items-center gap-2 border-b px-2 py-2">
        <button type="button" onClick={onClose} className="rounded-lg px-2 py-1.5 text-sm font-medium" aria-label="關閉">
          ‹ 倉庫
        </button>
        <div className="flex-1" />
        {item && <NavButtons {...props} />}
      </div>
      {!item ? (
        <NotFound onClose={onClose} />
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <Cover item={item} className="aspect-[4/3] w-full" />
          <DeletedBanner item={item} onRestore={props.onRestore} />
          <div className="space-y-3 p-4">
            <h2 className="text-lg font-semibold leading-snug">{item.name}</h2>
            {item.info && <p className="whitespace-pre-wrap text-sm text-stone-600">{item.info}</p>}
            {item.address && <p className="text-sm text-stone-600">地址：{item.address}</p>}
            <StatusButtons status={item.status} onChange={onStatus} />
            {item.sourceUrl && <OpenSourceButton url={item.sourceUrl} big />}
            <div className="flex flex-wrap gap-2">
              <Actions {...props} item={item} />
            </div>
            <div className="border-t pt-3">
              <Discussion key={item.id} {...props} item={item} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
