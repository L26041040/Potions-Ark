import { matchesPhone } from "./contact";
import type { Item } from "./types";

/** Search over title, information, address, notes and contact details; phone numbers match with or without dashes. */
export function matchesQuery(item: Item, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if ([item.name, item.info, item.address, item.note, item.contact].some((t) => t.toLowerCase().includes(q))) return true;
  return matchesPhone(item.contact, q) || matchesPhone(item.note, q);
}
