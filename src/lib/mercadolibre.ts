/** Tipos y etiquetas de la sección Mercado Libre (sirve en cliente y servidor). */
export type MlRow = {
  id: string; kind: "compra" | "venta"; ml_id: string; title: string; extra_items: number;
  quantity: string | null; unit_price: string | null; fees: string | null; total_amount: string | null; unit_value: string | null;
  counterpart: string | null; shipping: string | null; eta: string | null;
  status: "comprada" | "en_camino" | "entregada" | "vendida" | "cancelada";
  ordered_at: string | null; shipped_at: string | null; delivered_at: string | null; invoice_available: boolean; created_at: string;
  purchase_order_id: string | null; po_item_id: string | null; link_source: "auto" | "manual" | null; link_score: string | null;
  po_number: string | null; po_customer: string | null; po_line: number | null; po_item_description: string | null;
  po_item_quantity: string | null; po_item_unit_price: string | null;
  invoice_id: string | null; invoice_link: "auto" | "manual" | null; invoice_none: boolean; invoice_checked_at: string | null; invoice_fetched_at: string | null;
  inv_letter: string | null; inv_pos: number | null; inv_number: number | null; inv_total: string | null; inv_supplier: string | null; inv_date: string | null; inv_source: string | null;
};

/** Estado de la factura de una compra de ML. */
export type InvoiceState = "cargada" | "no_lleva" | "esperando" | "falta" | "cancelada";
export function invoiceState(r: Pick<MlRow, "kind" | "status" | "invoice_id" | "invoice_none" | "ordered_at" | "created_at">, now = Date.now()): InvoiceState | null {
  if (r.kind !== "compra") return null;
  if (r.invoice_id) return "cargada";
  if (r.status === "cancelada") return "cancelada";
  if (r.invoice_none) return "no_lleva";
  // el vendedor tiene hasta ~30 días para subirla
  return now - Date.parse(r.ordered_at ?? r.created_at) < 30 * 864e5 ? "esperando" : "falta";
}
export const INVOICE_STATE: Record<InvoiceState, { label: string; tone: string }> = {
  cargada: { label: "Factura cargada", tone: "bg-accent-soft text-accent" },
  no_lleva: { label: "No lleva factura", tone: "bg-field text-fg-muted" },
  esperando: { label: "Esperando factura", tone: "bg-warn-soft text-warn" },
  falta: { label: "Falta la factura", tone: "bg-danger-soft text-danger" },
  cancelada: { label: "Cancelada", tone: "bg-field text-fg-muted" },
};
export const invoiceNumber = (r: Pick<MlRow, "inv_letter" | "inv_pos" | "inv_number">) =>
  r.inv_number ? `${r.inv_letter ? `${r.inv_letter} ` : ""}${String(r.inv_pos ?? 0).padStart(4, "0")}-${String(r.inv_number).padStart(8, "0")}` : "sin número";

export const ML_STATUS: Record<MlRow["status"], { label: string; tone: string }> = {
  comprada: { label: "Comprada", tone: "bg-field text-fg-muted" },
  en_camino: { label: "En camino", tone: "bg-warn-soft text-warn" },
  entregada: { label: "Llegó", tone: "bg-accent-soft text-accent" },
  vendida: { label: "Vendida", tone: "bg-accent-soft text-accent" },
  cancelada: { label: "Cancelada", tone: "bg-danger-soft text-danger" },
};

export const mlUrl = (r: Pick<MlRow, "kind" | "ml_id">) =>
  r.kind === "venta" ? `https://www.mercadolibre.com.ar/ventas/${r.ml_id}/detalle` : `https://myaccount.mercadolibre.com.ar/my_purchases/${r.ml_id}/status`;

/** Costo de la compra en ML vs. precio de venta en la OC, por unidad. */
export function mlMargin(r: MlRow): { unit: number; pct: number } | null {
  if (r.kind !== "compra" || !r.unit_value || !r.po_item_unit_price) return null;
  const cost = Number(r.unit_value), sale = Number(r.po_item_unit_price);
  if (!(sale > 0)) return null;
  return { unit: sale - cost, pct: ((sale - cost) / sale) * 100 };
}
