import { describe, expect, it } from "vitest";
import { advise } from "@/lib/price-advice";

const base = { contract_number: "623-20-CM26", line_number: 3, option_number: 1, product_name: "Lavandina", my_stock: 100, my_stock_balance: 56 };

describe("advise", () => {
  it("te ganan y te da para bajar", () => {
    const a = advise({ ...base, my_current_price: 8200, best_other_price: 7970, cost: 5559.5 }); // costo 6727 con IVA
    expect(a.status).toBe("te_ganan");
    expect(a.beatBy).toBe(230);
    expect(a.target).toBe(7890.3);
    expect(a.move).toBe(-309.7);
    expect(a.canLower).toBe(true);
    expect(Math.round(a.marginTarget!)).toBe(17);
  });
  it("te ganan y no te da", () => {
    const a = advise({ ...base, my_current_price: 990, best_other_price: 900, cost: 800 });
    expect(a.canLower).toBe(false);
    expect(a.action).toMatch(/no te da/);
  });
  it("ganás y podés subir", () => {
    const a = advise({ ...base, my_current_price: 1000, best_other_price: 1200, cost: 500 });
    expect(a.status).toBe("ganas");
    expect(a.target).toBe(1188);
    expect(a.move).toBe(188);
  });
  it("stock bajo", () => {
    const a = advise({ ...base, my_current_price: 1000, best_other_price: null, cost: null, my_stock: 2500, my_stock_balance: 350 });
    expect(a.stockAction).toBe("pedir_incremento");
    expect(a.stockAdd).toBe(2150);
  });
});
