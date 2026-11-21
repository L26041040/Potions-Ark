import { connection } from "next/server";
import { readDoc } from "@/lib/store";
import type { Doc } from "@/lib/types";
import App from "./ui/app";

export default async function Page({ searchParams }: PageProps<"/">) {
  await connection();
  const params = await searchParams;
  const item = typeof params.item === "string" ? params.item : null;
  let doc: Doc | null = null;
  try {
    doc = await readDoc();
  } catch (error) {
    console.error(error);
  }
  if (!doc) {
    return (
      <main className="mx-auto max-w-md p-8 text-center">
        <h1 className="text-lg font-semibold">暫時讀不到資料</h1>
        <p className="mt-2 text-sm text-stone-600">請稍後重新整理。若持續發生，請通知管理網站的人。</p>
      </main>
    );
  }
  return <App initialDoc={doc} initialItemId={item} />;
}
