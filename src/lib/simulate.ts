import { dec, parseArNumber } from "@/lib/money";

export type SimInput = { qty: string; price: string; cost: string; freight: string; pct: string; target: string; withVat: boolean; vatRate: string };

const n = (v: string) => { const p = parseArNumber(v); return p ? dec(p) : dec(0); };

/** Simulación de una cotización con decimales exactos (mismos criterios que la rentabilidad de las órdenes). */
export function simulate(i: SimInput) {
  const q = n(i.qty), vat = dec(i.vatRate || "0").div(100);
  const gross = q.mul(n(i.price));
  const sales = i.withVat ? gross.div(dec(1).plus(vat)) : gross;
  const goods = q.mul(n(i.cost));
  const p = n(i.pct).div(100), t = n(i.target).div(100);
  const other = n(i.freight).plus(sales.mul(p));
  const profit = sales.minus(goods).minus(other);
  const margin = sales.gt(0) ? profit.div(sales).mul(100) : null;
  const markup = goods.gt(0) ? sales.minus(goods).div(goods).mul(100) : null;
  const toUnit = (v: ReturnType<typeof dec>) => (q.gt(0) ? (i.withVat ? v.mul(dec(1).plus(vat)) : v).div(q) : null);
  const factor = dec(1).minus(p).minus(t);
  const minPrice = factor.gt(0) ? toUnit(goods.plus(n(i.freight)).div(factor)) : null;
  const breakEven = dec(1).minus(p).gt(0) ? toUnit(goods.plus(n(i.freight)).div(dec(1).minus(p))) : null;
  const maxCost = q.gt(0) ? sales.mul(factor).minus(n(i.freight)).div(q) : null;
  const ready = sales.gt(0) && goods.gt(0);
  const verdict: "ok" | "low" | "loss" | null = !ready || margin === null ? null : margin.lt(0) ? "loss" : margin.lt(n(i.target)) ? "low" : "ok";
  const f2 = (v: ReturnType<typeof dec> | null) => (v ? v.toFixed(2) : null);
  return {
    gross: gross.toFixed(2), sales: sales.toFixed(2), goods: goods.toFixed(2), other: other.toFixed(2), profit: profit.toFixed(2),
    margin: margin ? margin.toFixed(2) : null, markup: markup ? markup.toFixed(2) : null,
    minPrice: f2(minPrice), breakEven: f2(breakEven), maxCost: maxCost && maxCost.gt(0) ? maxCost.toFixed(2) : null, ready, verdict,
  };
}
