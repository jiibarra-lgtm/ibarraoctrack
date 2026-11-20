import { describe, expect, it } from "vitest";
import { cashCountAdjustment, cashLedger, chequeNext, fixedCostDates, projectFlow, suggestMatches, weekStart } from "@/lib/treasury";

describe("tesorería", () => {
  it("estados de cheques", () => {
    expect(chequeNext("recibido", "cartera")).toContain("depositado");
    expect(chequeNext("emitido", "emitido")).toEqual(["debitado", "rechazado", "anulado"]);
    expect(chequeNext("recibido", "anulado")).toEqual([]);
  });
  it("caja con saldo y arqueo", () => {
    const l = cashLedger([
      { id: "b", mov_date: "2026-11-02", direction: "out", amount: 300, category: "gasto", concept: "x", created_at: "2026-11-02T10:00:00Z" },
      { id: "a", mov_date: "2026-11-01", direction: "in", amount: 1000, category: "venta", concept: "y", created_at: "2026-11-01T10:00:00Z" },
    ]);
    expect(l.map((x) => x.balance)).toEqual([1000, 700]);
    expect(cashCountAdjustment(700, 650)).toEqual({ direction: "out", amount: 50 });
    expect(cashCountAdjustment(700, 700)).toBeNull();
  });
  it("sugiere conciliación por importe y fecha", () => {
    const s = suggestMatches({ amount: 10000, mov_date: "2026-11-10", direction: "out" }, [
      { kind: "cheque", ref_id: "1", label: "cheque", amount: 10000, date: "2026-11-09", dir: "out" },
      { kind: "gasto_fijo", ref_id: "2", label: "luz", amount: 10020, date: "2026-11-10", dir: "out" },
      { kind: "cobro", ref_id: "3", label: "cobro", amount: 10000, date: "2026-11-10", dir: "in" },
    ]);
    expect(s.map((x) => x.ref_id)).toEqual(["1", "2"]);
  });
  it("proyecta el saldo por semana", () => {
    expect(weekStart("2026-11-20")).toBe("2026-11-16");
    const w = projectFlow(1000, [
      { date: "2026-11-01", amount: 500, dir: "in", group: "cobros", label: "vencido", certain: false },
      { date: "2026-11-25", amount: 300, dir: "out", group: "fijos", label: "alquiler", certain: true },
      { date: "2027-05-01", amount: 999, dir: "out", group: "fijos", label: "lejos", certain: true },
    ], "2026-11-20", 3, { collectPct: 50 });
    expect(w[0]).toMatchObject({ week: "2026-11-16", in: 250, opening: 1000, closing: 1250 });
    expect(w[1]).toMatchObject({ out: 300, closing: 950 });
    expect(w[2].closing).toBe(950);
  });
  it("vencimientos de gastos fijos", () => {
    expect(fixedCostDates("2026-11-20", "2027-01-31", 10, 1)).toEqual(["2026-12-10", "2027-01-10"]);
    expect(fixedCostDates("2026-11-01", "2027-04-30", 5, 2)).toEqual(["2026-11-05", "2027-01-05", "2027-03-05"]);
  });
});
