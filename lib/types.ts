export type Status = "new" | "pending" | "rejected" | "shortlisted";

export const STATUSES: Status[] = ["new", "pending", "shortlisted", "rejected"];

export const STATUS_LABEL: Record<Status, string> = {
  new: "未討論",
  pending: "待確認",
  rejected: "不考慮",
  shortlisted: "確定考慮",
};

/** Link health of an item's original listing; independent of status. */
export type Health = "unchecked" | "ok" | "gone" | "unknown";

/** The result of one link check, always saved together. */
export type LinkCheck = { health: Health; healthAt: string | null; healthReason: string };

/** Store conditions shown as tags: 可餐飲, 可飲酒, 頂讓. */
export type TagKey = "food" | "alcohol" | "transfer";

export const TAG_KEYS: TagKey[] = ["food", "alcohol", "transfer"];

/** A shareholder's yes/no for one tag; always wins over what was read automatically. */
export type TagOverride = { value: boolean; by: string; at: string };

/** What a page read found for one tag, with the words that decided it. */
export type AutoTag = { value: boolean; evidence: string };

export type Photo = {
  id: string;
  /** "listing": shown straight from the listing site. "upload": stored in our Blob store. */
  source: "listing" | "upload";
  url: string;
  pathname?: string;
  createdBy?: string;
  createdAt?: string;
};

export type Item = {
  id: string;
  name: string;
  sourceUrl: string;
  coverUrl: string;
  info: string;
  address: string;
  rent: number | null;
  area: number | null;
  floor: string;
  /** Free text: agency, contact person, phone, LINE ID and other notes. */
  contact: string;
  /** 商圈或區域 typed by a shareholder; empty means it is worked out from the item's other data. */
  zone: string;
  /** Shareholders' settings for store-condition tags. */
  tagOverrides: Partial<Record<TagKey, TagOverride>>;
  /** Store-condition tags found in the 591 listing text when the page was read. */
  autoTags: Partial<Record<TagKey, AutoTag>>;
  photos: Photo[];
  embed: boolean;
  /**
   * Fields a person set: in the edit dialog, when adding by hand, or from a
   * shareholders' sheet import. Automatic page reads never overwrite these
   * unless the value is unusable (for example a name that only says 「591」).
   */
  manual: ManualField[];
  status: Status;
  health: Health;
  healthAt: string | null;
  healthReason: string;
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
  rent: number | null;
  area: number | null;
  floor: string;
  contact: string;
  zone: string;
  embed: boolean;
};

export type ManualField = Exclude<keyof ItemFields, "embed">;

export const MANUAL_FIELDS: ManualField[] = ["name", "sourceUrl", "coverUrl", "info", "address", "rent", "area", "floor", "contact", "zone"];

/** What happened to one link in a batch add. */
export type AddOutcome = {
  url: string;
  result: "added" | "duplicate" | "failed";
  id?: string;
  /** Added, but nothing could be read from the page, so it needs filling in by hand. */
  needsFill?: boolean;
  error?: string;
};

export type ActionResult =
  | { ok: true; doc: Doc; id?: string; outcomes?: AddOutcome[] }
  | { ok: false; error: string; doc?: Doc };

/** Fills fields added after an item was saved, so older data keeps working. */
export function normalizeItem(raw: Item): Item {
  return {
    ...raw,
    address: raw.address ?? "",
    rent: typeof raw.rent === "number" ? raw.rent : null,
    area: typeof raw.area === "number" ? raw.area : null,
    floor: raw.floor ?? "",
    contact: typeof raw.contact === "string" ? raw.contact : "",
    zone: typeof raw.zone === "string" ? raw.zone : "",
    tagOverrides: raw.tagOverrides && typeof raw.tagOverrides === "object" ? raw.tagOverrides : {},
    autoTags: raw.autoTags && typeof raw.autoTags === "object" ? raw.autoTags : {},
    photos: Array.isArray(raw.photos) ? raw.photos : [],
    manual: Array.isArray(raw.manual) ? raw.manual.filter((f) => (MANUAL_FIELDS as string[]).includes(f)) : [],
    health: raw.health ?? "unchecked",
    healthAt: raw.healthAt ?? null,
    healthReason: raw.healthReason ?? "",
  };
}

export function emptyDoc(): Doc {
  return { version: 1, items: [], entries: [] };
}

export function isStatus(value: unknown): value is Status {
  return typeof value === "string" && (STATUSES as string[]).includes(value);
}
