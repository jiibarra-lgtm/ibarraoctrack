/**
 * Lee el CM03 (DDJJ mensual de Ingresos Brutos, Convenio Multilateral) que baja de SIFERE / ARCA
 * y, si viene pegado, el comprobante de pago del VEP. Son los números presentados: no se calcula nada.
 */
import { JURISDICTIONS } from "@/lib/iibb";

export type Cm03Row = { code: number; tax: number; restan: number; suman: number; favor_contrib: number; favor_fisco: number; due: number };
export type Cm03 = {
  month: string; verifier: string | null; presented_at: string | null;
  rows: Cm03Row[]; total_tax: number; total_due: number;
  paid_at: string | null; paid_amount: number | null; vep: string | null;
};

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();
const money = (s: string) => Number(s.replace(/\$|\s/g, "").replace(/\./g, "").replace(",", "."));
const dmy = (s: string) => s.split("/").reverse().join("-");
const NAMES = Object.entries(JURISDICTIONS).map(([c, n]) => ({ code: Number(c), name: norm(n) })).sort((a, b) => b.name.length - a.name.length);
const AMT = /\$\s?-?[\d.]+,\d{2}/g;

export function isCm03(text: string) {
  const t = norm(text);
  return t.includes("CONVENIO MULTILATERAL") && t.includes("CM03") && /ANTICIPO:?\s*\d{6}/.test(t);
}

export function parseCm03(lines: string[]): Cm03 | null {
  const text = lines.join("\n");
  if (!isCm03(text)) return null;
  const T = norm(text);
  const ant = T.match(/ANTICIPO:?\s*(\d{4})(\d{2})/);
  if (!ant) return null;
  const rows: Cm03Row[] = [];
  for (const raw of lines) {
    const l = norm(raw).replace(/^\s*9\d\d\s+/, "");
    if (/^TOTAL/.test(l.trim())) continue;
    const j = NAMES.find((n) => l.trim().startsWith(n.name) && /\$/.test(l));
    if (!j || rows.some((r) => r.code === j.code)) continue;
    const v = (l.match(AMT) ?? []).map(money);
    if (v.length < 6) continue;
    rows.push({ code: j.code, tax: v[0], restan: v[1], suman: v[2], favor_contrib: v[3], favor_fisco: v[4], due: v[5] });
  }
  if (!rows.length) return null;
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const totalLine = lines.map(norm).find((l) => /^\s*TOTALES/.test(l));
  const tv = totalLine?.match(AMT)?.map(money);
  const pay = T.match(/TOTAL A PAGAR:?\s*(\$\s?[\d.]+,\d{2})/);
  const pres = T.match(/PRESENTADA EL (\d{2}\/\d{2}\/\d{4})/);
  const verif = T.match(/N[°º] VERIFICADOR:?\s*(\d+)/);
  // Comprobante de pago del VEP (cuando el PDF lo trae)
  const vepBlock = T.indexOf("PAGO DE VEP") >= 0 ? T.slice(T.indexOf("PAGO DE VEP")) : "";
  const vepImp = vepBlock.match(/IMPORTE\s*(\$\s?[\d.]+,\d{2})/);
  const vepDate = vepBlock.match(/FECHA DE PAGO[\s\S]{0,120}?(\d{2}\/\d{2}\/\d{4})/);
  const vepNum = vepBlock.match(/N[°º] DE VEP\s*(\d+)/);
  return {
    month: `${ant[1]}-${ant[2]}`,
    verifier: verif?.[1] ?? null,
    presented_at: pres ? dmy(pres[1]) : null,
    rows,
    total_tax: tv?.[0] ?? r2(rows.reduce((a, r) => a + r.tax, 0)),
    total_due: pay ? money(pay[1]) : r2(rows.reduce((a, r) => a + r.due, 0)),
    paid_at: vepDate ? dmy(vepDate[1]) : null,
    paid_amount: vepImp ? money(vepImp[1]) : null,
    vep: vepNum?.[1] ?? null,
  };
}
