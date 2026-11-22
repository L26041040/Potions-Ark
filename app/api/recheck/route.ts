import { recheckLinks } from "@/app/actions";

// Background link checks use a plain request for the same reason as batch adds:
// they must never hold up the shareholder's own actions.
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { ids?: unknown } | null;
  return Response.json(await recheckLinks(body?.ids));
}
