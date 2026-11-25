import { NextResponse, type NextRequest } from "next/server";
import { requireOrg } from "@/lib/session";
import { sessionRpc } from "@/lib/ml-rpc";
import { mlClient } from "@/lib/ml/client";

/** Etiquetas de envío de Mercado Envíos (PDF o Zebra) para imprimir de una vez. */
export async function GET(req: NextRequest) {
  const s = await requireOrg();
  const ids = (req.nextUrl.searchParams.get("ids") ?? "").split(",").filter((x) => /^\d{6,20}$/.test(x)).slice(0, 50);
  const zpl = req.nextUrl.searchParams.get("formato") === "zpl";
  if (!ids.length) return NextResponse.json({ error: "Sin envíos" }, { status: 400 });
  const ml = await mlClient(sessionRpc(s.supabase, s.org.org_id));
  if (!ml) return NextResponse.json({ error: "Mercado Libre no está conectado" }, { status: 400 });
  const r = await ml.raw(`/shipment_labels?shipment_ids=${ids.join(",")}&response_type=${zpl ? "zpl2" : "pdf"}`);
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    return NextResponse.json({ error: (j as { message?: string }).message ?? `No se pudo bajar (${r.status})` }, { status: 400 });
  }
  const body = await r.arrayBuffer();
  return new NextResponse(body, {
    headers: {
      "content-type": zpl ? "application/zip" : "application/pdf",
      "content-disposition": `${zpl ? "attachment" : "inline"}; filename="etiquetas-${new Date().toISOString().slice(0, 10)}.${zpl ? "zip" : "pdf"}"`,
      "cache-control": "no-store",
    },
  });
}
