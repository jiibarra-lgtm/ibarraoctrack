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
