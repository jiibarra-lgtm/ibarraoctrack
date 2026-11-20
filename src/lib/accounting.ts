/** Contabilidad: tipos y cálculos de libros (diario, mayor, sumas y saldos). */
export type AccType = "activo" | "pasivo" | "patrimonio" | "ingreso" | "egreso";
export type Account = { code: string; name: string; type: AccType; imputable: boolean; active: boolean };
export type Line = { account_code: string; debit: number; credit: number };

export const ACC_TYPE: Record<AccType, string> = { activo: "Activo", pasivo: "Pasivo", patrimonio: "Patrimonio neto", ingreso: "Ingresos", egreso: "Egresos" };

/** Cuentas de saldo deudor por naturaleza (activo y egresos). */
export const debitNature = (t: AccType) => t === "activo" || t === "egreso";

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Un asiento manual tiene que tener al menos dos líneas, cada una con debe o haber, y balancear. */
export function validateEntry(lines: Line[]) {
  const ls = lines.filter((l) => l.debit > 0 || l.credit > 0);
  if (ls.length < 2) return "El asiento necesita al menos dos líneas";
  if (ls.some((l) => l.debit > 0 && l.credit > 0)) return "Cada línea va al debe o al haber, no a los dos";
  if (ls.some((l) => l.debit < 0 || l.credit < 0)) return "No se aceptan importes negativos";
  const d = r2(ls.reduce((a, l) => a + l.debit, 0)), c = r2(ls.reduce((a, l) => a + l.credit, 0));
  if (Math.abs(d - c) > 0.005) return `No balancea: debe ${d.toFixed(2)} y haber ${c.toFixed(2)}`;
  return null;
}

/** Mayor de una cuenta: movimientos con saldo acumulado desde el saldo inicial. */
export function ledger<T extends { debit: number; credit: number }>(opening: number, rows: T[]) {
  let bal = opening;
  return rows.map((r) => { bal = r2(bal + r.debit - r.credit); return { ...r, balance: bal }; });
}

export type TrialRow = { account_code: string; debit: number; credit: number; opening: number };

/**
 * Balance de sumas y saldos con subtotales por cuenta madre (1, 1.1, ...).
 * Saldo = inicial + debe − haber (positivo = deudor).
 */
export function trialBalance(accounts: Account[], rows: TrialRow[]) {
  const by = new Map(rows.map((r) => [r.account_code, r]));
  const lines = accounts.map((a) => {
    const kids = accounts.filter((k) => k.imputable && (k.code === a.code || k.code.startsWith(`${a.code}.`)));
    const pick = a.imputable ? [by.get(a.code)].filter(Boolean) as TrialRow[] : kids.map((k) => by.get(k.code)).filter(Boolean) as TrialRow[];
    const opening = r2(pick.reduce((s, r) => s + r.opening, 0));
    const debit = r2(pick.reduce((s, r) => s + r.debit, 0));
    const credit = r2(pick.reduce((s, r) => s + r.credit, 0));
    return { ...a, level: a.code.split(".").length, opening, debit, credit, closing: r2(opening + debit - credit) };
  }).filter((l) => l.opening || l.debit || l.credit);
  const imp = lines.filter((l) => l.imputable);
  return {
    lines,
    totals: { debit: r2(imp.reduce((s, l) => s + l.debit, 0)), credit: r2(imp.reduce((s, l) => s + l.credit, 0)), closing: r2(imp.reduce((s, l) => s + l.closing, 0)) },
  };
}

/** Estado de resultados del período y situación patrimonial al cierre. */
export function statements(accounts: Account[], rows: TrialRow[]) {
  const type = new Map(accounts.map((a) => [a.code, a.type]));
  const sum = (t: AccType, field: "period" | "closing") => r2(rows.filter((r) => type.get(r.account_code) === t)
    .reduce((s, r) => s + (field === "period" ? r.debit - r.credit : r.opening + r.debit - r.credit), 0));
  const ingresos = -sum("ingreso", "period"), egresos = sum("egreso", "period");
  const activo = sum("activo", "closing"), pasivo = -sum("pasivo", "closing"), pn = -sum("patrimonio", "closing");
  const resultadoAcum = -(sum("ingreso", "closing") + sum("egreso", "closing"));
  return { ingresos, egresos, resultado: r2(ingresos - egresos), activo, pasivo, pn, resultadoAcum: r2(resultadoAcum), cuadra: Math.abs(activo - pasivo - pn - resultadoAcum) < 0.05 };
}
