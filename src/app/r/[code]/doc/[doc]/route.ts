import { NextResponse, type NextRequest } from "next/server";
import { anonDb } from "@/lib/qr-public";

/** Descarga de un PDF desde el QR (remito firmado o factura de esa OC): link firmado de 5 minutos. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ code: string; doc: string }> }) {
  const { code, doc } = await params;
  if (!/^[A-Za-z0-9]{6,12}$/.test(code) || !/^[0-9a-f-]{36}$/i.test(doc)) return new NextResponse("No encontrado", { status: 404 });
  const db = anonDb();
  const { data: path } = await db.rpc("qr_doc_path", { p_code: code, p_doc: doc });
  if (typeof path !== "string" || !path) return new NextResponse("No encontrado", { status: 404 });
  const { data } = await db.storage.from("documents").createSignedUrl(path, 300);
  if (!data?.signedUrl) return new NextResponse("No se pudo abrir el archivo", { status: 404 });
  return NextResponse.redirect(data.signedUrl);
}
