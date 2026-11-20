import { describe, expect, it } from "vitest";
import { addDays, conditionText, installments } from "@/lib/einvoice";

describe("condiciones de venta", () => {
  it("vencimientos y cuotas", () => {
    expect(addDays("2026-11-20", 30)).toBe("2026-12-20");
    expect(installments("2026-11-20", [30, 60, 90], 1000)).toEqual([
      { due: "2026-12-20", amount: 333.33 }, { due: "2027-01-19", amount: 333.33 }, { due: "2027-02-18", amount: 333.34 },
    ]);
    expect(installments("2026-11-20", [], 500)).toEqual([{ due: "2026-11-20", amount: 500 }]);
  });
  it("texto impreso", () => {
    expect(conditionText({ name: "Cuenta corriente 30 días", arca_kind: "cuenta_corriente" })).toBe("Cuenta corriente 30 días");
    expect(conditionText({ name: "Transferencia bancaria", arca_kind: "otros_electronicos" })).toBe("Otros medios de pago electrónicos — Transferencia bancaria");
    expect(conditionText({ name: null, arca_kind: null })).toBe("Cuenta Corriente");
  });
});
