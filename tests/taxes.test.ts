import { describe, expect, it } from "vitest";
import { businessDay, gananciasTax, iibbBalances, ivaBalances, upcomingDues } from "@/lib/taxes";

describe("impuestos", () => {
  it("escala de Ganancias 2026", () => {
    expect(gananciasTax(1000000).tax).toBe(50000);
    expect(gananciasTax(10000000).tax).toBeCloseTo(607607.96 + (10000000 - 7010861.05) * 0.15, 1);
    expect(gananciasTax(-5).tax).toBe(0);
  });
  it("vencimientos pasan al día hábil", () => {
    expect(businessDay(2026, 12, 19)).toBe("2026-12-21"); // sábado 19 → lunes 21
    const d = upcomingDues("20-04424052-2", "2026-11", 2, { iibb_day: 15, autonomos: false, autonomos_day: 5 });
    expect(d.find((x) => x.kind === "iva")?.date).toBe("2026-11-19");
  });
  it("IVA arrastra saldo técnico y aplica retenciones", () => {
    const r = ivaBalances([
      { month: "2026-09", debito: 100, credito: 150, retIva: 0, netSales: 0, retIibb: 0, sircreb: 0 },
      { month: "2026-10", debito: 200, credito: 50, retIva: 30, netSales: 0, retIibb: 0, sircreb: 0 },
    ]);
    expect(r[0]).toMatchObject({ saldoTecnico: 50, aPagar: 0 });
    expect(r[1]).toMatchObject({ saldoTecnico: 0, aPagar: 70 });
  });
  it("IIBB con SIRCREB y saldo a favor", () => {
    const r = iibbBalances([
      { month: "2026-09", debito: 0, credito: 0, retIva: 0, netSales: 1000, retIibb: 20, sircreb: 20 },
      { month: "2026-10", debito: 0, credito: 0, retIva: 0, netSales: 1000, retIibb: 0, sircreb: 0 },
    ], 3);
    expect(r[0]).toMatchObject({ impuesto: 30, aPagar: 0, saldoFavor: 10 });
    expect(r[1]).toMatchObject({ aPagar: 20, saldoFavor: 0 });
  });
});
