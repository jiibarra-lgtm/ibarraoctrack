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
};

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
