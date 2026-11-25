import { NextResponse, type NextRequest } from "next/server";
import { requireOrg } from "@/lib/session";
import { geminiDownload, geminiVideoStatus } from "@/lib/gemini";

/** Entrega el video generado por Gemini (la descarga necesita la clave, que queda en el servidor). */
export async function GET(req: NextRequest) {
  await requireOrg();
  const op = req.nextUrl.searchParams.get("op") ?? "";
  try {
    const st = await geminiVideoStatus(op);
    if (!st.done) return NextResponse.json({ error: "Todavía se está generando" }, { status: 409 });
    const r = await geminiDownload(st.uri);
    return new NextResponse(r.body, { headers: { "content-type": "video/mp4", "content-disposition": `inline; filename="video-producto.mp4"`, "cache-control": "private, max-age=3600" } });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
