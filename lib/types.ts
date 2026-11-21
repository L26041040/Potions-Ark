export type Status = "new" | "pending" | "rejected" | "shortlisted";

export const STATUSES: Status[] = ["new", "pending", "shortlisted", "rejected"];

export const STATUS_LABEL: Record<Status, string> = {
  new: "未討論",
  pending: "待確認",
  rejected: "不考慮",
  shortlisted: "確定考慮",
};

export type Item = {
  id: string;
  name: string;
  sourceUrl: string;
  coverUrl: string;
  info: string;
  address: string;
  embed: boolean;
  status: Status;
  note: string;
  noteBy: string;
  noteAt: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  deletedBy: string;
};

export type Entry = {
  id: string;
  itemId: string;
  kind: "comment" | "status";
  body: string;
  from: Status | null;
  to: Status | null;
  nickname: string;
  createdAt: string;
};

export type Doc = {
  version: 1;
  items: Item[];
  entries: Entry[];
};

export type ItemFields = {
  name: string;
  sourceUrl: string;
  coverUrl: string;
  info: string;
  address: string;
  embed: boolean;
};

export type ActionResult =
  | { ok: true; doc: Doc; id?: string; existing?: boolean; fetched?: boolean }
  | { ok: false; error: string; doc?: Doc };

export function emptyDoc(): Doc {
  return { version: 1, items: [], entries: [] };
}

export function isStatus(value: unknown): value is Status {
  return typeof value === "string" && (STATUSES as string[]).includes(value);
}
