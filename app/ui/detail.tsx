"use client";

import { useState, type FormEvent } from "react";
import { zoneOf } from "@/lib/compare";
import { contactParts } from "@/lib/contact";
import { tagsOf } from "@/lib/tags";
import { STATUS_LABEL, TAG_KEYS, type Doc, type Entry, type Item, type Status, type TagKey } from "@/lib/types";
import { formatArea, formatRent, NOT_GIVEN } from "@/lib/units";
import { hostOf, mapsUrl } from "@/lib/url";
import { formatTime, openSource, StatusButtons } from "./bits";
import { PhotoViewer } from "./photos";

export type DetailProps = {
  item: Item | null;
  entries: Entry[];
  prevId: string | null;
  nextId: string | null;
  onNavigate: (id: string) => void;
  onClose: () => void;
  onStatus: (status: Status) => void;
  /** true = 是, false = 否, null = back to automatic reading. */
  onTag: (key: TagKey, value: boolean | null) => void;
  onEdit: () => void;
  onDelete: () => void;
  onRestore: () => void;
  onSaveNote: (note: string) => Promise<boolean>;
  onComment: (body: string) => Promise<boolean>;
  onRefetch: () => Promise<void>;
  onDeleteUpload: (photoId: string) => void;
  onDoc: (doc: Doc) => void;
  onError: (message: string) => void;
  nickname: string;
  requireNick: () => Promise<string | null>;
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

function RefetchButton({ onRefetch }: Pick<DetailProps, "onRefetch">) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className={`${button} disabled:opacity-50`}
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await onRefetch();
        setBusy(false);
      }}
    >
      {busy ? "讀取中…" : "重新取得照片與資訊"}
    </button>
  );
}

function Actions({ item, onEdit, onDelete, onRestore, onRefetch }: { item: Item } & Pick<DetailProps, "onEdit" | "onDelete" | "onRestore" | "onRefetch">) {
  return (
    <>
      {item.sourceUrl && <RefetchButton onRefetch={onRefetch} />}
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

/** Optional: the original page inside this site. Many sites refuse this, so it is off by default. */
function EmbedView({ item }: { item: Item }) {
  return (
    <div className="flex h-full flex-col">
      <p className="shrink-0 border-b bg-stone-50 px-3 py-1 text-xs text-stone-500">
        嵌入的原始網頁：{hostOf(item.sourceUrl)}。畫面空白或被拒絕時，請改按「開啟原始網頁」。
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

/** 聯絡資訊 with phone numbers as call links and LINE IDs as LINE links. */
function Contact({ text }: { text: string }) {
  return (
    <div role="group" aria-label="聯絡資訊" className="rounded-lg bg-amber-50/70 px-3 py-2 text-sm ring-1 ring-amber-200">
      <p className="text-xs font-medium text-stone-500">聯絡資訊</p>
      <p className="whitespace-pre-wrap break-words">
        {contactParts(text).map((part, i) =>
          part.kind === "text" ? (
            <span key={i}>{part.text}</span>
          ) : (
            <a
              key={i}
              href={part.href}
              data-contact={part.kind}
              {...(part.kind === "line" ? { target: "_blank", rel: "noopener noreferrer" } : {})}
              className="font-medium text-sky-700 underline underline-offset-2"
            >
              {part.text}
            </a>
          ),
        )}
      </p>
    </div>
  );
}

const ZONE_SOURCE: Record<string, string> = { 試算表商圈: "試算表", 地址: "依地址" };

/** Rent, area, floor and 商圈／區域 always show, with 「未提供」 when missing. */
function Facts({ item }: { item: Item }) {
  const zone = zoneOf(item);
  const rows: { key: string; label: string; value: string; note?: string }[] = [
    { key: "rent", label: "月租金", value: formatRent(item.rent) },
    { key: "area", label: "坪數", value: formatArea(item.area) },
    { key: "floor", label: "樓層", value: item.floor || NOT_GIVEN },
    { key: "zone", label: "商圈／區域", value: zone.value || NOT_GIVEN, note: ZONE_SOURCE[zone.source] },
  ];
  if (item.address) rows.push({ key: "address", label: "地址", value: item.address });
  return (
    <section aria-label="物件資訊" className="space-y-2">
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
        {rows.map((r) => (
          <div key={r.key} className="contents">
            <dt className="text-stone-500">{r.label}</dt>
            <dd className={r.value === NOT_GIVEN ? "text-stone-400" : "font-medium"}>
              <span data-fact={r.key}>{r.value}</span>
              {r.note && <span className="ml-1 text-xs font-normal text-stone-400">（{r.note}）</span>}
            </dd>
          </div>
        ))}
      </dl>
      {item.info && <p className="whitespace-pre-wrap text-sm text-stone-600">{item.info}</p>}
      {item.contact && <Contact text={item.contact} />}
    </section>
  );
}

const TAG_STATE: Record<string, { text: string; style: string }> = {
  yes: { text: "是", style: "bg-emerald-50 text-emerald-800 ring-emerald-200" },
  no: { text: "否", style: "bg-rose-50 text-rose-800 ring-rose-200" },
  unknown: { text: "未確認", style: "bg-stone-100 text-stone-600 ring-stone-200" },
};

/** 可餐飲／可飲酒／頂讓: state, where it came from, and the shareholder's yes / no / automatic switch. */
function StoreTags({ item, onTag }: { item: Item; onTag: DetailProps["onTag"] }) {
  const tags = tagsOf(item);
  return (
    <section aria-label="店面條件" className="space-y-1.5">
      <h3 className="text-xs font-medium text-stone-500">店面條件（只認明確寫出的條件，可自行修正）</h3>
      {TAG_KEYS.map((key) => {
        const t = tags[key];
        const set = item.tagOverrides[key];
        const why =
          t.source === "股東填寫" ? `股東填寫（${t.by || "匿名"}）`
          : t.conflict ? `來源不一致，請確認：${t.evidence}`
          : t.source ? `${t.source}：「${t.evidence}」`
          : "沒有明確資料";
        const choice = (label: string, value: boolean | null, pressed: boolean) => (
          <button
            type="button"
            aria-pressed={pressed}
            onClick={() => !pressed && onTag(key, value)}
            className={`px-2 py-0.5 text-xs ${pressed ? "bg-stone-900 text-white" : "bg-white text-stone-600 hover:bg-stone-50"}`}
          >
            {label}
          </button>
        );
        return (
          <div key={key} role="group" aria-label={t.label} data-tag={key} data-state={t.state} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
            <span className="w-12 shrink-0 font-medium">{t.label}</span>
            <span className={`rounded-full px-2 py-px text-xs ring-1 ${TAG_STATE[t.state].style}`}>{TAG_STATE[t.state].text}</span>
            <span className="min-w-0 flex-1 truncate text-xs text-stone-500" title={why}>
              {why}
            </span>
            <span className="flex shrink-0 overflow-hidden rounded-md ring-1 ring-stone-300">
              {choice("是", true, set?.value === true)}
              {choice("否", false, set?.value === false)}
              {choice("自動", null, !set)}
            </span>
          </div>
        );
      })}
    </section>
  );
}

function LinkHealth({ item }: { item: Item }) {
  if (!item.sourceUrl) return null;
  const when = item.healthAt ? `（${formatTime(item.healthAt)} 檢查）` : "";
  if (item.health === "gone") {
    return (
      <p role="status" className="rounded-lg bg-rose-50 px-3 py-2 text-sm font-medium text-rose-800 ring-1 ring-rose-200">
        原始刊登已失效：{item.healthReason}{when}。股東狀態、備註與留言都保留。
      </p>
    );
  }
  if (item.health === "unknown") {
    return <p className="text-xs text-stone-500">無法確認原始刊登狀態：{item.healthReason}{when}</p>;
  }
  if (item.health === "ok") return <p className="text-xs text-stone-500">原始刊登正常{when}</p>;
  return <p className="text-xs text-stone-500">原始刊登尚未檢查</p>;
}

/** The native preview, top to bottom: photos, name, facts, link health, status, original page and map. */
function Summary(props: DetailProps & { item: Item; mobile?: boolean }) {
  const { item, mobile } = props;
  return (
    <div className="space-y-4">
      <PhotoViewer
        key={item.id}
        item={item}
        nickname={props.nickname}
        requireNick={props.requireNick}
        onDoc={props.onDoc}
        onDeleteUpload={props.onDeleteUpload}
        onError={props.onError}
      />
      <h2 className="text-lg font-semibold leading-snug">{item.name}</h2>
      <Facts item={item} />
      <StoreTags item={item} onTag={props.onTag} />
      <LinkHealth item={item} />
      <StatusButtons status={item.status} onChange={props.onStatus} />
      <div className="flex flex-wrap gap-2">
        {item.sourceUrl && <OpenSourceButton url={item.sourceUrl} big={mobile} />}
        {item.address && (
          <a className={button} href={mapsUrl(item.address)} target="_blank" rel="noopener noreferrer">
            Google Maps
          </a>
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
  const { item, entries, onClose } = props;
  const [showDiscussion, setShowDiscussion] = useState(true);
  const [embedFor, setEmbedFor] = useState<string | null>(null);
  if (!item) return <NotFound onClose={onClose} />;
  const showEmbed = embedFor === item.id && Boolean(item.sourceUrl);
  const comments = entries.filter((e) => e.itemId === item.id && e.kind === "comment").length;
  return (
    <div className="flex h-full flex-col bg-white">
      <div className="shrink-0 space-y-2 border-b px-3 py-2">
        <div className="flex items-center gap-2">
          <NavButtons {...props} />
          <div className="flex-1" />
          <button type="button" onClick={onClose} className="rounded-lg px-2.5 py-1 text-lg leading-none text-stone-500 hover:bg-stone-100" aria-label="關閉">
            ✕
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Actions {...props} item={item} />
          {item.sourceUrl && item.embed && (
            <button type="button" className={button} aria-pressed={showEmbed} onClick={() => setEmbedFor(showEmbed ? null : item.id)}>
              {showEmbed ? "看本站預覽" : "嵌入原始網頁"}
            </button>
          )}
          <button type="button" className={`${button} ml-auto`} onClick={() => setShowDiscussion((v) => !v)} aria-expanded={showDiscussion}>
            {showDiscussion ? "收合討論" : `展開討論（${comments}）`}
          </button>
        </div>
      </div>
      <DeletedBanner item={item} onRestore={props.onRestore} />
      <div className="flex min-h-0 flex-1 flex-col xl:flex-row">
        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto bg-white">
          {showEmbed ? (
            <EmbedView item={item} />
          ) : (
            <div className="mx-auto max-w-3xl p-4">
              <Summary {...props} item={item} />
            </div>
          )}
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
  const { item, onClose } = props;
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
          <DeletedBanner item={item} onRestore={props.onRestore} />
          <div className="space-y-3 p-4">
            <Summary {...props} item={item} mobile />
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
