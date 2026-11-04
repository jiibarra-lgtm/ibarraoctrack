import Decimal from "decimal.js";
import { dec, type DecimalInput } from "@/lib/money";

/**
 * Fórmulas del motor de rentabilidad (idénticas a la vista po_profitability en Postgres).
 *
 *  Ganancia bruta      = ventas netas − costos directos
 *  Margen bruto        = ganancia bruta / ventas netas × 100
 *  Markup              = ganancia bruta / costos directos × 100
 *  Ganancia operativa  = ventas netas − costos directos − gastos asignados
 *
 * Ventas netas = importe de la OC sin IVA cuando los precios BAC incluyen IVA.
 * Todo con decimales exactos. La ganancia contable NO es dinero disponible.
 */
export type ProfitInput = {
  salesGross: DecimalInput;
  salesIncludeVat?: boolean;
  vatRate?: DecimalInput;
  directCost: DecimalInput | null;
  otherCosts?: DecimalInput;
};

export type ProfitResult = {
  salesNet: string;
  grossProfit: string | null;
  operatingProfit: string | null;
  grossMargin: string | null;
  operatingMargin: string | null;
  markup: string | null;
};

const pct = (num: Decimal, den: Decimal) => (den.isZero() ? null : num.div(den).times(100).toDecimalPlaces(2).toFixed(2));

export function computeProfit(i: ProfitInput): ProfitResult {
  const divisor = i.salesIncludeVat ? dec(1).plus(dec(i.vatRate ?? 21).div(100)) : dec(1);
  const salesNet = dec(i.salesGross).div(divisor).toDecimalPlaces(2);
  if (i.directCost === null || i.directCost === undefined) {
    return { salesNet: salesNet.toFixed(2), grossProfit: null, operatingProfit: null, grossMargin: null, operatingMargin: null, markup: null };
  }
  const cost = dec(i.directCost);
  const gross = salesNet.minus(cost);
  const operating = gross.minus(dec(i.otherCosts ?? 0));
  return {
    salesNet: salesNet.toFixed(2),
    grossProfit: gross.toFixed(2),
    operatingProfit: operating.toFixed(2),
    grossMargin: pct(gross, salesNet),
    operatingMargin: pct(operating, salesNet),
    markup: pct(gross, cost),
  };
}

/**
 * Reparte un importe entre destinos según pesos (importe o unidades).
 * El último absorbe el redondeo: la suma es exacta (igual que save_cost en la base).
 */
export function distribute(amount: DecimalInput, weights: DecimalInput[]): string[] {
  const total = weights.reduce<Decimal>((a, w) => a.plus(dec(w)), new Decimal(0));
  const amt = dec(amount);
  let assigned = new Decimal(0);
  return weights.map((w, i) => {
    const part = i === weights.length - 1
      ? amt.minus(assigned)
      : total.isZero() ? new Decimal(0) : amt.times(dec(w)).div(total).toDecimalPlaces(2);
    assigned = assigned.plus(part);
    return part.toFixed(2);
  });
}

/**
 * Rentabilidad realizada por lo efectivamente entregado: por renglón, cantidad entregada × precio
 * contra cantidad entregada × costo unitario atribuible. No se prorratea la ganancia total.
 */
export function realizedByItems(items: { deliveredQty: DecimalInput; unitPrice: DecimalInput; unitCost: DecimalInput | null }[]) {
  let sales = new Decimal(0), cost = new Decimal(0), complete = true;
  for (const it of items) {
    const q = dec(it.deliveredQty);
    if (q.isZero()) continue;
    sales = sales.plus(q.times(dec(it.unitPrice)));
    if (it.unitCost === null || it.unitCost === undefined) complete = false;
    else cost = cost.plus(q.times(dec(it.unitCost)));
  }
  return { salesGross: sales.toDecimalPlaces(2).toFixed(2), directCost: complete ? cost.toDecimalPlaces(2).toFixed(2) : null };
}
