// Maps rows of the shareholders' location sheet (地點資訊整理) to import
// records. Pure: the sheet itself is read by Claude Code with an authorized
// Google connector and never stored in the repository.

import { tidyContact } from "./contact";
import { STATUS_LABEL, STATUSES, type Status } from "./types";
import { cleanUrl } from "./url";

/** Columns B–K, in order. Column A holds the number; its hyperlink is the 591 link. */
export const SHEET_COLUMNS = ["標題", "決定", "理由", "備註", "租金", "大小", "挑高", "商圈", "地址", "聯絡方式"] as const;

export type SheetRow = {
  /** The sheet's 編號 (column A text). */
  number: string;
  /** Column A's hyperlink. */
  link: string;
  /** Columns B–K in SHEET_COLUMNS order; missing trailing cells may be left out. */
  cells: string[];
};

export type ImportRecord = {
  ref: string;
  order: number;
  sourceUrl: string;
  name: string;
  status: Status;
  /** The 理由／備註 block appended to the item's 重要備註; empty when the row has neither. */
  note: string;
  /** NT$ per month (the sheet writes 萬元). */
  rent: number | null;
  area: number | null;
  /** 挑高, 商圈 and a compound 大小 such as 56(33+23), kept in full. */
  info: string;
  address: string;
  contact: string;
};

/** A row that is not imported; `blank` marks rows that only have a number. */
export type RowProblem = { ref: string; error: string; blank?: boolean };

function line(value: string | undefined): string {
  return (value ?? "").replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();
}

function block(value: string | undefined): string {
  return (value ?? "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .join("\n");
}

function isBlank(value: string): boolean {
  return !value || /^[?？\-–—]+$/.test(value);
}

function toStatus(value: string): Status {
  const v = value.trim();
  if (/^[xX✗✕×]$/.test(v)) return "rejected";
  return STATUSES.find((s) => STATUS_LABEL[s] === v) ?? "new";
}

/** The sheet writes rent in 萬元: 15.6 → 156,000. */
export function parseRent(value: string): number | null {
  const v = line(value).replace(/,/g, "").replace(/萬.*$/, "");
  if (!/^\d+(?:\.\d+)?$/.test(v)) return null;
  const rent = Math.round(Number(v) * 10_000);
  return rent > 0 && rent <= 100_000_000 ? rent : null;
}

/**
 * 坪數 from 大小: a plain number, a total with its parts 「56(33+23)」 (the
 * total), or parts only 「24.92+10.25」 (their sum). `compound` tells whether
 * the original text should be kept alongside.
 */
export function parseArea(value: string): { area: number | null; compound: boolean } {
  const v = line(value).replace(/坪/g, "").replace(/\s+/g, "");
  if (!v) return { area: null, compound: false };
  const round = (n: number) => Math.round(n * 100) / 100;
  if (/^\d+(?:\.\d+)?$/.test(v)) return { area: round(Number(v)) || null, compound: false };
  const total = v.match(/^(\d+(?:\.\d+)?)[(（][\d.+]+[)）]$/);
  if (total) return { area: round(Number(total[1])) || null, compound: true };
  if (/^\d+(?:\.\d+)?(?:\+\d+(?:\.\d+)?)+$/.test(v)) {
    return { area: round(v.split("+").reduce((sum, n) => sum + Number(n), 0)) || null, compound: true };
  }
  return { area: null, compound: true };
}

export function recordFromRow(row: SheetRow): ImportRecord | RowProblem {
  const ref = `#${line(row.number) || "?"}`;
  const [title, decision, reason, remark, rent, size, height, district, address, contact] = SHEET_COLUMNS.map((_, i) => row.cells[i] ?? "");
  const name = line(title).slice(0, 120);
  const sourceUrl = row.link ? cleanUrl(row.link.trim()) : null;
  if (!name && !sourceUrl) return { ref, error: "空白列（只有編號），不匯入", blank: true };
  if (!name) return { ref, error: "沒有標題" };
  if (!sourceUrl) return { ref, error: "編號欄沒有 591 連結" };

  const reasonText = block(reason);
  const remarkText = block(remark);
  const note = [reasonText && `理由：${reasonText}`, remarkText && `備註：${remarkText}`].filter(Boolean).join("\n");

  const sizeText = line(size);
  const { area, compound } = parseArea(sizeText);
  const heightText = line(height);
  const districtText = line(district);
  const info = [
    !isBlank(heightText) && `挑高：${heightText}`,
    !isBlank(districtText) && `商圈：${districtText}`,
    compound && `坪數：${sizeText}`,
  ]
    .filter(Boolean)
    .join("｜");

  return {
    ref,
    order: Number.parseInt(row.number, 10) || 0,
    sourceUrl,
    name,
    status: toStatus(decision),
    note,
    rent: parseRent(rent),
    area,
    info,
    address: line(address).slice(0, 200),
    contact: tidyContact(contact),
  };
}

export function isProblem(value: ImportRecord | RowProblem): value is RowProblem {
  return "error" in value;
}
