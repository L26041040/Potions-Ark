import { isOwnPhotoPath, openPhoto } from "@/lib/photos";

// Serves uploaded photos from the private store. Cached for a day so pages stay
// fast, short enough that a deleted photo stops being served soon after.

export async function GET(request: Request) {
  const pathname = new URL(request.url).searchParams.get("p") ?? "";
  if (!isOwnPhotoPath(pathname)) return new Response("Not found", { status: 404 });
  const photo = await openPhoto(pathname);
  if (!photo) return new Response("Not found", { status: 404 });
  return new Response(photo.body as BodyInit, {
    headers: {
      "Content-Type": photo.contentType,
      "Cache-Control": "public, max-age=86400, s-maxage=86400",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
