import { describe, expect, it } from "vitest";
import { computeProfit, distribute, realizedByItems } from "@/lib/profit";

describe("motor de rentabilidad", () => {
  // Ejemplo del pliego: OC $10.000.000, mercadería $6.000.000, flete $400.000, embalaje $100.000, otros $200.000
  it("ejemplo del pliego (importes netos)", () => {
    const r = computeProfit({ salesGross: "10000000", salesIncludeVat: false, directCost: "6000000", otherCosts: "700000" });
    expect(r.salesNet).toBe("10000000.00");
    expect(r.grossProfit).toBe("4000000.00");
    expect(r.operatingProfit).toBe("3300000.00");
    expect(r.operatingMargin).toBe("33.00");
    expect(r.grossMargin).toBe("40.00");
    expect(r.markup).toBe("66.67");
  });

  it("precios BAC con IVA: la venta neta se calcula sin IVA", () => {
    const r = computeProfit({ salesGross: "132225", salesIncludeVat: true, vatRate: "21", directCost: "80000" });
    expect(r.salesNet).toBe("109276.86");
    expect(r.grossProfit).toBe("29276.86");
    expect(r.grossMargin).toBe("26.79");
  });

  it("sin costo cargado no inventa ganancia", () => {
    const r = computeProfit({ salesGross: "1000", directCost: null });
    expect(r.grossProfit).toBeNull();
    expect(r.markup).toBeNull();
  });

  it("pérdida", () => {
    const r = computeProfit({ salesGross: "1000", directCost: "900", otherCosts: "200" });
    expect(r.operatingProfit).toBe("-100.00");
    expect(r.operatingMargin).toBe("-10.00");
  });
});

describe("distribución de gastos compartidos", () => {
  it("por importe, suma exacta con redondeo al último", () => {
    const parts = distribute("1000.00", ["1", "1", "1"]);
    expect(parts).toEqual(["333.33", "333.33", "333.34"]);
  });
  it("proporcional a importe de órdenes", () => {
    expect(distribute("400000", ["6000000", "4000000"])).toEqual(["240000.00", "160000.00"]);
  });
});

describe("rentabilidad realizada", () => {
  it("entregado 40% de un renglón no implica 40% de la ganancia total", () => {
    // Renglón A muy rentable entregado parcial; renglón B poco rentable sin entregar
    const r = realizedByItems([
      { deliveredQty: "40", unitPrice: "100", unitCost: "50" },
      { deliveredQty: "0", unitPrice: "100", unitCost: "95" },
    ]);
    expect(r.salesGross).toBe("4000.00");
    expect(r.directCost).toBe("2000.00");
  });
  it("si falta el costo de algo entregado, no hay ganancia realizada", () => {
    expect(realizedByItems([{ deliveredQty: "1", unitPrice: "10", unitCost: null }]).directCost).toBeNull();
  });
});
