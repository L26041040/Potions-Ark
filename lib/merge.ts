// Pure rules for turning a read page or a sheet row into an item, and for
// merging a sheet row into an item that already exists. Shared by adding
// links and by the sheet import, so both follow the same priorities:
// what a shareholder entered > the shareholders' sheet > what a page read found.

import { listingKey } from "./listing";
import { isGenericDescription, isGenericTitle } from "./meta";
import type { ImportRecord } from "./sheet";
import type { Doc, Item, ManualField, Photo } from "./types";
import { hostOf } from "./url";

/** What one page read found (a subset of the server's preview). */
export type PageFacts = {
  fetched: boolean;
  title: string;
  image: string;
  description: string;
  contact: string;
  tags: Item["autoTags"];
  photos: string[];
  rent: number | null;
  area: number | null;
  address: string;
  floor: string;
  embed: boolean;
  health: Item["health"];
  healthReason: string;
};

export const NO_PAGE: PageFacts = {
  fetched: false,
  title: "",
  image: "",
  description: "",
  contact: "",
  tags: {},
  photos: [],
  rent: null,
  area: null,
  address: "",
  floor: "",
  embed: true,
  health: "unchecked",
  healthReason: "",
};

type Ids = () => string;

/**
 * The item a link refers to: the same saved link, or the same 591 listing in
 * any link form. `resolved` maps item ids saved with a share link (591.to) to
 * the listing link it points to.
 */
export function findSameListing(
  items: Item[],
  url: string,
  options: { includeDeleted: boolean; resolved?: Map<string, string> },
): Item | undefined {
  const key = listingKey(url);
  return items.find((item) => {
    if (item.deletedAt && !options.includeDeleted) return false;
    if (item.sourceUrl === url) return true;
    if (!key) return false;
    return (listingKey(item.sourceUrl) ?? listingKey(options.resolved?.get(item.id) ?? "")) === key;
  });
}

function listingPhotos(urls: string[], newId: Ids): Photo[] {
  return urls.map((url) => ({ id: newId(), source: "listing", url }));
}

/** A new item from a page read. `typedName` is text pasted next to the link, used when the page has no title. */
export function itemFromPage(id: string, url: string, typedName: string, page: PageFacts, who: string, now: string, newId: Ids): Item {
  const title = page.title && !isGenericTitle(page.title) ? page.title : "";
  const name = title || typedName || `來自 ${hostOf(url)} 的物件`;
  return {
    id,
    name,
    sourceUrl: url,
    coverUrl: page.image,
    info: isGenericDescription(page.description) ? "" : page.description,
    address: page.address,
    rent: page.rent,
    area: page.area,
    floor: page.floor,
    contact: page.contact,
    zone: "",
    tagOverrides: {},
    autoTags: page.tags,
    photos: listingPhotos(page.photos, newId),
    embed: page.embed,
    manual: !title && typedName ? ["name"] : [],
    health: page.health,
    healthAt: page.health === "unchecked" ? null : now,
    healthReason: page.healthReason,
    status: "new",
    note: "",
    noteBy: "",
    noteAt: null,
    createdBy: who,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    deletedBy: "",
  };
}

export type MergeOutcome = {
  ref: string;
  result: "added" | "merged" | "unchanged" | "skipped" | "failed";
  id?: string;
  /** The matching item is in the recycle bin; it was merged but left there. */
  inTrash?: boolean;
  changed?: string[];
  error?: string;
};

export type MergeContext = {
  by: string;
  now: string;
  /** createdAt for a new item; lets an import keep the sheet's order in the newest-first list. */
  createdAt: string;
  newId: Ids;
  page?: PageFacts;
  resolved?: Map<string, string>;
};

function mark(item: Item, field: ManualField) {
  if (!item.manual.includes(field)) item.manual = [...item.manual, field];
}

function joinInfo(base: string, extra: string): string {
  return [base, extra].filter(Boolean).join("\n").slice(0, 500);
}

/**
 * Applies one sheet row to the document: merges it into the item for the same
 * listing (even one in the recycle bin) or adds a new item. Never clears
 * decisions, notes, comments or photos, and running it twice changes nothing.
 */
export function applyRecord(doc: Doc, record: ImportRecord, ctx: MergeContext): MergeOutcome {
  const page = ctx.page;
  const existing = findSameListing(doc.items, record.sourceUrl, { includeDeleted: true, resolved: ctx.resolved });

  if (!existing) {
    const item = itemFromPage(ctx.newId(), record.sourceUrl, record.name, page ?? NO_PAGE, ctx.by, ctx.createdAt, ctx.newId);
    item.name = record.name;
    item.manual = ["name"];
    if (record.rent !== null) item.rent = record.rent;
    if (record.area !== null) item.area = record.area;
    if (record.address) item.address = record.address;
    if (record.contact) item.contact = record.contact;
    for (const field of ["rent", "area", "address", "contact"] as const) if (record[field]) mark(item, field);
    item.info = joinInfo(item.info, record.info);
    if (record.note) Object.assign(item, { note: record.note, noteBy: ctx.by, noteAt: ctx.now });
    if (record.status !== "new") {
      doc.entries.push({ id: ctx.newId(), itemId: item.id, kind: "status", body: "", from: "new", to: record.status, nickname: ctx.by, createdAt: ctx.now });
      item.status = record.status;
    }
    item.updatedAt = ctx.now;
    doc.items.push(item);
    return { ref: record.ref, result: "added", id: item.id };
  }

  const item = existing;
  const changed: string[] = [];

  // Sheet values replace what a page read found, but not what a person entered, unless that is unusable.
  if (item.name !== record.name && (!item.manual.includes("name") || isGenericTitle(item.name))) {
    item.name = record.name;
    changed.push("name");
  }
  mark(item, "name");
  for (const field of ["rent", "area"] as const) {
    const value = record[field];
    if (value === null) continue;
    if (item[field] !== value && (!item.manual.includes(field) || item[field] === null)) {
      item[field] = value;
      changed.push(field);
    }
    mark(item, field);
  }
  for (const field of ["address", "contact"] as const) {
    const value = record[field];
    if (!value) continue;
    if (item[field] !== value && (!item.manual.includes(field) || !item[field])) {
      item[field] = value;
      changed.push(field);
    }
    mark(item, field);
  }

  // 591's site-wide description is not information about the listing.
  if (isGenericDescription(item.info)) {
    item.info = page && !isGenericDescription(page.description) ? page.description : "";
    changed.push("info");
  }
  if (record.info && !item.info.includes(record.info)) {
    item.info = joinInfo(item.info, record.info);
    changed.push("info");
  }

  if (record.note && !item.note.includes(record.note)) {
    item.note = item.note ? `${item.note}\n\n${record.note}` : record.note;
    item.noteBy = ctx.by;
    item.noteAt = ctx.now;
    changed.push("note");
  }

  // Only an undecided item takes the sheet's decision; shareholders' decisions stay.
  if (record.status !== "new" && item.status === "new") {
    doc.entries.push({ id: ctx.newId(), itemId: item.id, kind: "status", body: "", from: "new", to: record.status, nickname: ctx.by, createdAt: ctx.now });
    item.status = record.status;
    changed.push("status");
  }

  // A share link (591.to) is replaced by the listing link, unless another item already has it.
  if (item.sourceUrl !== record.sourceUrl && !listingKey(item.sourceUrl) && !doc.items.some((i) => i !== item && i.sourceUrl === record.sourceUrl)) {
    item.sourceUrl = record.sourceUrl;
    changed.push("sourceUrl");
  }

  if (page?.fetched) {
    if (page.photos.length && !item.photos.some((p) => p.source === "listing")) {
      item.photos = [...listingPhotos(page.photos, ctx.newId), ...item.photos];
      changed.push("photos");
    }
    // Page facts only fill what is still empty.
    const fill = <K extends "coverUrl" | "floor" | "address" | "contact" | "info">(field: K, value: string) => {
      if (!item[field] && value) {
        item[field] = value;
        changed.push(field);
      }
    };
    fill("coverUrl", page.image);
    fill("floor", page.floor);
    fill("address", page.address);
    fill("contact", page.contact);
    fill("info", isGenericDescription(page.description) ? "" : page.description);
    if (JSON.stringify(item.autoTags) !== JSON.stringify(page.tags)) {
      item.autoTags = page.tags;
      changed.push("autoTags");
    }
    for (const field of ["rent", "area"] as const) {
      if (item[field] === null && page[field] !== null) {
        item[field] = page[field];
        changed.push(field);
      }
    }
  }
  if (page && page.health !== "unchecked") {
    Object.assign(item, { health: page.health, healthAt: ctx.now, healthReason: page.healthReason });
    changed.push("health");
  }

  const unique = [...new Set(changed)];
  if (unique.length) item.updatedAt = ctx.now;
  return { ref: record.ref, result: unique.length ? "merged" : "unchanged", id: item.id, inTrash: Boolean(item.deletedAt), changed: unique };
}
