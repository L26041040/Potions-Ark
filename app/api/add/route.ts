import { addUrls } from "@/app/actions";

// Batch adds go through a plain request rather than a Server Action: Next.js
// runs a browser's Server Actions one at a time, so a long batch would make
// every status change, note or comment wait behind it.
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { entries?: unknown; nickname?: unknown } | null;
  return Response.json(await addUrls(body?.entries, body?.nickname));
}
