import { describe, expect, it } from "vitest";
import { reconcileAccount, stats } from "@/lib/collect-times";

const inv = (id: string, date: string, total: number) => ({ id, date, total, label: id });
const dep = (id: string, date: string, amount: number) => ({ id, date, amount });

describe("stats", () => {
  it("mediana y promedio", () => {
    expect(stats([10, 30, 20])).toEqual({ n: 3, median: 20, avg: 20, min: 10, max: 30 });
    expect(stats([])).toBeNull();
  });
});

describe("reconcileAccount", () => {
  it("pago exacto", () => {
    const r = reconcileAccount([inv("a", "2026-10-07", 1770000.1)], [dep("x", "2026-10-07", 1770000.1)]);
    expect(r.matches[0].kind).toBe("exacto");
    expect(r.balance).toBe(0);
  });
  it("cuotas y anticipos (Policía de Misiones)", () => {
    const r = reconcileAccount(
      [inv("6929", "2026-08-06", 519695), inv("7054", "2026-10-14", 1198505)],
      [dep("1", "2026-07-30", 259847.5), dep("2", "2026-07-31", 259847.5), dep("3", "2026-09-17", 500000), dep("4", "2026-10-01", 698505)],
    );
    expect(r.matches.map((m) => [m.invoice.id, m.kind, m.deposits.length])).toEqual([["7054", "cuotas", 2], ["6929", "cuotas", 2]]);
    expect(r.openInvoices).toEqual([]);
    expect(r.looseDeposits).toEqual([]);
  });
  it("retenciones (Swiss Medical)", () => {
    const r = reconcileAccount([inv("142", "2026-08-11", 900000.06)], [dep("x", "2026-08-19", 759438.73)]);
    expect(r.matches[0]).toMatchObject({ kind: "retencion", days: 8, pct: 15.6 });
    expect(r.balance).toBe(0);
  });
  it("lo que no cierra queda abierto", () => {
    const r = reconcileAccount([inv("a", "2026-10-01", 1000)], [dep("x", "2026-10-02", 300)]);
    expect(r.openInvoices).toHaveLength(1);
    expect(r.looseDeposits).toHaveLength(1);
    expect(r.balance).toBe(700);
  });
});
