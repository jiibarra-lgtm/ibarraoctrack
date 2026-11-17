/**
 * Cruces para saber cuánto tarda realmente en entrar la plata.
 *  · Por organismo (unidad del BAC): entrega (hoja de ruta) → PRD firmado, y OC perfeccionada → PRD.
 *  · GCBA: factura → aviso de SIGAF → depósito en el Ciudad.
 *  · Clientes que no son el GCBA: cuenta corriente por CUIT (facturas contra depósitos), con pagos en cuotas,
 *    anticipos y retenciones.
 */

export const days = (a: string, b: string) => Math.round((Date.parse(b.slice(0, 10)) - Date.parse(a.slice(0, 10))) / 864e5);

export function stats(xs: number[]) {
  const v = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const mid = Math.floor(v.length / 2);
  const median = v.length % 2 ? v[mid] : Math.round((v[mid - 1] + v[mid]) / 2);
  return { n: v.length, median, avg: Math.round(v.reduce((a, x) => a + x, 0) / v.length), min: v[0], max: v[v.length - 1] };
}

export const addDays = (iso: string, n: number) => new Date(Date.parse(iso.slice(0, 10)) + n * 864e5).toISOString().slice(0, 10);

// ---------------------------------------------------------------------------
// Cuenta corriente por cliente
// ---------------------------------------------------------------------------
export type AccInvoice = { id: string; date: string; total: number; label: string };
export type AccDeposit = { id: string; date: string; amount: number };
export type AccMatch =
  | { kind: "exacto"; invoice: AccInvoice; deposits: AccDeposit[]; days: number }
  | { kind: "cuotas"; invoice: AccInvoice; deposits: AccDeposit[]; days: number }
  | { kind: "retencion"; invoice: AccInvoice; deposits: AccDeposit[]; days: number; retained: number; pct: number };
export type Account = {
  matches: AccMatch[]; openInvoices: AccInvoice[]; looseDeposits: AccDeposit[];
  billed: number; received: number; balance: number;
};

const near = (a: number, b: number) => Math.abs(a - b) <= 1;
/** Ventana razonable entre factura y pago (se aceptan anticipos de hasta 60 días antes). */
const inWindow = (inv: AccInvoice, d: AccDeposit) => { const k = days(inv.date, d.date); return k >= -60 && k <= 240; };

/**
 * Cruza facturas con depósitos de un mismo CUIT:
 *  1) un depósito = una factura;
 *  2) 2 a 4 depósitos que suman una factura (pago en cuotas o anticipos);
 *  3) un depósito entre el 75% y el 99% de una factura, si es la única posible (retenciones).
 * Lo que queda: facturas abiertas y depósitos sueltos.
 */
export function reconcileAccount(invoices: AccInvoice[], deposits: AccDeposit[]): Account {
  const inv = [...invoices].sort((a, b) => a.date.localeCompare(b.date));
  let dep = [...deposits].sort((a, b) => a.date.localeCompare(b.date));
  const matches: AccMatch[] = [];
  const open: AccInvoice[] = [];
  const lastDate = (ds: AccDeposit[]) => ds.reduce((m, d) => (d.date > m ? d.date : m), ds[0].date);

  // 1) exactos
  for (const i of inv) {
    const d = dep.find((x) => near(x.amount, i.total) && inWindow(i, x));
    if (d) { matches.push({ kind: "exacto", invoice: i, deposits: [d], days: days(i.date, d.date) }); dep = dep.filter((x) => x !== d); }
    else open.push(i);
  }
  // 2) cuotas: combinaciones de 2 a 4 depósitos (los candidatos de la ventana, máx. 14 para que sea rápido)
  const stillOpen: AccInvoice[] = [];
  for (const i of open) {
    const cand = dep.filter((x) => inWindow(i, x) && x.amount < i.total + 1).slice(0, 14);
    let found: AccDeposit[] | null = null;
    const walk = (start: number, acc: AccDeposit[], total: number) => {
      if (found || acc.length > 4) return;
      if (acc.length >= 2 && near(total, i.total)) { found = [...acc]; return; }
      for (let k = start; k < cand.length; k++) {
        if (total + cand[k].amount > i.total + 1) continue;
        acc.push(cand[k]); walk(k + 1, acc, total + cand[k].amount); acc.pop();
        if (found) return;
      }
    };
    walk(0, [], 0);
    if (found) {
      const f = found as AccDeposit[];
      matches.push({ kind: "cuotas", invoice: i, deposits: f, days: days(i.date, lastDate(f)) });
      dep = dep.filter((x) => !f.includes(x));
    } else stillOpen.push(i);
  }
  // 3) retenciones: depósito único entre 75% y 99% de una sola factura
  const finalOpen: AccInvoice[] = [];
  for (const i of stillOpen) {
    const cand = dep.filter((x) => inWindow(i, x) && x.amount >= i.total * 0.75 && x.amount < i.total - 1);
    const others = cand.length === 1 ? stillOpen.filter((j) => j !== i && cand[0].amount >= j.total * 0.75 && cand[0].amount < j.total - 1 && inWindow(j, cand[0])) : [];
    if (cand.length === 1 && !others.length) {
      const d = cand[0];
      const retained = Math.round((i.total - d.amount) * 100) / 100;
      matches.push({ kind: "retencion", invoice: i, deposits: [d], days: days(i.date, d.date), retained, pct: Math.round((retained / i.total) * 1000) / 10 });
      dep = dep.filter((x) => x !== d);
    } else finalOpen.push(i);
  }
  const billed = inv.reduce((a, i) => a + i.total, 0);
  const received = deposits.reduce((a, d) => a + d.amount, 0);
  const retainedAll = matches.reduce((a, m) => a + (m.kind === "retencion" ? m.retained : 0), 0);
  return {
    matches: matches.sort((a, b) => b.invoice.date.localeCompare(a.invoice.date)),
    openInvoices: finalOpen, looseDeposits: dep,
    billed, received, balance: Math.round((billed - received - retainedAll) * 100) / 100,
  };
}
