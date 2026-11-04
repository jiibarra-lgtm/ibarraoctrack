import type { PurchaseOrderInput } from "@/lib/po/schema";

const s = (v: unknown) => (v === null || v === undefined ? "" : String(v));

/** Fila de base → valores de formulario (strings, sin pérdida de precisión). */
export function toFormValues(po: Record<string, unknown>, items: Record<string, unknown>[], customerName = ""): PurchaseOrderInput {
  const keys = [
    "bac_number", "bac_type", "bac_status", "contract_duration", "expediente_number", "process_number",
    "contratacion_number", "process_type", "modality", "process_class", "legal_framework", "award_act_number",
    "jurisdiction", "dependencia", "buyer_phone", "buyer_address", "buyer_notes", "awardee_name", "awardee_cuit",
    "awardee_entity_number", "issue_date", "received_date", "perfected_date", "delivery_term_text", "due_date",
    "delivery_place", "payment_terms", "contract_terms", "discount_amount", "net_amount", "vat_amount", "total_amount", "notes",
  ] as const;
  const out: Record<string, unknown> = {};
  keys.forEach((k) => (out[k] = s(po[k])));
  return {
    ...(out as PurchaseOrderInput),
    id: s(po.id),
    version: Number(po.version),
    fiscal_year: s(po.fiscal_year),
    delivery_term_days: s(po.delivery_term_days),
    currency: s(po.currency) || "ARS",
    status: s(po.status) as PurchaseOrderInput["status"],
    customer_id: s(po.customer_id),
    customer_name: customerName,
    authorizers: Array.isArray(po.authorizers) ? (po.authorizers as PurchaseOrderInput["authorizers"]) : [],
    items: items
      .sort((a, b) => Number(a.line_number) - Number(b.line_number) || Number(a.option_number) - Number(b.option_number))
      .map((it) => ({
        id: s(it.id),
        line_number: Number(it.line_number),
        option_number: Number(it.option_number) || 1,
        bac_code: s(it.bac_code),
        internal_code: s(it.internal_code),
        description_original: s(it.description_original),
        description_normalized: s(it.description_normalized),
        quantity: s(it.quantity),
        unit: s(it.unit),
        unit_price: s(it.unit_price),
        total_amount: s(it.total_amount),
        packaging: s(it.packaging),
        delivery_address: s(it.delivery_address),
        delivery_phone: s(it.delivery_phone),
        delivery_term: s(it.delivery_term),
        delivery_notes: s(it.delivery_notes),
        notes: s(it.notes),
      })),
  };
}
