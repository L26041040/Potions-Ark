import { isOwnPhotoPath, openPhoto } from "@/lib/photos";

// Serves uploaded photos from the private store. The path carries a random
// suffix and never changes, so the response can be cached for a long time.

export async function GET(request: Request) {
  const pathname = new URL(request.url).searchParams.get("p") ?? "";
  if (!isOwnPhotoPath(pathname)) return new Response("Not found", { status: 404 });
  const photo = await openPhoto(pathname);
  if (!photo) return new Response("Not found", { status: 404 });
  return new Response(photo.body as BodyInit, {
    headers: {
      "Content-Type": photo.contentType,
      "Cache-Control": "public, max-age=31536000, s-maxage=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
