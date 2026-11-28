"use server";
import { revalidatePath } from "next/cache";
import { requireOrg, canWrite } from "@/lib/session";
import { friendlyDbError } from "@/lib/errors";
import { parseRemitoBarcode, SCAN_DEFAULTS, type ScanSettings } from "@/lib/remito-barcode";
import { loadScanSettings } from "@/lib/remito-load";

export type ScanResult =
  | { ok: true; state: "confirmado" | "ya_estaba" | "confirmar"; id: string; label: string; recipient: string; po: string | null; status: string; action: ScanSettings["scan_action"] }
  | { ok: false; error: string };

const canAct = (role: string) => canWrite(role as never) || role === "logistica";

/** Lee el código de barras de un remito y lo confirma como entregado (o firmado), según los ajustes. */
export async function scanRemito(text: string, confirm = false): Promise<ScanResult> {
  const s = await requireOrg();
  if (!canAct(s.org.role)) return { ok: false, error: "Tu rol no permite confirmar remitos" };
  const code = parseRemitoBarcode(text);
  if (!code) return { ok: false, error: "No es un código de remito" };
  const { data: r } = await s.supabase.from("remitos_overview").select("id, label, recipient_name, po_number, status, purchase_order_id")
    .eq("org_id", s.org.org_id).eq("provisional", code.provisional).eq("point_of_sale", code.pos).eq("number", code.number).maybeSingle();
  if (!r) return { ok: false, error: "No encontré ese remito" };
  const settings = await loadScanSettings(s.supabase, s.org.org_id);
  const base = { id: r.id as string, label: r.label as string, recipient: r.recipient_name as string, po: (r.po_number as string) ?? null, action: settings.scan_action };
  if (r.status === "anulado") return { ok: false, error: `El remito ${r.label} está anulado` };
  const done = r.status === "firmado" || (settings.scan_action === "entregado" && r.status === "entregado");
  if (done) return { ok: true, state: "ya_estaba", status: r.status as string, ...base };
  if (settings.scan_confirm && !confirm) return { ok: true, state: "confirmar", status: r.status as string, ...base };
  const { error } = await s.supabase.rpc("remito_action", { p_id: r.id, p_kind: settings.scan_action, p_note: "Confirmado escaneando el código de barras", p_document: null });
  if (error) return { ok: false, error: friendlyDbError(error) };
  revalidatePath("/remitos"); revalidatePath(`/remitos/${r.id}`); revalidatePath("/remitos/firmar");
  if (r.purchase_order_id) revalidatePath(`/ordenes/${r.purchase_order_id}`);
  return { ok: true, state: "confirmado", status: settings.scan_action, ...base };
}

export async function saveScanSettings(v: ScanSettings): Promise<{ ok: true } | { ok: false; error: string }> {
  const s = await requireOrg();
  if (!canAct(s.org.role)) return { ok: false, error: "Tu rol no permite cambiar esto" };
  const val = { ...SCAN_DEFAULTS, ...v };
  if (!["entregado", "firmado"].includes(val.scan_action)) return { ok: false, error: "Opción inválida" };
  const { error } = await s.supabase.from("qr_settings").upsert({
    org_id: s.org.org_id, barcode_provisional: !!val.barcode_provisional, barcode_official: !!val.barcode_official,
    scan_action: val.scan_action, scan_confirm: !!val.scan_confirm, updated_at: new Date().toISOString(),
  });
  if (error) return { ok: false, error: friendlyDbError(error) };
  revalidatePath("/remitos/escanear");
  return { ok: true };
}
