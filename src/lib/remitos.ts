/** Tipos compartidos del módulo de remitos (cliente y servidor). */
export type RemitoIssuer = { name: string; address: string; phones: string; iva: string; cuit: string; iibb: string; start: string; whatsapp: string | null };
export type RemitoLine = { description: string; quantity: string; detail: string };
export type RemitoStatus = "emitido" | "entregado" | "firmado" | "anulado";

export type RemitoSheetData = {
  label: string | null;          // "0001-00000012" (null en la vista previa)
  provisional: boolean;
  issuedAt: string;              // ISO
  recipient: { name: string; address: string; iva: string; cuit: string };
  items: RemitoLine[];
  notes: string;
  issuer: RemitoIssuer;
  poNumber: string | null;
  voided?: boolean;
};

export type RemitoRow = {
  id: string; label: string; point_of_sale: number; number: number; provisional: boolean; issued_at: string;
  recipient_name: string; recipient_address: string | null; recipient_cuit: string | null; recipient_iva: string | null;
  purchase_order_id: string | null; po_number: string | null; delivery_id: string | null; notes: string | null;
  issuer: RemitoIssuer; status: RemitoStatus; void_reason: string | null; voided_at: string | null;
  signed_document_id: string | null; print_count: number; last_printed_at: string | null;
  items_count: number; units: string; items_text: string | null; created_by_name: string | null; created_at: string;
};

export const REMITO_STATUS: Record<RemitoStatus, { label: string; tone: string }> = {
  emitido: { label: "Emitido", tone: "bg-field text-fg" },
  entregado: { label: "Entregado", tone: "bg-warn-soft text-warn" },
  firmado: { label: "Firmado", tone: "bg-accent-soft text-accent" },
  anulado: { label: "Anulado", tone: "bg-danger-soft text-danger" },
};

export const EVENT_LABEL: Record<string, string> = {
  emitido: "Emitido", impreso: "Impreso / PDF", entregado: "Entregado", firmado: "Firmado (copia subida)", anulado: "Anulado", nota: "Nota",
};

export const waLink = (phone: string | null) =>
  phone ? `https://wa.me/${phone}?text=${encodeURIComponent("Hola, tengo una consulta sobre un remito de Ibarra Insumos")}` : null;

/** Fecha y hora en Buenos Aires: { d, m, y, hm } */
export function baParts(iso: string) {
  const f = new Intl.DateTimeFormat("es-AR", { timeZone: "America/Argentina/Buenos_Aires", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
  const p = Object.fromEntries(f.formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return { d: p.day, m: p.month, y: p.year, hm: `${p.hour}:${p.minute}` };
}

export const fmtQty = (q: string) => {
  const n = Number(String(q).replace(",", "."));
  return Number.isFinite(n) ? n.toLocaleString("es-AR", { maximumFractionDigits: 3 }) : q;
};
