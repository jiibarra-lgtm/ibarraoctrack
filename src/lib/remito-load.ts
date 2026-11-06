import "server-only";
import QRCode from "qrcode";
import type { SupabaseClient } from "@supabase/supabase-js";
import { waLink, type RemitoRow, type RemitoSheetData } from "@/lib/remitos";

export async function loadRemito(sb: SupabaseClient, orgId: string, id: string) {
  const [{ data: r }, { data: items }] = await Promise.all([
    sb.from("remitos_overview").select("*").eq("id", id).eq("org_id", orgId).maybeSingle(),
    sb.from("remito_items").select("line_no, description, quantity, detail, purchase_order_item_id").eq("remito_id", id).order("line_no"),
  ]);
  if (!r) return null;
  const row = r as RemitoRow;
  const sheet: RemitoSheetData = {
    label: row.label, provisional: row.provisional, issuedAt: row.issued_at,
    recipient: { name: row.recipient_name, address: row.recipient_address ?? "", iva: row.recipient_iva ?? "", cuit: row.recipient_cuit ?? "" },
    items: (items ?? []).map((i) => ({ description: i.description, quantity: String(i.quantity), detail: i.detail ?? "" })),
    notes: row.notes ?? "", issuer: row.issuer, poNumber: row.po_number, voided: row.status === "anulado",
  };
  const url = waLink(row.issuer?.whatsapp ?? null);
  const qrSvg = url ? await QRCode.toString(url, { type: "svg", margin: 0, errorCorrectionLevel: "M" }) : null;
  return { row, sheet, qrSvg, items: items ?? [] };
}
