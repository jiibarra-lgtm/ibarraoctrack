import { describe, expect, it } from "vitest";
import { coefSum, defaultDeductions, liquidateIibb } from "@/lib/iibb";

describe("IIBB convenio multilateral", () => {
  const js = [{ code: 901, coefficient: 0.8, rate: 3 }, { code: 902, coefficient: 0.2, rate: 3.5 }];
  it("reparte la base y aplica alícuotas", () => {
    expect(coefSum(js)).toBe(1);
    const d = defaultDeductions(js, 10000, 1000);
    expect(d[901]).toEqual({ retenciones: 10000, percepciones: 0, sircreb: 800 });
    expect(d[902]).toEqual({ retenciones: 0, percepciones: 0, sircreb: 200 });
    const l = liquidateIibb(1_000_000, js, d, { 902: 500 });
    expect(l.rows[0]).toMatchObject({ base: 800000, tax: 24000, due: 13200, favor_next: 0 });
    expect(l.rows[1]).toMatchObject({ base: 200000, tax: 7000, due: 6300 });
    expect(l.totalDue).toBe(19500);
  });
  it("saldo a favor cuando las retenciones superan el impuesto", () => {
    const l = liquidateIibb(100_000, [{ code: 901, coefficient: 1, rate: 3 }], { 901: { retenciones: 5000, percepciones: 0, sircreb: 0 } }, {});
    expect(l.rows[0]).toMatchObject({ tax: 3000, due: 0, favor_next: 2000 });
  });
});

import { checkYear } from "@/lib/iibb";
describe("control contra el CM03", () => {
  const js = [{ code: 901, coefficient: 1, rate: 5 }];
  it("detecta que se presentó con otra alícuota y encadena el saldo a favor de ARCA", () => {
    const c = checkYear(
      [{ month: "2026-01", sales: 1000, retIibb: 10, sircreb: 0 }, { month: "2026-02", sales: 1000, retIibb: 100, sircreb: 0 }, { month: "2026-03", sales: 1000, retIibb: 0, sircreb: 0 }],
      js,
      [{ month: "2026-01", total_tax: 30, total_due: 20, paid_at: null, rows: [{ code: 901, tax: 30, restan: 10, due: 20, favor_next: 0 }] },
       { month: "2026-02", total_tax: 50, total_due: 0, paid_at: null, rows: [{ code: 901, tax: 50, restan: 100, due: 0, favor_next: 50 }] }],
    );
    expect(c[0]).toMatchObject({ status: "diferencia", taxDiff: -20 });
    expect(c[0].effective[901]).toBe(3);
    expect(c[0].issues[0]).toMatch(/3,00 %.*5 %/);
    expect(c[1].status).toBe("ok");
    expect(c[2]).toMatchObject({ status: "sin_presentar" });
    expect(c[2].calc.rows[0]).toMatchObject({ tax: 50, favor_prev: 50, due: 0 });
  });
});
