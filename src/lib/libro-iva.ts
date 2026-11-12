/**
 * Libro IVA Digital (ARCA): archivos TXT de ancho fijo para importar en "Portal IVA → Libro IVA Digital".
 * Ventas: CBTE (266) + ALICUOTAS (62). Compras: CBTE (325) + ALICUOTAS (84).
 * Importes: 13 enteros + 2 decimales, sin coma ni signo (las notas de crédito se identifican por el tipo).
 */
export type LibroVoucher = {
  issue_date: string; voucher_type: number; point_of_sale: number; number: number; doc_type: string | null; doc_number: string | null;
  name: string; currency: string; exchange_rate: number; net_taxed: number; net_untaxed: number; exempt: number; other_taxes: number;
  vat: number; total: number; vat_detail: Record<string, { neto: number; iva: number }> | null;
};

const ALIC: Record<string, string> = { "0": "0003", "10.5": "0004", "21": "0005", "27": "0006", "5": "0008", "2.5": "0009" };
const DOC: Record<string, string> = { cuit: "80", cuil: "86", cdi: "87", dni: "96", pasaporte: "94", "sin identificar": "99", "consumidor final": "99" };

const amt = (n: number, len = 15) => String(Math.round(Math.abs(Number(n) || 0) * 100)).padStart(len, "0").slice(-len);
const int = (n: number | string, len: number) => String(n).replace(/\D/g, "").padStart(len, "0").slice(-len);
const txt = (s: string, len: number) => (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\x20-\x7E]/g, " ").slice(0, len).padEnd(len, " ");
const ymd = (iso: string) => iso.slice(0, 10).replace(/-/g, "");
const cur = (c: string) => (/^(ARS|PES|\$)$/i.test(c) ? "PES" : /^(USD|DOL|U\$S)$/i.test(c) ? "DOL" : txt(c.toUpperCase(), 3));
const rate = (r: number) => String(Math.round((Number(r) || 1) * 1e6)).padStart(10, "0").slice(-10);
const docCode = (t: string | null, nro: string | null) => {
  const s = (t ?? "").trim().toLowerCase();
  if (/^\d{1,2}$/.test(s)) return s.padStart(2, "0");
  return DOC[s] ?? ((nro ?? "").replace(/\D/g, "").length === 11 ? "80" : "99");
};
const isAM = (type: number) => [1, 2, 3, 4, 5, 51, 52, 53, 54, 201, 202, 203].includes(type);

/** Alícuotas del comprobante; si el archivo no trae el detalle, se asume 21% sobre el neto gravado. */
function alicuotas(v: LibroVoucher) {
  const d = Object.entries(v.vat_detail ?? {}).filter(([, x]) => Math.abs(Number(x.neto)) > 0 || Math.abs(Number(x.iva)) > 0);
  if (d.length) return d.map(([k, x]) => ({ code: ALIC[String(Number(k))] ?? "0005", neto: Number(x.neto), iva: Number(x.iva) }));
  if (Number(v.net_taxed) > 0) return [{ code: "0005", neto: Number(v.net_taxed), iva: Number(v.vat) }];
  return [];
}

export function libroVentas(rows: LibroVoucher[]) {
  const cbte: string[] = [], alic: string[] = [];
  for (const v of [...rows].sort((a, b) => a.issue_date.localeCompare(b.issue_date) || a.voucher_type - b.voucher_type || a.number - b.number)) {
    const al = alicuotas(v);
    const op = al.length ? "0" : Number(v.exempt) > 0 ? "E" : "N";
    cbte.push(
      ymd(v.issue_date) + int(v.voucher_type, 3) + int(v.point_of_sale, 5) + int(v.number, 20) + int(v.number, 20)
      + docCode(v.doc_type, v.doc_number) + int(v.doc_number ?? "0", 20) + txt(v.name, 30)
      + amt(v.total) + amt(v.net_untaxed) + amt(0) + amt(v.exempt) + amt(0) + amt(0) + amt(0) + amt(0)
      + cur(v.currency) + rate(v.exchange_rate) + String(Math.min(al.length, 9)) + op + amt(v.other_taxes) + "00000000",
    );
    for (const a of al) alic.push(int(v.voucher_type, 3) + int(v.point_of_sale, 5) + int(v.number, 20) + amt(a.neto) + a.code + amt(a.iva));
  }
  return { cbte, alicuotas: alic };
}

export function libroCompras(rows: LibroVoucher[]) {
  const cbte: string[] = [], alic: string[] = [];
  for (const v of [...rows].sort((a, b) => a.issue_date.localeCompare(b.issue_date) || a.voucher_type - b.voucher_type || a.number - b.number)) {
    const am = isAM(v.voucher_type);
    const al = am ? alicuotas(v) : [];
    const op = al.length || !am ? "0" : Number(v.exempt) > 0 ? "E" : "N";
    const doc = docCode(v.doc_type, v.doc_number);
    cbte.push(
      ymd(v.issue_date) + int(v.voucher_type, 3) + int(v.point_of_sale, 5) + int(v.number, 20) + " ".repeat(16)
      + doc + int(v.doc_number ?? "0", 20) + txt(v.name, 30)
      + amt(v.total) + amt(v.net_untaxed) + amt(v.exempt) + amt(0) + amt(0) + amt(0) + amt(0) + amt(0)
      + cur(v.currency) + rate(v.exchange_rate) + String(Math.min(al.length, 9)) + op
      + amt(am ? v.vat : 0) + amt(v.other_taxes) + "0".repeat(11) + " ".repeat(30) + amt(0),
    );
    for (const a of al) alic.push(int(v.voucher_type, 3) + int(v.point_of_sale, 5) + int(v.number, 20) + doc + int(v.doc_number ?? "0", 20) + amt(a.neto) + a.code + amt(a.iva));
  }
  return { cbte, alicuotas: alic };
}

export const LINE_LENGTH = { ventas_cbte: 266, ventas_alicuotas: 62, compras_cbte: 325, compras_alicuotas: 84 } as const;
