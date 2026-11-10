import type { SupplierInvoice } from "@/lib/invoice/supplier-invoice";

/** Búsqueda de Gmail para facturas de proveedores con PDF (los organismos y Mercado Libre van por su lado). */
export const INVOICE_QUERY =
  "has:attachment filename:pdf {factura facturas fac fact fc fca comprobante comprobantes \"comprobante electronico\" \"comprobante electrónico\"} -from:mercadolibre -from:mercadolibre.com.ar -from:me -in:sent -in:chats -from:gob.ar -from:gov.ar -from:buenosaires.gob.ar -from:bue.edu.ar -from:bancociudad.com.ar";

const FREE_MAIL = /^(gmail|hotmail|outlook|live|yahoo|icloud|me|msn|fibertel|speedy|arnet|ciudad)\./i;

/** Nombre probable del proveedor cuando ARCA todavía no lo tiene: el dominio del mail, o el nombre si es una casilla gratuita. */
export function supplierHint(from: string): string | null {
  const m = /^\s*"?([^"<]*)"?\s*<([^>]+)>/.exec(from);
  const name = m?.[1]?.trim() || null;
  const email = (m?.[2] ?? from).trim().toLowerCase();
  const domain = email.split("@")[1] ?? "";
  if (!domain) return name;
  if (FREE_MAIL.test(domain)) return name;
  const label = domain.replace(/\.(com|net|org|gob|gov|edu)?(\.ar)?$/, "").split(".").pop() ?? "";
  if (!label) return name;
  return label.length <= 4 ? label.toUpperCase() : label[0].toUpperCase() + label.slice(1);
}

export type InvoiceMeta = { mail_id?: string | null; mail_from?: string; mail_subject?: string; mail_date?: string; filename: string };

/** Lo que se guarda en la base (sin el PDF). */
export function invoicePayload(inv: SupplierInvoice, meta: InvoiceMeta) {
  return {
    ...meta,
    supplier_hint: meta.mail_from ? supplierHint(meta.mail_from) : null,
    kind: inv.kind, letter: inv.letter, point_of_sale: inv.point_of_sale, number: inv.number, issue_date: inv.issue_date,
    cuits: inv.cuits, issuer_cuit: inv.issuer_cuit, cae: inv.cae, net: inv.net, total: inv.total, items_net: inv.items_net,
    factor: inv.factor, quality: inv.quality,
    items: inv.items.map((i) => ({ ...i, quantity: i.quantity, line_net: i.line_net })),
  };
}
