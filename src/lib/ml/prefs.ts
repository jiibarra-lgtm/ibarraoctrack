/** Preferencias de etiquetas y reglas de rentabilidad de Mercado Libre (guardadas en ml_settings). */
export type LabelPrefs = {
  format: "pdf" | "zpl";               // PDF (impresora común) o Zebra
  scope: "hoy" | "pendientes";         // sólo las ventas de hoy o todas las que están listas para despachar
  onlyNew: boolean;                    // sólo las que todavía no se imprimieron
  flex: boolean;                       // incluir envíos Flex
  colecta: boolean;                    // incluir Colecta / despacho en agencia
};
export const DEFAULT_LABELS: LabelPrefs = { format: "pdf", scope: "pendientes", onlyNew: true, flex: true, colecta: true };
export const labelPrefs = (v: unknown): LabelPrefs => ({ ...DEFAULT_LABELS, ...(v && typeof v === "object" ? (v as Partial<LabelPrefs>) : {}) });

export type ProfitRules = {
  shipMode: "estimado" | "ninguno" | "fijo";  // envío a cargo del vendedor
  shipFixed: number;                            // $ por venta, si shipMode = fijo
  paymentPct: number;                           // costo de cobro (% del total)
  taxesPct: number;                             // impuestos sobre la venta (IIBB, débitos y créditos…) %
  perSale: number;                              // costo fijo por venta (embalaje, etiqueta…) $
  perUnit: number;                              // costo fijo por unidad $
  adsInProfit: boolean;                         // descontar la publicidad en la ganancia
};
export const DEFAULT_RULES: ProfitRules = { shipMode: "estimado", shipFixed: 0, paymentPct: 0, taxesPct: 0, perSale: 0, perUnit: 0, adsInProfit: true };
export const profitRules = (v: unknown): ProfitRules => {
  const r = { ...DEFAULT_RULES, ...(v && typeof v === "object" ? (v as Partial<ProfitRules>) : {}) };
  for (const k of ["shipFixed", "paymentPct", "taxesPct", "perSale", "perUnit"] as const) r[k] = Number.isFinite(Number(r[k])) ? Math.max(0, Number(r[k])) : 0;
  return r;
};

/** Costos adicionales de una venta según las reglas. */
export const extraCost = (r: ProfitRules, total: number, units: number) => (total * (r.paymentPct + r.taxesPct)) / 100 + r.perSale + r.perUnit * units;
/** Envío a cargo del vendedor según las reglas (estimado = el de la publicación). */
export const shipCostOf = (r: ProfitRules, estimated: number) => (r.shipMode === "ninguno" ? 0 : r.shipMode === "fijo" ? r.shipFixed : estimated);
