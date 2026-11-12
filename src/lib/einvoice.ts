/**
 * Factura electrónica (WSFEv1): reglas de ARCA que no dependen de la conexión.
 * Emisor Responsable Inscripto: A a Responsables Inscriptos y monotributistas, B al resto (exentos, consumidor final…).
 */

/** Condición frente al IVA del receptor (RG 5616, campo CondicionIVAReceptorId). */
export const IVA_CONDITIONS: Record<number, { label: string; letter: "A" | "B" }> = {
  1: { label: "IVA Responsable Inscripto", letter: "A" },
  6: { label: "Responsable Monotributo", letter: "A" },
  13: { label: "Monotributista Social", letter: "A" },
  16: { label: "Monotributo Trabajador Independiente Promovido", letter: "A" },
  4: { label: "IVA Sujeto Exento", letter: "B" },
  5: { label: "Consumidor Final", letter: "B" },
  7: { label: "Sujeto No Categorizado", letter: "B" },
  10: { label: "IVA Liberado – Ley 19.640", letter: "B" },
  15: { label: "IVA No Alcanzado", letter: "B" },
};

/** Código de comprobante de ARCA. */
export const VOUCHER_TYPE = { A: { factura: 1, nota_credito: 3 }, B: { factura: 6, nota_credito: 8 } } as const;
export const VOUCHER_NAME: Record<number, string> = { 1: "Factura A", 3: "Nota de Crédito A", 6: "Factura B", 8: "Nota de Crédito B" };
export const letterOf = (type: number) => (type === 1 || type === 3 ? "A" : "B");

/** Alícuotas de IVA (código ARCA → %). */
export const VAT_RATES: Record<number, number> = { 5: 21, 4: 10.5, 6: 27, 3: 0, 8: 5, 9: 2.5 };
export const vatId = (rate: number) => Number(Object.entries(VAT_RATES).find(([, r]) => r === rate)?.[0] ?? 5);

export type EInvoiceLine = { description: string; quantity: number; unit: string | null; unit_price: number; vat_rate: number };

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * Totales del comprobante. Si los precios incluyen IVA (como las OC del GCBA), se separa el IVA de cada renglón.
 * El total de cada renglón queda igual al de la OC; el neto y el IVA se redondean por alícuota.
 */
export function computeTotals(lines: EInvoiceLine[], pricesIncludeVat: boolean) {
  const byRate = new Map<number, { base: number; vat: number; gross: number }>();
  const out = lines.map((l) => {
    const amount = r2(l.quantity * l.unit_price);
    const k = 1 + l.vat_rate / 100;
    const net = pricesIncludeVat ? amount / k : amount;
    const gross = pricesIncludeVat ? amount : amount * k;
    const g = byRate.get(l.vat_rate) ?? { base: 0, vat: 0, gross: 0 };
    g.base += net; g.gross += gross;
    byRate.set(l.vat_rate, g);
    return { ...l, amount, net_amount: r2(net), total_amount: r2(gross) };
  });
  const vat = [...byRate.entries()].map(([rate, g]) => {
    const gross = r2(g.gross);
    const base = r2(g.base);
    return { id: vatId(rate), rate, base, amount: r2(gross - base) };
  });
  const net = r2(vat.reduce((a, v) => a + v.base, 0));
  const vatTotal = r2(vat.reduce((a, v) => a + v.amount, 0));
  return { lines: out, vat, net, vat_total: vatTotal, total: r2(net + vatTotal) };
}

export const yyyymmdd = (iso: string) => iso.slice(0, 10).replace(/-/g, "");
export const fromYmd = (s: string | null | undefined) => (s && /^\d{8}$/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : null);

/** QR obligatorio de ARCA (RG 4892). */
export function afipQrUrl(p: { date: string; cuit: string; pointOfSale: number; type: number; number: number; total: number; docType: number; docNumber: string; cae: string }) {
  const data = {
    ver: 1, fecha: p.date.slice(0, 10), cuit: Number(p.cuit), ptoVta: p.pointOfSale, tipoCmp: p.type, nroCmp: p.number,
    importe: r2(p.total), moneda: "PES", ctz: 1, tipoDocRec: p.docType, nroDocRec: Number(p.docNumber.replace(/\D/g, "") || 0),
    tipoCodAut: "E", codAut: Number(p.cae),
  };
  return `https://www.afip.gob.ar/fe/qr/?p=${Buffer.from(JSON.stringify(data)).toString("base64")}`;
}

/** Sugerencia de condición de IVA del cliente: los organismos públicos son exentos. */
export function guessIvaCondition(name: string, cuit: string | null): number {
  const n = name.toLowerCase();
  if (/(gobierno|ministerio|hospital|secretar|subsecret|direcci[oó]n general|instituto|escuela|universidad|municipalidad|consejo|legislatura|poder judicial|ente |agencia|polic[ií]a|bomberos|registro)/.test(n)) return 4;
  if (cuit && /^(20|23|24|27)/.test(cuit.replace(/\D/g, ""))) return 5;
  return 1;
}

export const fmtVoucher = (type: number, pv: number, number: number) =>
  `${VOUCHER_NAME[type] ?? `Comprobante ${type}`} ${String(pv).padStart(5, "0")}-${String(number).padStart(8, "0")}`;
