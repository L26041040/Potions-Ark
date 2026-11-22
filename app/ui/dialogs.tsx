"use client";

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { Item, ItemFields } from "@/lib/types";

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="max-h-[90dvh] w-full overflow-y-auto rounded-t-2xl bg-white p-4 shadow-xl sm:max-w-lg sm:rounded-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 className="mb-3 text-base font-semibold">{title}</h2>
        {children}
      </div>
    </div>
  );
}

const input = "w-full rounded-lg border border-stone-300 px-3 py-2 text-[16px] sm:text-sm focus:border-stone-500 focus:outline-none";

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm text-stone-600">{label}</span>
      {children}
    </label>
  );
}

export function NicknameDialog({ current, onSave, onCancel }: { current: string; onSave: (name: string) => void; onCancel: () => void }) {
  const [name, setName] = useState(current);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => ref.current?.focus(), []);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const value = name.replace(/\s+/g, " ").trim().slice(0, 20);
    if (value) onSave(value);
  };
  return (
    <Modal title="你的暱稱" onClose={onCancel}>
      <form onSubmit={submit} className="space-y-3">
        <p className="text-sm text-stone-600">留言與狀態紀錄會顯示這個名字。只存在這台裝置，不需要註冊。</p>
        <input ref={ref} value={name} onChange={(e) => setName(e.target.value)} maxLength={20} placeholder="例如：阿明" className={input} aria-label="暱稱" />
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="rounded-lg px-3 py-2 text-sm text-stone-600 hover:bg-stone-100">取消</button>
          <button type="submit" disabled={!name.trim()} className="rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40">確定</button>
        </div>
      </form>
    </Modal>
  );
}

export function ItemDialog({
  mode,
  item,
  busy,
  onSubmit,
  onCancel,
}: {
  mode: "add" | "edit";
  item?: Item;
  busy: boolean;
  onSubmit: (fields: ItemFields) => void;
  onCancel: () => void;
}) {
  const [fields, setFields] = useState<ItemFields>({
    name: item?.name ?? "",
    sourceUrl: item?.sourceUrl ?? "",
    coverUrl: item?.coverUrl ?? "",
    info: item?.info ?? "",
    address: item?.address ?? "",
    rent: item?.rent ?? null,
    area: item?.area ?? null,
    embed: item?.embed ?? true,
  });
  const [rentText, setRentText] = useState(item?.rent != null ? String(item.rent) : "");
  const [areaText, setAreaText] = useState(item?.area != null ? String(item.area) : "");
  const set = <K extends keyof ItemFields>(key: K, value: ItemFields[K]) => setFields((f) => ({ ...f, [key]: value }));
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const toNumber = (t: string) => (t.trim() ? Number(t.replace(/,/g, "")) : null);
    if (fields.name.trim()) onSubmit({ ...fields, rent: toNumber(rentText), area: toNumber(areaText) });
  };
  return (
    <Modal title={mode === "add" ? "手動新增物件" : "編輯物件"} onClose={onCancel}>
      <form onSubmit={submit} className="space-y-3">
        <Field label="名稱（必填）">
          <input value={fields.name} onChange={(e) => set("name", e.target.value)} maxLength={120} className={input} autoFocus={mode === "add"} />
        </Field>
        <Field label="簡單資訊（租金、坪數、樓層等）">
          <textarea value={fields.info} onChange={(e) => set("info", e.target.value)} maxLength={500} rows={3} className={input} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="月租金（元）">
            <input value={rentText} onChange={(e) => setRentText(e.target.value)} inputMode="numeric" placeholder="例如 45000" className={input} />
          </Field>
          <Field label="坪數">
            <input value={areaText} onChange={(e) => setAreaText(e.target.value)} inputMode="decimal" placeholder="例如 24.5" className={input} />
          </Field>
        </div>
        <Field label="地址（填了才會出現 Google Maps 連結）">
          <input value={fields.address} onChange={(e) => set("address", e.target.value)} maxLength={200} className={input} />
        </Field>
        <Field label="原始網址">
          <input value={fields.sourceUrl} onChange={(e) => set("sourceUrl", e.target.value)} inputMode="url" placeholder="https://" className={input} />
        </Field>
        {mode === "edit" && (
          <>
            <Field label="封面圖片網址">
              <input value={fields.coverUrl} onChange={(e) => set("coverUrl", e.target.value)} inputMode="url" placeholder="https://" className={input} />
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={fields.embed} onChange={(e) => set("embed", e.target.checked)} className="h-4 w-4" />
              允許在本站嵌入原始網頁（選配；畫面空白或被拒絕時請取消勾選）
            </label>
          </>
        )}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onCancel} className="rounded-lg px-3 py-2 text-sm text-stone-600 hover:bg-stone-100">取消</button>
          <button type="submit" disabled={busy || !fields.name.trim()} className="rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40">
            {busy ? "儲存中…" : mode === "add" ? "新增" : "儲存"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
