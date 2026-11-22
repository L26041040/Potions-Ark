// Pure helpers for the free-text contact field (聯絡資訊): finding phone
// numbers and LINE IDs, to turn them into links, to pull them out of a
// listing's public text, and to search by phone number.

const PHONE =
  /(?<!\d)(?:\(0\d{1,2}\)\s?\d{3,4}[-\s]?\d{4}|09\d{2}[-\s]?\d{3}[-\s]?\d{3}|0[2-8]\d{0,2}[-\s]?\d{3,4}[-\s]?\d{4})(?!\d)/g;
// "@abc1234" (not part of an e-mail address) or "LINE ID：abc123" / "Line：tester99".
const LINE_AT = /(?<![\w.%+\-@])@[A-Za-z0-9._-]{3,20}/g;
const LINE_LABELED = /(?:line|賴)\s*(?:id)?\s*[:：]\s*(@?[A-Za-z0-9._-]{3,20})/gi;

export type ContactPart = { kind: "text" | "tel" | "line"; text: string; href?: string };

type Found = { start: number; end: number; kind: "tel" | "line"; text: string };

function telHref(phone: string): string {
  return "tel:" + phone.replace(/[^\d+]/g, "");
}

function lineHref(id: string): string {
  // Official accounts start with @; personal IDs use the ~ form.
  return id.startsWith("@") ? `https://line.me/R/ti/p/${encodeURIComponent(id)}` : `https://line.me/ti/p/~${encodeURIComponent(id)}`;
}

function find(text: string): Found[] {
  const found: Found[] = [];
  for (const m of text.matchAll(PHONE)) found.push({ start: m.index, end: m.index + m[0].length, kind: "tel", text: m[0] });
  for (const m of text.matchAll(LINE_AT)) found.push({ start: m.index, end: m.index + m[0].length, kind: "line", text: m[0] });
  for (const m of text.matchAll(LINE_LABELED)) {
    const id = m[1];
    if (/^\d+$/.test(id.replace(/^@/, ""))) continue; // a phone number used as a LINE ID is linked as a phone
    const start = m.index + m[0].length - id.length;
    found.push({ start, end: start + id.length, kind: "line", text: id });
  }
  found.sort((a, b) => a.start - b.start || b.end - a.end);
  const kept: Found[] = [];
  for (const f of found) if (!kept.length || f.start >= kept[kept.length - 1].end) kept.push(f);
  return kept;
}

/** Splits contact text into plain text, phone links (tel:) and LINE links. */
export function contactParts(text: string): ContactPart[] {
  const parts: ContactPart[] = [];
  let at = 0;
  for (const f of find(text)) {
    if (f.start > at) parts.push({ kind: "text", text: text.slice(at, f.start) });
    parts.push({ kind: f.kind, text: f.text, href: f.kind === "tel" ? telHref(f.text) : lineHref(f.text) });
    at = f.end;
  }
  if (at < text.length) parts.push({ kind: "text", text: text.slice(at) });
  return parts;
}

function unique(values: string[], key: (v: string) => string): string[] {
  const seen = new Set<string>();
  return values.filter((v) => {
    const k = key(v);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Phone numbers in the text, each once, in order. */
export function findPhones(text: string): string[] {
  return unique(
    find(text).filter((f) => f.kind === "tel").map((f) => f.text.replace(/\s+/g, "")),
    (v) => v.replace(/\D/g, ""),
  );
}

/** LINE IDs in the text, each once, in order. */
export function findLineIds(text: string): string[] {
  return unique(
    find(text).filter((f) => f.kind === "line").map((f) => f.text),
    (v) => v.replace(/^@/, "").toLowerCase(),
  );
}

/** Tidies pasted contact text: one space between words, no empty lines. */
export function tidyContact(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t 　]+/g, " ").trim())
    .filter(Boolean)
    .join("\n")
    .slice(0, 1000);
}

/** True when a search for digits (「0912345678」 or 「0912-345-678」) matches a phone number in the text. */
export function matchesPhone(text: string, query: string): boolean {
  const digits = query.replace(/[\s\-()]/g, "");
  if (!/^\d{4,}$/.test(digits)) return false;
  return (text.match(/\d[\d \-()]*\d/g) ?? []).some((run) => run.replace(/\D/g, "").includes(digits));
}
