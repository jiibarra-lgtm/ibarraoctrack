import "server-only";
import { headers } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";
import { type RemitoRow, type RemitoSheetData } from "@/lib/remitos";
import { QR_DEFAULTS, qrSvg as makeQr, qrUrl, type QrSettings } from "@/lib/qr";
import { SCAN_DEFAULTS, remitoBarcodeValue, type ScanSettings } from "@/lib/remito-barcode";
import { remitoBarcodeSvg } from "@/lib/remito-barcode-svg";

/** Dirección de la app (para armar el link del QR). */
export async function appOrigin() {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "ibarraoctrack.vercel.app";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

export async function loadScanSettings(sb: SupabaseClient, orgId: string): Promise<ScanSettings> {
  const { data } = await sb.from("qr_settings").select("barcode_provisional, barcode_official, scan_action, scan_confirm").eq("org_id", orgId).maybeSingle();
  return { ...SCAN_DEFAULTS, ...(data ?? {}) } as ScanSettings;
}

export async function loadQrSettings(sb: SupabaseClient, orgId: string): Promise<QrSettings> {
  const { data } = await sb.from("qr_settings").select("color, logo, caption, mode, target, menu, custom_url, whatsapp").eq("org_id", orgId).maybeSingle();
  return { ...QR_DEFAULTS, ...(data ?? {}) } as QrSettings;
}

export async function loadRemito(sb: SupabaseClient, orgId: string, id: string) {
  const [{ data: r }, { data: items }, settings, { data: code }, scan] = await Promise.all([
    sb.from("remitos_overview").select("*").eq("id", id).eq("org_id", orgId).maybeSingle(),
    sb.from("remito_items").select("line_no, description, quantity, detail, purchase_order_item_id, unit_price").eq("remito_id", id).order("line_no"),
    loadQrSettings(sb, orgId),
    sb.rpc("qr_for_remito", { p_remito: id }),
    loadScanSettings(sb, orgId),
  ]);
  if (!r) return null;
  const row = r as RemitoRow;
  const sheet: RemitoSheetData = {
    label: row.label, provisional: row.provisional, issuedAt: row.issued_at,
    recipient: { name: row.recipient_name, address: row.recipient_address ?? "", iva: row.recipient_iva ?? "", cuit: row.recipient_cuit ?? "" },
    items: (items ?? []).map((i) => ({ description: i.description, quantity: String(i.quantity), detail: i.detail ?? "", unit_price: i.unit_price === null ? null : String(i.unit_price) })),
    notes: row.notes ?? "", issuer: row.issuer, poNumber: row.po_number, voided: row.status === "anulado",
  };
  // El QR apunta a /r/<código>: lo que muestra se cambia desde Remitos → QR sin reimprimir
  const link = typeof code === "string" ? qrUrl(await appOrigin(), code) : null;
  const qrSvg = link ? await makeQr(link, { color: settings.color, logo: settings.logo }) : null;
  // código de barras para confirmar la entrega escaneando (según Remitos → Escanear → Ajustes)
  const wantsBarcode = row.status !== "anulado" && (row.provisional ? scan.barcode_provisional : scan.barcode_official);
  const barcodeSvg = wantsBarcode ? remitoBarcodeSvg(remitoBarcodeValue(row.provisional, row.point_of_sale, row.number)) : null;
  return { row, sheet, qrSvg, barcodeSvg, qrCode: typeof code === "string" ? code : null, qrLink: link, qrCaption: settings.caption, items: items ?? [] };
}
