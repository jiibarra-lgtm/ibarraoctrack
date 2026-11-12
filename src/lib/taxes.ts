/**
 * Cálculos impositivos de apoyo (estimaciones para planificar; la liquidación la confirma el contador).
 */

/** Escala anual del art. 94 LIG, período 2026 (ARCA, liquidación anual y final 2026). */
export const GANANCIAS_2026: { from: number; fixed: number; rate: number }[] = [
  { from: 0, fixed: 0, rate: 5 },
  { from: 2336953.69, fixed: 116847.68, rate: 9 },
  { from: 4673907.36, fixed: 327173.52, rate: 12 },
  { from: 7010861.05, fixed: 607607.96, rate: 15 },
  { from: 10516291.59, fixed: 1133422.54, rate: 19 },
  { from: 21032583.18, fixed: 3131517.94, rate: 23 },
  { from: 31548874.77, fixed: 5550265.01, rate: 27 },
  { from: 47323312.16, fixed: 9809363.1, rate: 31 },
  { from: 70984968.25, fixed: 17144476.49, rate: 35 },
];

export function gananciasTax(taxable: number) {
  if (taxable <= 0) return { tax: 0, bracket: GANANCIAS_2026[0] };
  const b = [...GANANCIAS_2026].reverse().find((x) => taxable > x.from) ?? GANANCIAS_2026[0];
  return { tax: Math.round((b.fixed + ((taxable - b.from) * b.rate) / 100) * 100) / 100, bracket: b };
}

/** Feriados nacionales 2026 (inamovibles, trasladables y puentes). */
const HOLIDAYS = new Set([
  "2026-01-01", "2026-02-16", "2026-02-17", "2026-03-23", "2026-03-24", "2026-04-02", "2026-04-03", "2026-05-01", "2026-05-25",
  "2026-06-15", "2026-06-20", "2026-07-09", "2026-07-10", "2026-08-17", "2026-10-12", "2026-11-23", "2026-12-07", "2026-12-08", "2026-12-25",
]);
const iso = (d: Date) => d.toISOString().slice(0, 10);
/** Si cae sábado, domingo o feriado, pasa al siguiente día hábil. */
export function businessDay(y: number, m: number, day: number) {
  const d = new Date(Date.UTC(y, m - 1, Math.min(day, 28 + 3)));
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6 || HOLIDAYS.has(iso(d))) d.setUTCDate(d.getUTCDate() + 1);
  return iso(d);
}

/** Día de vencimiento de la DDJJ mensual de IVA según la terminación del CUIT. */
export const IVA_DAY: Record<number, number> = { 0: 18, 1: 18, 2: 19, 3: 19, 4: 20, 5: 20, 6: 21, 7: 21, 8: 22, 9: 22 };

export type Due = { date: string; title: string; detail: string; kind: "iva" | "iibb" | "autonomos" | "ganancias" };

/** Vencimientos de los próximos meses (estimados por regla; ARCA puede mover fechas). */
export function upcomingDues(cuit: string, from: string, months: number, s: { iibb_day: number; autonomos: boolean; autonomos_day: number }) {
  const digit = Number(cuit.replace(/\D/g, "").slice(-1) || 0);
  const [y0, m0] = from.split("-").map(Number);
  const out: Due[] = [];
  for (let k = 0; k < months; k++) {
    const y = y0 + Math.floor((m0 - 1 + k) / 12), m = ((m0 - 1 + k) % 12) + 1;
    const per = new Date(Date.UTC(y, m - 2, 1)).toLocaleDateString("es-AR", { month: "long", year: "numeric", timeZone: "UTC" });
    out.push({ date: businessDay(y, m, IVA_DAY[digit]), title: "IVA — DDJJ y pago (F.2002)", detail: `Período ${per}`, kind: "iva" });
    out.push({ date: businessDay(y, m, s.iibb_day), title: "Ingresos Brutos — anticipo", detail: `Período ${per}`, kind: "iibb" });
    if (s.autonomos) out.push({ date: businessDay(y, m, s.autonomos_day), title: "Autónomos — aporte mensual", detail: `Período ${per}`, kind: "autonomos" });
    if (m === 6) out.push({ date: businessDay(y, m, 11 + Math.floor(digit / 2)), title: "Ganancias y Bienes Personales — DDJJ anual", detail: `Período ${y - 1}`, kind: "ganancias" });
  }
  return out.filter((d) => d.date >= `${from}-01`).sort((a, b) => a.date.localeCompare(b.date));
}

export type MonthTax = { month: string; debito: number; credito: number; retIva: number; netSales: number; retIibb: number; sircreb: number };

/** Saldo de IVA mes a mes: arrastra el saldo técnico y aplica las retenciones de IVA. */
export function ivaBalances(rows: MonthTax[]) {
  let tecnico = 0, libre = 0;
  return [...rows].sort((a, b) => a.month.localeCompare(b.month)).map((r) => {
    const prevTecnico = tecnico;
    const det = r.debito - r.credito - tecnico;
    let pagar = 0;
    if (det < 0) { tecnico = -det; } else { tecnico = 0; pagar = det; }
    const ret = r.retIva + libre;
    const aPagar = Math.max(0, pagar - ret);
    libre = Math.max(0, ret - pagar);
    return { ...r, prevTecnico, saldoTecnico: tecnico, aPagar, libreDisponibilidad: libre };
  });
}

/** IIBB mes a mes: alícuota sobre ventas netas menos retenciones y SIRCREB, con saldo a favor acumulado. */
export function iibbBalances(rows: MonthTax[], ratePct: number) {
  let favor = 0;
  return [...rows].sort((a, b) => a.month.localeCompare(b.month)).map((r) => {
    const impuesto = Math.max(0, r.netSales) * ratePct / 100;
    const pagosCuenta = r.retIibb + r.sircreb + favor;
    const aPagar = Math.max(0, impuesto - pagosCuenta);
    favor = Math.max(0, pagosCuenta - impuesto);
    return { ...r, impuesto, aPagar, saldoFavor: favor };
  });
}
