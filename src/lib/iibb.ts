/**
 * Ingresos Brutos — Convenio Multilateral (régimen general, art. 2).
 * La base imponible total del mes se reparte entre jurisdicciones por el coeficiente unificado;
 * a cada parte se le aplica su alícuota y se restan retenciones, percepciones, SIRCREB y el saldo a favor anterior.
 */
export const JURISDICTIONS: Record<number, string> = {
  901: "CABA", 902: "Buenos Aires", 903: "Catamarca", 904: "Córdoba", 905: "Corrientes", 906: "Chaco", 907: "Chubut", 908: "Entre Ríos",
  909: "Formosa", 910: "Jujuy", 911: "La Pampa", 912: "La Rioja", 913: "Mendoza", 914: "Misiones", 915: "Neuquén", 916: "Río Negro",
  917: "Salta", 918: "San Juan", 919: "San Luis", 920: "Santa Cruz", 921: "Santa Fe", 922: "Santiago del Estero", 923: "Tierra del Fuego", 924: "Tucumán",
};

export type IibbJur = { code: number; coefficient: number; rate: number };
export type IibbDeductions = { retenciones: number; percepciones: number; sircreb: number };
export type IibbRow = IibbJur & IibbDeductions & { base: number; tax: number; favor_prev: number; due: number; favor_next: number };

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Suma de coeficientes (tiene que dar 1). */
export const coefSum = (js: IibbJur[]) => Math.round(js.reduce((a, j) => a + j.coefficient, 0) * 10000) / 10000;

/**
 * Valores por defecto de las deducciones: retenciones IIBB del mes a CABA (las retiene el GCBA)
 * y SIRCREB repartido por coeficiente (el banco lo reparte por el padrón).
 */
export function defaultDeductions(js: IibbJur[], retIibb: number, sircreb: number): Record<number, IibbDeductions> {
  const out: Record<number, IibbDeductions> = {};
  const total = coefSum(js) || 1;
  const caba = js.find((j) => j.code === 901);
  for (const j of js) {
    out[j.code] = {
      retenciones: caba ? (j.code === 901 ? r2(retIibb) : 0) : r2(retIibb * j.coefficient / total),
      percepciones: 0,
      sircreb: r2(sircreb * j.coefficient / total),
    };
  }
  return out;
}

/** Liquidación del mes por jurisdicción (como el CM03). */
export function liquidateIibb(base: number, js: IibbJur[], ded: Record<number, IibbDeductions>, favorPrev: Record<number, number>): { rows: IibbRow[]; totalTax: number; totalDue: number } {
  const rows = js.map((j) => {
    const b = r2(Math.max(0, base) * j.coefficient);
    const tax = r2(b * j.rate / 100);
    const d = ded[j.code] ?? { retenciones: 0, percepciones: 0, sircreb: 0 };
    const fp = r2(favorPrev[j.code] ?? 0);
    const credits = r2(d.retenciones + d.percepciones + d.sircreb + fp);
    return { ...j, ...d, base: b, tax, favor_prev: fp, due: r2(Math.max(0, tax - credits)), favor_next: r2(Math.max(0, credits - tax)) };
  });
  return { rows, totalTax: r2(rows.reduce((a, r) => a + r.tax, 0)), totalDue: r2(rows.reduce((a, r) => a + r.due, 0)) };
}

// ---------------------------------------------------------------------------
// Cálculo automático del mes y control contra lo presentado en ARCA (CM03)
// ---------------------------------------------------------------------------
export type MonthInput = { month: string; sales: number; retIibb: number; sircreb: number };
export type Presented = { month: string; rows: { code: number; tax: number; restan: number; due: number; favor_next: number }[]; total_tax: number; total_due: number; paid_at: string | null };
export type MonthCheck = {
  month: string; sales: number;
  calc: { rows: IibbRow[]; totalTax: number; totalDue: number };
  presented: Presented | null;
  /** alícuota efectiva de cada jurisdicción en lo presentado (impuesto ÷ ventas × coeficiente) */
  effective: Record<number, number | null>;
  taxDiff: number | null; dueDiff: number | null;
  status: "ok" | "diferencia" | "sin_presentar" | "sin_ventas";
  issues: string[];
};

/**
 * Calcula solo cada mes del año (ventas de ARCA × coeficiente × alícuota, menos retenciones, SIRCREB y saldo a favor)
 * y lo compara con el CM03 presentado. El saldo a favor encadena: si el mes anterior está presentado, se usa el de ARCA.
 */
export function checkYear(months: MonthInput[], js: IibbJur[], presented: Presented[], tolerancePct = 1): MonthCheck[] {
  const byMonth = new Map(presented.map((p) => [p.month, p]));
  let favor: Record<number, number> = {};
  const out: MonthCheck[] = [];
  for (const m of [...months].sort((a, b) => a.month.localeCompare(b.month))) {
    const ded = defaultDeductions(js, m.retIibb, m.sircreb);
    const calc = liquidateIibb(m.sales, js, ded, favor);
    const p = byMonth.get(m.month) ?? null;
    const effective: Record<number, number | null> = {};
    const issues: string[] = [];
    let taxDiff: number | null = null, dueDiff: number | null = null;
    if (p) {
      taxDiff = r2(p.total_tax - calc.totalTax);
      dueDiff = r2(p.total_due - calc.totalDue);
      for (const j of js) {
        const pr = p.rows.find((r) => r.code === j.code);
        const base = m.sales * j.coefficient;
        effective[j.code] = pr && base > 0 ? r2((pr.tax / base) * 100) : null;
        const eff = effective[j.code];
        if (eff !== null && Math.abs(eff - j.rate) > 0.1)
          issues.push(`${JURISDICTIONS[j.code]}: se presentó al ${eff.toFixed(2).replace(".", ",")} % y tenés cargado ${String(j.rate).replace(".", ",")} %`);
      }
      if (!issues.length && calc.totalTax > 0 && Math.abs(taxDiff) / calc.totalTax * 100 > tolerancePct)
        issues.push(`El impuesto presentado difiere ${formatPct(taxDiff / calc.totalTax)} de lo calculado (otra base o coeficiente)`);
      // el saldo a favor que sigue es el que quedó en ARCA
      favor = Object.fromEntries(p.rows.map((r) => [r.code, r.favor_next]));
    } else {
      favor = Object.fromEntries(calc.rows.map((r) => [r.code, r.favor_next]));
    }
    out.push({
      month: m.month, sales: r2(m.sales), calc, presented: p, effective, taxDiff, dueDiff, issues,
      status: !p ? (m.sales > 0 ? "sin_presentar" : "sin_ventas") : issues.length ? "diferencia" : "ok",
    });
  }
  return out;
}
const formatPct = (x: number) => `${(x * 100).toFixed(1).replace(".", ",")} %`;
