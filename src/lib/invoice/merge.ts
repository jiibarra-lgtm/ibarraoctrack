import type { InvoiceDraft, InvoiceExtraction } from "@/lib/invoice/parse";
import { parseSupplierInvoice } from "@/lib/invoice/supplier-invoice";

const s = (n: number | null | undefined, d = 2) => (n === null || n === undefined || !Number.isFinite(n) ? "" : String(Math.round(n * 10 ** d) / 10 ** d));

/**
 * Completa la lectura de "Subir factura" (Compras) con el lector de facturas de proveedores, que entiende mejor
 * las tablas de renglones (cantidad antes de la descripción, presentación "x 5 Lts", fechas con guiones).
 * Si ese lector encuentra renglones que cierran con el neto, reemplazan a los del lector general.
 */
export function mergeSupplierParse(text: string, ex: InvoiceExtraction, ownCuit?: string | null): InvoiceExtraction {
  const lines = text.replace(/\r/g, "").split("\n").filter((l) => l.trim());
  const sp = parseSupplierInvoice([lines], { filename: "" });
  const d: InvoiceDraft = { ...ex.draft };
  let review = [...ex.review];
  const fix = (k: keyof InvoiceDraft, v: string) => { if (v) { d[k] = v as never; review = review.filter((r) => r !== k); } };
  const own = (ownCuit ?? "").replace(/\D/g, "");
  if (sp.point_of_sale !== null) fix("point_of_sale", String(sp.point_of_sale));
  if (sp.number !== null) fix("number", String(sp.number));
  if (sp.issue_date) fix("invoice_date", sp.issue_date);
  if (sp.cae && !d.cae) fix("cae", sp.cae);
  if (sp.issuer_cuit && sp.issuer_cuit !== own && !d.supplier_cuit) fix("supplier_cuit", `${sp.issuer_cuit.slice(0, 2)}-${sp.issuer_cuit.slice(2, 10)}-${sp.issuer_cuit.slice(10)}`);
  if (sp.letter && d.doc_type === "otro") fix("doc_type", `factura_${sp.letter.toLowerCase()}`);
  if (sp.total && !Number(d.total_amount)) fix("total_amount", s(sp.total));
  if (sp.net && !Number(d.net_amount)) fix("net_amount", s(sp.net));
  if (sp.net && sp.total && !Number(d.vat_amount)) fix("vat_amount", s(sp.total - sp.net));
  const valid = (x: InvoiceDraft["items"][number]) => x.description.trim() && Number(x.unit_price) > 0;
  const better = sp.items.length > 0 && (sp.quality === "ok" || ex.draft.items.filter(valid).length < sp.items.length);
  if (better) {
    d.items = sp.items.map((it) => ({
      description: it.description, quantity: s(it.quantity, 4), unit: it.unit ?? "", unit_price: s(it.list_price ?? it.unit_net, 4),
      discount_pct: s(it.discount_pct ?? 0, 3), vat_rate: s(it.vat_rate ?? (sp.factor ? Math.round((sp.factor - 1) * 1000) / 10 : 21)), net_amount: s(it.line_net),
    }));
    review = review.filter((r) => !r.startsWith("items"));
  }
  const warnings = better ? ex.warnings.filter((w) => !/rengl/i.test(w)) : ex.warnings;
  return { draft: d, review, warnings };
}
