// Sends a shareholders' sheet, exported to a local JSON file, to /api/import
// in small batches. The JSON holds contact details, so keep it out of the
// repository (Claude Code writes it to its scratchpad).
//
// Usage: node scripts/import-sheet.mjs <base-url> <sheet.json> [--dry-run]
//   IMPORT_ID  names the backup taken before the first change (required; reuse it to re-run)
//   IMPORT_BY  shown as the author of notes and status changes (default 「試算表匯入」)
//   SHARE_URL  share link of a protected Vercel preview
//
// sheet.json: { "header": ["編號","標題",…,"聯絡方式"], "links": { "<編號>": "<column A hyperlink>" }, "values": [["1","標題",…], …] }

import { readFileSync } from "node:fs";

const [base, file, flag] = process.argv.slice(2);
const dryRun = flag === "--dry-run";
const importId = process.env.IMPORT_ID;
const by = process.env.IMPORT_BY || "試算表匯入";
const COLUMNS = ["標題", "決定", "理由", "備註", "租金", "大小", "挑高", "商圈", "地址", "聯絡方式"];
const ROWS_PER_CALL = 6;

if (!base || !file || !importId) {
  console.error("usage: IMPORT_ID=<id> node scripts/import-sheet.mjs <base-url> <sheet.json> [--dry-run]");
  process.exit(2);
}

const sheet = JSON.parse(readFileSync(file, "utf8"));
const header = sheet.header.map((h) => String(h).trim());
if (header[0] !== "編號" || COLUMNS.some((c, i) => header[i + 1] !== c)) {
  console.error("unexpected header:", header.join(","));
  process.exit(2);
}
const rows = sheet.values
  .filter((v) => v.length && String(v[0]).trim())
  .map((v) => ({ number: String(v[0]).trim(), link: sheet.links[String(v[0]).trim()] || "", cells: v.slice(1, 11).map((c) => String(c ?? "")) }));

async function shareCookie() {
  if (!process.env.SHARE_URL) return "";
  const res = await fetch(process.env.SHARE_URL, { redirect: "manual" });
  return (res.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
}

const cookie = await shareCookie();
const startedAt = new Date().toISOString();
const outcomes = [];
let backup;
for (let i = 0; i < rows.length; i += ROWS_PER_CALL) {
  const chunk = rows.slice(i, i + ROWS_PER_CALL);
  const res = await fetch(new URL("/api/import", base), {
    method: "POST",
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify({ importId, by, startedAt, dryRun, rows: chunk }),
  });
  const data = await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }));
  if (!data.ok) {
    console.error(`rows ${chunk[0].number}–${chunk.at(-1).number} failed: ${data.error}`);
    for (const r of chunk) outcomes.push({ ref: `#${r.number}`, result: "failed", error: data.error });
    continue;
  }
  backup ??= data.backup;
  outcomes.push(...data.outcomes);
  for (const o of data.outcomes) {
    console.log(`${o.ref.padEnd(4)} ${o.result.padEnd(9)} ${o.id ?? ""}${o.inTrash ? " (in recycle bin)" : ""}${o.changed?.length ? " " + o.changed.join(",") : ""}${o.error ? " " + o.error : ""}`);
  }
}

const count = (r) => outcomes.filter((o) => o.result === r).length;
console.log(
  JSON.stringify({ dryRun, rows: rows.length, added: count("added"), merged: count("merged"), unchanged: count("unchanged"), skipped: count("skipped"), failed: count("failed"), backup }, null, 2),
);
