import { NextResponse, type NextRequest } from "next/server";
import { requireOrg } from "@/lib/session";
import { sessionRpc } from "@/lib/ml-rpc";
import { mlClient, pool, type ApiShipment } from "@/lib/ml/client";
import { recentSales } from "@/lib/ml/sync";
import { labelPrefs } from "@/lib/ml/prefs";

export const maxDuration = 60;

const page = (title: string, msg: string) => new NextResponse(
  `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#0b0b0c;color:#f4f4f5;font:15px system-ui,sans-serif">
<div style="max-width:420px;padding:24px;text-align:center"><h1 style="font-size:20px;margin:0 0 8px">${title}</h1><p style="color:#a1a1aa;margin:0 0 20px">${msg}</p>
<a href="/mercadolibre/ventas" style="color:#0b0b0c;background:#fafafa;padding:8px 14px;border-radius:8px;text-decoration:none;font-weight:500">Ver ventas</a></div></body></html>`,
  { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });

/**
 * Etiquetas de envío de Mercado Envíos (PDF o Zebra) para imprimir de una vez.
 * ?ids=1,2,3 → esas; ?auto=1 → las del día según la configuración (Mercado Libre → Ajustes → Etiquetas).
 */
export async function GET(req: NextRequest) {
  const s = await requireOrg();
  const ml = await mlClient(sessionRpc(s.supabase, s.org.org_id));
  if (!ml) return page("Mercado Libre no está conectado", "Conectá la cuenta para imprimir etiquetas.");
  let ids = (req.nextUrl.searchParams.get("ids") ?? "").split(",").filter((x) => /^\d{6,20}$/.test(x)).slice(0, 50);
  let zpl = req.nextUrl.searchParams.get("formato") === "zpl";

  if (req.nextUrl.searchParams.get("auto") === "1") {
    const { data: st } = await s.supabase.from("ml_settings").select("label_prefs").eq("org_id", s.org.org_id).maybeSingle();
    const p = labelPrefs(st?.label_prefs);
    zpl = p.format === "zpl";
    const today = new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);
    const orders = (await recentSales(ml, p.scope === "hoy" ? 2 : 20))
      .filter((o) => o.status !== "cancelled" && o.shipping?.id && (p.scope !== "hoy" || new Date(Date.parse(o.date_created) - 3 * 3600e3).toISOString().slice(0, 10) === today));
    const shipIds = [...new Set(orders.map((o) => o.shipping!.id!))].slice(0, 150);
    const ok: number[] = [];
    await pool(shipIds, 6, async (id) => {
      const r = await ml.get<ApiShipment>(`/shipments/${id}`);
      if (!r.ok) return;
      const sh = r.data;
      if (sh.status !== "ready_to_ship" || sh.logistic_type === "fulfillment") return;
      if (p.onlyNew && sh.substatus && sh.substatus !== "ready_to_print") return;
      if (sh.logistic_type === "self_service" && !p.flex) return;
      if (sh.logistic_type !== "self_service" && !p.colecta) return;
      ok.push(id);
    });
    ids = ok.slice(0, 50).map(String);
    if (!ids.length) return page("No hay etiquetas para imprimir", p.onlyNew ? "Todas las ventas listas para despachar ya tienen la etiqueta impresa, o no hay ventas para despachar." : "No hay ventas listas para despachar con esta configuración.");
  }
  if (!ids.length) return NextResponse.json({ error: "Sin envíos" }, { status: 400 });

  const r = await ml.raw(`/shipment_labels?shipment_ids=${ids.join(",")}&response_type=${zpl ? "zpl2" : "pdf"}`);
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    return page("No se pudieron bajar las etiquetas", (j as { message?: string }).message ?? `Mercado Libre respondió ${r.status}.`);
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
