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
