"use client";

import { useState } from "react";
import type { ActionResult, Doc } from "@/lib/types";
import { extractAllUrls } from "@/lib/url";

/** Links per request. The browser keeps sending requests until every link is done; there is no overall limit. */
const CHUNK = 6;

export type BatchState = {
  running: boolean;
  total: number;
  processed: number;
  added: number;
  needsFill: number;
  duplicates: number;
  failed: string[];
  finished: boolean;
};

const idle: BatchState = { running: false, total: 0, processed: 0, added: 0, needsFill: 0, duplicates: 0, failed: [], finished: false };

export function useBatchImport({
  doc,
  setDoc,
  requireNick,
  onFinished,
}: {
  doc: Doc;
  setDoc: (doc: Doc) => void;
  requireNick: () => Promise<string | null>;
  onFinished: (state: BatchState) => void;
}) {
  const [state, setState] = useState<BatchState>(idle);

  async function start(text: string): Promise<boolean> {
    if (state.running) return false;
    const parsed = extractAllUrls(text);
    const total = parsed.entries.length + parsed.duplicates.length + parsed.invalid.length;
    if (total === 0) return false;
    const nick = await requireNick();
    if (!nick) return false;

    const saved = new Set(doc.items.filter((i) => !i.deletedAt).map((i) => i.sourceUrl));
    const todo = parsed.entries.filter((e) => !saved.has(e.url));
    let current: BatchState = {
      ...idle,
      running: true,
      total,
      duplicates: parsed.duplicates.length + (parsed.entries.length - todo.length),
      failed: [...parsed.invalid],
    };
    current.processed = current.duplicates + current.failed.length;
    setState(current);

    for (let i = 0; i < todo.length; i += CHUNK) {
      const chunk = todo.slice(i, i + CHUNK);
      let res: ActionResult;
      try {
        const response = await fetch("/api/add", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ entries: chunk, nickname: nick }),
        });
        res = (await response.json()) as ActionResult;
      } catch {
        res = { ok: false, error: "連線失敗" };
      }
      const next = { ...current, failed: [...current.failed], processed: current.processed + chunk.length };
      if (res.ok) {
        setDoc(res.doc);
        for (const o of res.outcomes ?? []) {
          if (o.result === "added") {
            next.added++;
            if (o.needsFill) next.needsFill++;
          } else if (o.result === "duplicate") next.duplicates++;
          else next.failed.push(o.url);
        }
      } else {
        next.failed.push(...chunk.map((c) => c.url));
      }
      current = next;
      setState(current);
    }
    current = { ...current, running: false, finished: true };
    setState(current);
    onFinished(current);
    return true;
  }

  return { state, start, reset: () => setState(idle) };
}

export function BatchPanel({
  state,
  onStart,
  onReset,
  onClose,
}: {
  state: BatchState;
  onStart: (text: string) => Promise<boolean>;
  onReset: () => void;
  onClose: () => void;
}) {
  const [text, setText] = useState("");
  const found = text.trim() ? extractAllUrls(text) : null;
  const count = found ? found.entries.length + found.duplicates.length + found.invalid.length : 0;
  const percent = state.total ? Math.round((state.processed / state.total) * 100) : 0;

  return (
    <section className="shrink-0 border-b bg-amber-50/60 px-3 py-3 sm:px-4" aria-label="批量收藏">
      <div className="mx-auto max-w-3xl space-y-2">
        <div className="flex items-center gap-2">
          <h2 className="flex-1 text-sm font-semibold">批量收藏</h2>
          <button type="button" onClick={onClose} className="rounded-lg px-2 py-1 text-sm text-stone-600 hover:bg-stone-100">
            {state.running ? "收起（繼續處理）" : "關閉"}
          </button>
        </div>

        {!state.running && !state.finished && (
          <>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={5}
              placeholder={"每行一個網址，或直接貼上整段 LINE 訊息"}
              aria-label="批量網址"
              className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-[16px] focus:border-stone-500 focus:outline-none sm:text-sm"
            />
            <div className="flex items-center gap-2">
              <span className="flex-1 text-sm text-stone-600">{text.trim() ? `找到 ${count} 個網址` : "沒有筆數上限"}</span>
              <button
                type="button"
                disabled={count === 0}
                onClick={async () => {
                  if (await onStart(text)) setText("");
                }}
                className="rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
              >
                開始收藏
              </button>
            </div>
          </>
        )}

        {(state.running || state.finished) && (
          <div className="space-y-2" role="status" aria-live="polite">
            <div className="flex items-center justify-between text-sm">
              <span>{state.running ? "處理中…" : "完成"}</span>
              <span aria-label="進度">
                {state.processed} / {state.total}
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-stone-200">
              <div className="h-full bg-stone-800 transition-all" style={{ width: `${percent}%` }} />
            </div>
            <ul className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4" aria-label="收藏結果">
              <li className="rounded-lg bg-white px-3 py-2 ring-1 ring-stone-200">成功 <b data-count="added">{state.added}</b></li>
              <li className="rounded-lg bg-white px-3 py-2 ring-1 ring-stone-200">需補填資料 <b data-count="needs-fill">{state.needsFill}</b></li>
              <li className="rounded-lg bg-white px-3 py-2 ring-1 ring-stone-200">重複 <b data-count="duplicates">{state.duplicates}</b></li>
              <li className="rounded-lg bg-white px-3 py-2 ring-1 ring-stone-200">失敗 <b data-count="failed">{state.failed.length}</b></li>
            </ul>
            {state.finished && state.failed.length > 0 && (
              <label className="block text-sm">
                <span className="text-stone-600">失敗的網址（可複製後檢查再貼一次）：</span>
                <textarea readOnly value={state.failed.join("\n")} rows={Math.min(5, state.failed.length)} className="mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-xs" aria-label="失敗的網址" />
              </label>
            )}
            {state.finished && (
              <div className="flex justify-end">
                <button type="button" onClick={onReset} className="rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white">
                  再貼一批
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
