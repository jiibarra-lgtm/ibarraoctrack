import { describe, expect, it } from "vitest";
import { simulate } from "@/lib/simulate";

describe("simulador", () => {
  it("mismo caso que la rentabilidad de órdenes", () => {
    const r = simulate({ qty: "100", price: "121", cost: "60", freight: "700", pct: "", target: "15", withVat: true, vatRate: "21" });
    expect(r.sales).toBe("10000.00");
    expect(r.goods).toBe("6000.00");
    expect(r.profit).toBe("3300.00");
    expect(r.margin).toBe("33.00");
    expect(r.markup).toBe("66.67");
    expect(r.verdict).toBe("ok");
    // (6000 + 700) / 0,85 / 100 × 1,21
    expect(r.minPrice).toBe("95.38");
    expect(r.breakEven).toBe("81.07");
    // 10000 × 0,85 − 700 = 7800 / 100
    expect(r.maxCost).toBe("78.00");
  });
  it("detecta pérdida y considera % sobre venta", () => {
    const r = simulate({ qty: "10", price: "1000", cost: "980", freight: "", pct: "3", target: "15", withVat: false, vatRate: "21" });
    expect(r.profit).toBe("-100.00");
    expect(r.verdict).toBe("loss");
  });
});
