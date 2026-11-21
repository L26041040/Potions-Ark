"use client";

import { useEffect, useState, type FormEvent } from "react";
import { addComment, addFromPaste, addManual, saveNote, setDeleted, setStatus, updateItem } from "@/app/actions";
import { STATUS_LABEL, STATUSES, type ActionResult, type Doc, type Item, type ItemFields, type Status } from "@/lib/types";
import { cleanUrl, extractUrl } from "@/lib/url";
import { Cover, readNick, StatusBadge, storeNickname, useIsDesktop, useNickname } from "./bits";
import { DesktopDetail, MobileDetail, type DetailProps } from "./detail";
import { ItemDialog, NicknameDialog } from "./dialogs";

type Filter = "active" | Status | "trash";
type Dialog = { kind: "add" } | { kind: "edit"; id: string } | null;
type Toast = { text: string; error?: boolean } | null;

const FILTERS: { key: Filter; label: string }[] = [
  { key: "active", label: "全部" },
  ...STATUSES.map((s) => ({ key: s as Filter, label: STATUS_LABEL[s] })),
  { key: "trash", label: "回收桶" },
];

function matchesFilter(item: Item, filter: Filter): boolean {
  if (filter === "trash") return Boolean(item.deletedAt);
  if (item.deletedAt) return false;
  if (filter === "active") return item.status !== "rejected";
  return item.status === filter;
}

function matchesQuery(item: Item, q: string): boolean {
  if (!q) return true;
  return [item.name, item.info, item.address, item.note].some((t) => t.toLowerCase().includes(q));
}

function itemUrl(id: string | null): string {
  return id ? `${window.location.pathname}?item=${encodeURIComponent(id)}` : window.location.pathname;
}

export default function App({ initialDoc, initialItemId }: { initialDoc: Doc; initialItemId: string | null }) {
  const [doc, setDoc] = useState(initialDoc);
  const [openId, setOpenId] = useState<string | null>(initialItemId);
  const [view, setView] = useState<"gallery" | "list">("gallery");
  const [filter, setFilter] = useState<Filter>("active");
  const [query, setQuery] = useState("");
  const [paste, setPaste] = useState("");
  const [pasting, setPasting] = useState(false);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [saving, setSaving] = useState(false);
  const [askNick, setAskNick] = useState(false);
  const [toast, setToast] = useState<Toast>(null);
  const nickname = useNickname();
  const isDesktop = useIsDesktop();
  const [nickWaiter, setNickWaiter] = useState<((name: string | null) => void) | null>(null);
  const [lastOpened, setLastOpened] = useState<string | null>(initialItemId);

  const q = query.trim().toLowerCase();
  const visible = doc.items
    .filter((i) => i.id === openId || (matchesFilter(i, filter) && matchesQuery(i, q)))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const openItem = openId ? doc.items.find((i) => i.id === openId) ?? null : null;
  const index = openItem ? visible.findIndex((i) => i.id === openItem.id) : -1;
  const counts = Object.fromEntries(FILTERS.map((f) => [f.key, doc.items.filter((i) => matchesFilter(i, f.key)).length]));

  // ---- URL: ?item=<id> is the direct link; Back closes the panel. ----
  function openItemById(id: string) {
    setLastOpened(id);
    if (openId) {
      window.history.replaceState({ potions: window.history.state?.potions ?? null }, "", itemUrl(id));
    } else {
      window.history.pushState({ potions: "item" }, "", itemUrl(id));
    }
    setOpenId(id);
  }

  function close() {
    if (window.history.state?.potions === "item") {
      window.history.back();
    } else {
      window.history.replaceState({ potions: null }, "", itemUrl(null));
      setOpenId(null);
    }
  }

  useEffect(() => {
    const onPop = () => setOpenId(new URLSearchParams(window.location.search).get("item"));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  useEffect(() => {
    const id = openId ?? lastOpened;
    if (!id) return;
    const frame = requestAnimationFrame(() => {
      document.querySelector(`[data-item-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: "nearest" });
    });
    return () => cancelAnimationFrame(frame);
  }, [openId, lastOpened, isDesktop]);

  useEffect(() => {
    if (!openId || dialog || askNick) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (e.key !== "Escape" || target?.closest("input, textarea, select")) return;
      close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  // ---- Nickname: asked the first time it is needed. ----
  function requireNick(): Promise<string | null> {
    const current = readNick();
    if (current) return Promise.resolve(current);
    return new Promise((resolve) => {
      setNickWaiter(() => resolve);
      setAskNick(true);
    });
  }

  function finishNick(name: string | null) {
    if (name) storeNickname(name);
    setAskNick(false);
    nickWaiter?.(name);
    setNickWaiter(null);
  }

  async function run(work: (nick: string) => Promise<ActionResult>): Promise<ActionResult | null> {
    const nick = await requireNick();
    if (!nick) return null;
    let res: ActionResult;
    try {
      res = await work(nick);
    } catch {
      res = { ok: false, error: "連線失敗，請再試一次" };
    }
    if (res.doc) setDoc(res.doc);
    if (!res.ok) setToast({ text: res.error, error: true });
    return res;
  }

  function reveal(id: string) {
    setQuery("");
    if (filter !== "active" && filter !== "new") setFilter("active");
    openItemById(id);
  }

  // ---- Actions ----
  async function onPaste(e: FormEvent) {
    e.preventDefault();
    const raw = paste.trim();
    if (!raw || pasting) return;
    const found = extractUrl(raw);
    const url = found ? cleanUrl(found.url) : null;
    if (!url) {
      setToast({ text: "沒有找到網址，請改用「手動新增」", error: true });
      return;
    }
    const dup = doc.items.find((i) => !i.deletedAt && i.sourceUrl === url);
    if (dup) {
      setPaste("");
      reveal(dup.id);
      setToast({ text: "這個物件已經在倉庫裡" });
      return;
    }
    const nick = await requireNick();
    if (!nick) return;
    setPasting(true);
    const res = await run(() => addFromPaste(raw, nick));
    setPasting(false);
    if (!res?.ok || !res.id) return;
    setPaste("");
    reveal(res.id);
    if (res.existing) setToast({ text: "這個物件已經在倉庫裡" });
    else if (!res.fetched) {
      setToast({ text: "讀不到這個網站的資料，請補上名稱與資訊" });
      setDialog({ kind: "edit", id: res.id });
    } else setToast({ text: "已收藏" });
  }

  async function onSubmitItem(fields: ItemFields) {
    if (!dialog) return;
    setSaving(true);
    const res =
      dialog.kind === "add"
        ? await run((nick) => addManual(fields, nick))
        : await run(() => updateItem(dialog.id, fields));
    setSaving(false);
    if (!res?.ok) return;
    setDialog(null);
    if (dialog.kind === "add" && res.id) reveal(res.id);
  }

  const detailProps: DetailProps | null = openId
    ? {
        item: openItem,
        entries: doc.entries,
        prevId: index > 0 ? visible[index - 1].id : null,
        nextId: index >= 0 && index < visible.length - 1 ? visible[index + 1].id : null,
        onNavigate: openItemById,
        onClose: close,
        onStatus: (status) => openItem && run((nick) => setStatus(openItem.id, status, nick)),
        onEdit: () => openItem && setDialog({ kind: "edit", id: openItem.id }),
        onDelete: () => {
          if (openItem && window.confirm(`確定要刪除「${openItem.name}」嗎？刪除後可在回收桶還原。`)) {
            run((nick) => setDeleted(openItem.id, true, nick));
          }
        },
        onRestore: () => openItem && run((nick) => setDeleted(openItem.id, false, nick)),
        onSaveNote: async (note) => Boolean(openItem && (await run((nick) => saveNote(openItem.id, note, nick)))?.ok),
        onComment: async (body) => Boolean(openItem && (await run((nick) => addComment(openItem.id, body, nick)))?.ok),
      }
    : null;

  const split = Boolean(openId && isDesktop);
  const editing = dialog?.kind === "edit" ? doc.items.find((i) => i.id === dialog.id) : undefined;

  return (
    <div className="flex h-dvh flex-col">
      <header className="shrink-0 border-b bg-white px-3 py-2 sm:px-4">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h1 className="whitespace-nowrap text-base font-semibold">Potions 二店選址倉庫</h1>
          <form onSubmit={onPaste} className="order-3 flex w-full gap-2 md:order-none md:w-auto md:flex-1">
            <input
              value={paste}
              onChange={(e) => setPaste(e.target.value)}
              placeholder="貼上 591 或其他房仲網址"
              inputMode="url"
              aria-label="貼上網址"
              className="min-w-0 flex-1 rounded-lg border border-stone-300 px-3 py-2 text-[16px] focus:border-stone-500 focus:outline-none sm:text-sm"
            />
            <button type="submit" disabled={pasting || !paste.trim()} className="shrink-0 rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40">
              {pasting ? "讀取中…" : "收藏"}
            </button>
          </form>
          <div className="ml-auto flex items-center gap-2 md:ml-0">
            <button type="button" onClick={() => setDialog({ kind: "add" })} className="whitespace-nowrap rounded-lg px-3 py-2 text-sm ring-1 ring-stone-300 hover:bg-stone-50">
              手動新增
            </button>
            <button
              type="button"
              onClick={() => setAskNick(true)}
              className="max-w-[9rem] truncate whitespace-nowrap rounded-lg px-3 py-2 text-sm text-stone-600 hover:bg-stone-100"
              title="更改暱稱"
            >
              {nickname ? `👤 ${nickname}` : "設定暱稱"}
            </button>
          </div>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <section className={`min-h-0 overflow-y-auto ${split ? "w-1/3 border-r" : "w-full"}`} aria-label="物件倉庫">
          <div className="sticky top-0 z-10 space-y-2 border-b bg-stone-50/95 px-3 py-2 backdrop-blur">
            <div className="flex gap-2">
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="搜尋名稱、資訊、地址、備註"
                aria-label="搜尋"
                className="min-w-0 flex-1 rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-[16px] focus:border-stone-500 focus:outline-none sm:text-sm"
              />
              <div className="flex shrink-0 rounded-lg bg-white p-0.5 ring-1 ring-stone-300" role="group" aria-label="檢視方式">
                {(["gallery", "list"] as const).map((v) => (
                  <button
                    key={v}
                    type="button"
                    aria-pressed={view === v}
                    onClick={() => setView(v)}
                    className={`rounded-md px-2.5 py-1 text-sm ${view === v ? "bg-stone-900 text-white" : "text-stone-600"}`}
                  >
                    {v === "gallery" ? "圖庫" : "列表"}
                  </button>
                ))}
              </div>
            </div>
            <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5" role="group" aria-label="狀態篩選">
              {FILTERS.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  aria-pressed={filter === f.key}
                  onClick={() => setFilter(f.key)}
                  className={`shrink-0 rounded-full px-3 py-1 text-sm ring-1 ${
                    filter === f.key ? "bg-stone-900 text-white ring-stone-900" : "bg-white text-stone-700 ring-stone-300"
                  }`}
                >
                  {f.label} <span className="opacity-60">{counts[f.key]}</span>
                </button>
              ))}
            </div>
          </div>

          {visible.length === 0 ? (
            <p className="px-4 py-16 text-center text-sm text-stone-500">
              {doc.items.length === 0 ? "還沒有物件。把 591 網址貼到上方，按「收藏」。" : "沒有符合的物件。"}
            </p>
          ) : view === "gallery" ? (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2 p-2 sm:gap-3 sm:p-3">
              {visible.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  data-item-id={item.id}
                  onClick={() => openItemById(item.id)}
                  className={`overflow-hidden rounded-xl bg-white text-left shadow-sm ring-1 transition hover:shadow ${
                    item.id === openId ? "ring-2 ring-stone-900" : "ring-stone-200"
                  } ${item.deletedAt ? "opacity-60" : ""}`}
                >
                  <div className="relative aspect-[4/3] bg-stone-100">
                    <Cover item={item} className="absolute inset-0 h-full w-full" />
                    <StatusBadge status={item.status} className="absolute left-1.5 top-1.5 shadow-sm" />
                  </div>
                  <div className="p-2">
                    <div className="line-clamp-2 text-sm font-medium leading-snug">{item.name}</div>
                    {item.info && <div className="mt-0.5 truncate text-xs text-stone-500">{item.info}</div>}
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <ul className="divide-y divide-stone-200 bg-white">
              {visible.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    data-item-id={item.id}
                    onClick={() => openItemById(item.id)}
                    className={`flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-stone-50 ${item.id === openId ? "bg-stone-100" : ""} ${
                      item.deletedAt ? "opacity-60" : ""
                    }`}
                  >
                    <Cover item={item} className="h-12 w-16 shrink-0 rounded-md" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{item.name}</div>
                      {item.info && <div className="truncate text-xs text-stone-500">{item.info}</div>}
                    </div>
                    <StatusBadge status={item.status} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {split && detailProps && (
          <section className="min-h-0 w-2/3" aria-label="物件瀏覽">
            <DesktopDetail {...detailProps} />
          </section>
        )}
      </div>

      {openId && isDesktop === false && detailProps && <MobileDetail {...detailProps} />}

      {dialog && (dialog.kind === "add" || editing) && (
        <ItemDialog key={dialog.kind === "edit" ? dialog.id : "add"} mode={dialog.kind} item={editing} busy={saving} onSubmit={onSubmitItem} onCancel={() => setDialog(null)} />
      )}
      {askNick && <NicknameDialog current={nickname} onSave={finishNick} onCancel={() => finishNick(null)} />}

      {toast && (
        <div
          role="status"
          className={`fixed bottom-4 left-1/2 z-[60] max-w-[90vw] -translate-x-1/2 rounded-full px-4 py-2 text-sm text-white shadow-lg ${
            toast.error ? "bg-rose-700" : "bg-stone-900"
          }`}
        >
          {toast.text}
        </div>
      )}
    </div>
  );
}
