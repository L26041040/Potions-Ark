import { importRows } from "@/lib/import";

// One-off merges of the shareholders' sheet, sent by Claude Code in small
// batches (see scripts/import-sheet.mjs). Every request backs up the data first.
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    return Response.json(await importRows(body));
  } catch (error) {
    console.error(error);
    return Response.json({ ok: false, error: error instanceof Error ? error.message : "匯入失敗" }, { status: 500 });
  }
}
