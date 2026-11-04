import type { AppRole } from "@/lib/session";

/** Facturación y cobranzas: sólo administración y finanzas. */
export const canBill = (role: AppRole) => role === "admin" || role === "finanzas";

export type InvoiceBalance = {
  invoice_id: string; org_id: string; purchase_order_id: string; customer_id: string | null; invoice_type: string;
  point_of_sale: string | null; number: string | null; issue_date: string; due_date: string | null; currency: string;
  total_amount: string; status: string; document_id: string | null; collected_amount: string; cash_received: string;
  withholdings: string; balance: string; last_payment: string | null;
  collection_status: "pendiente" | "parcial" | "vencida" | "cobrada" | "anulada"; days_overdue: number | null; days_since_issue: number;
};

export type PoBilling = {
  purchase_order_id: string; currency: string; customer_id: string | null; status: string; order_total: string;
  invoiced_amount: string; collected_amount: string; cash_received: string; withholdings: string;
  to_invoice: string; to_collect: string; invoiced_pct: string; collected_pct: string; overdue_amount: string; invoices_count: number | null;
};

export type CollectionRow = {
  id: string; invoice_id: string; purchase_order_id: string; payment_date: string; amount_received: string;
  ret_iibb: string; ret_ganancias: string; ret_iva: string; ret_suss: string; ret_otras: string;
  withholdings: string; applied_amount: string; method: string; reference: string | null; status: string; void_reason: string | null;
};

export const COLLECTION_STATUS: Record<InvoiceBalance["collection_status"], { label: string; tone: "neutral" | "warn" | "danger" | "accent" | "info" }> = {
  pendiente: { label: "Pendiente", tone: "info" },
  parcial: { label: "Cobro parcial", tone: "warn" },
  vencida: { label: "Vencida", tone: "danger" },
  cobrada: { label: "Cobrada", tone: "accent" },
  anulada: { label: "Anulada", tone: "neutral" },
};

export const METHOD_LABEL: Record<string, string> = {
  transferencia: "Transferencia", cheque: "Cheque", echeq: "eCheq", efectivo: "Efectivo", otro: "Otro",
};

export const RETENTIONS = [
  ["ret_iibb", "IIBB"], ["ret_ganancias", "Ganancias"], ["ret_iva", "IVA"], ["ret_suss", "SUSS"], ["ret_otras", "Otras"],
] as const;

export function invoiceLabel(i: { invoice_type: string; point_of_sale: string | null; number: string | null }) {
  const pv = i.point_of_sale ? i.point_of_sale.padStart(5, "0") : "";
  const nro = i.number ? i.number.padStart(8, "0") : "s/n";
  return `${i.invoice_type} ${pv ? `${pv}-` : ""}${nro}`;
}

/** Tramos de antigüedad de deuda (días desde el vencimiento). */
export const AGING = [
  { key: "corriente", label: "A vencer", test: (d: number | null) => d === null || d <= 0 },
  { key: "30", label: "1–30 días", test: (d: number | null) => d !== null && d > 0 && d <= 30 },
  { key: "60", label: "31–60", test: (d: number | null) => d !== null && d > 30 && d <= 60 },
  { key: "90", label: "61–90", test: (d: number | null) => d !== null && d > 60 && d <= 90 },
  { key: "mas", label: "+90", test: (d: number | null) => d !== null && d > 90 },
] as const;
