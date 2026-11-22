"use client";

import { useState, useSyncExternalStore } from "react";
import { STATUS_LABEL, STATUSES, type Item, type Status } from "@/lib/types";

export const STATUS_STYLE: Record<Status, { badge: string; active: string }> = {
  new: { badge: "bg-stone-100 text-stone-700 ring-stone-300", active: "bg-stone-700 text-white ring-stone-700" },
  pending: { badge: "bg-amber-50 text-amber-800 ring-amber-300", active: "bg-amber-500 text-white ring-amber-500" },
  shortlisted: { badge: "bg-emerald-50 text-emerald-800 ring-emerald-300", active: "bg-emerald-600 text-white ring-emerald-600" },
  rejected: { badge: "bg-rose-50 text-rose-700 ring-rose-300", active: "bg-rose-600 text-white ring-rose-600" },
};

export function StatusBadge({ status, className = "" }: { status: Status; className?: string }) {
  return (
    <span className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${STATUS_STYLE[status].badge} ${className}`}>
      {STATUS_LABEL[status]}
    </span>
  );
}

/** Link health on cards: loud for a removed listing, quiet when it could not be confirmed. */
export function HealthBadge({ item, className = "" }: { item: Item; className?: string }) {
  if (!item.sourceUrl || item.deletedAt) return null;
  if (item.health === "gone") {
    return (
      <span className={`inline-flex shrink-0 items-center rounded-full bg-rose-600 px-2 py-0.5 text-xs font-semibold text-white ${className}`} title={item.healthReason}>
        已失效
      </span>
    );
  }
  if (item.health === "unknown") {
    return (
      <span className={`inline-flex shrink-0 items-center rounded-full bg-white/90 px-1.5 py-0.5 text-[11px] text-stone-500 ring-1 ring-stone-300 ${className}`} title={`無法確認：${item.healthReason}`}>
        無法確認
      </span>
    );
  }
  return null;
}

export function StatusButtons({ status, onChange, className = "" }: { status: Status; onChange: (s: Status) => void; className?: string }) {
  return (
    <div className={`flex gap-1.5 ${className}`} role="group" aria-label="狀態">
      {STATUSES.map((s) => (
        <button
          key={s}
          type="button"
          aria-pressed={s === status}
          onClick={() => s !== status && onChange(s)}
          className={`flex-1 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-sm font-medium ring-1 transition sm:flex-none ${
            s === status ? STATUS_STYLE[s].active : "bg-white text-stone-700 ring-stone-300 hover:bg-stone-50"
          }`}
        >
          {STATUS_LABEL[s]}
        </button>
      ))}
    </div>
  );
}

const PALETTES = ["from-sky-100 to-sky-200", "from-amber-100 to-amber-200", "from-emerald-100 to-emerald-200", "from-violet-100 to-violet-200", "from-rose-100 to-rose-200"];

function NameBlock({ name, className }: { name: string; className: string }) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return (
    <div className={`flex items-center justify-center bg-gradient-to-br ${PALETTES[h % PALETTES.length]} ${className}`}>
      <span className="line-clamp-3 px-3 text-center text-sm font-medium text-stone-700">{name}</span>
    </div>
  );
}

function CoverImage({ src, name, className }: { src: string; name: string; className: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <NameBlock name={name} className={className} />;
  return (
    // Covers come from the listing sites themselves; nothing is copied or stored.
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(true)} className={`object-cover ${className}`} />
  );
}

export function Cover({ item, className = "" }: { item: Item; className?: string }) {
  const src = item.coverUrl || item.photos[0]?.url;
  if (!src) return <NameBlock name={item.name} className={className} />;
  return <CoverImage key={src} src={src} name={item.name} className={className} />;
}

const TIME = new Intl.DateTimeFormat("zh-TW", {
  timeZone: "Asia/Taipei",
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

export function formatTime(iso: string | null): string {
  return iso ? TIME.format(new Date(iso)) : "";
}

/**
 * Opens the listing in one reusable side window so it can sit next to this site.
 * The opener link is kept on purpose: browsers only find a named window again
 * while that link exists, and reusing the window is what allows side-by-side use.
 */
export function openSource(url: string) {
  const win = window.open("", "potions-source");
  if (!win) {
    window.open(url, "_blank", "noopener,noreferrer");
    return;
  }
  win.location.href = url;
  win.focus();
}

// Nickname: kept only in this browser.
const NICK_KEY = "potions-nickname";
const nickListeners = new Set<() => void>();
let memoryNick = "";

export function readNick(): string {
  try {
    return localStorage.getItem(NICK_KEY) ?? memoryNick;
  } catch {
    return memoryNick;
  }
}

function subscribeNick(callback: () => void) {
  nickListeners.add(callback);
  window.addEventListener("storage", callback);
  return () => {
    nickListeners.delete(callback);
    window.removeEventListener("storage", callback);
  };
}

export function storeNickname(value: string) {
  memoryNick = value;
  try {
    localStorage.setItem(NICK_KEY, value);
  } catch {
    // Private browsing: the in-memory copy lasts until the page closes.
  }
  nickListeners.forEach((l) => l());
}

export function useNickname(): string {
  return useSyncExternalStore(subscribeNick, readNick, () => "");
}

function subscribeWidth(callback: () => void) {
  const mq = window.matchMedia("(min-width: 1024px)");
  mq.addEventListener("change", callback);
  return () => mq.removeEventListener("change", callback);
}

/** null until the browser tells us the screen size. */
export function useIsDesktop(): boolean | null {
  return useSyncExternalStore<boolean | null>(subscribeWidth, () => window.matchMedia("(min-width: 1024px)").matches, () => null);
}
