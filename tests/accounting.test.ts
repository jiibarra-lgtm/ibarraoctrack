import { describe, expect, it } from "vitest";
import { ledger, statements, trialBalance, validateEntry, type Account } from "@/lib/accounting";

const acc: Account[] = [
  { code: "1", name: "ACTIVO", type: "activo", imputable: false, active: true },
  { code: "1.1.02", name: "Banco", type: "activo", imputable: true, active: true },
  { code: "1.1.03", name: "Deudores", type: "activo", imputable: true, active: true },
  { code: "2.1.03", name: "IVA DF", type: "pasivo", imputable: true, active: true },
  { code: "3.1.01", name: "Capital", type: "patrimonio", imputable: true, active: true },
  { code: "4.1.01", name: "Ventas", type: "ingreso", imputable: true, active: true },
];

describe("contabilidad", () => {
  it("valida asientos", () => {
    expect(validateEntry([{ account_code: "a", debit: 100, credit: 0 }, { account_code: "b", debit: 0, credit: 100 }])).toBeNull();
    expect(validateEntry([{ account_code: "a", debit: 100, credit: 0 }, { account_code: "b", debit: 0, credit: 90 }])).toMatch(/No balancea/);
    expect(validateEntry([{ account_code: "a", debit: 100, credit: 0 }])).toMatch(/dos líneas/);
  });
  it("mayor con saldo", () => {
    expect(ledger(50, [{ debit: 100, credit: 0 }, { debit: 0, credit: 30 }]).map((x) => x.balance)).toEqual([150, 120]);
  });
  it("sumas y saldos, resultados y patrimonio cuadran", () => {
    const rows = [
      { account_code: "1.1.02", debit: 121, credit: 0, opening: 1000 },
      { account_code: "1.1.03", debit: 121, credit: 121, opening: 0 },
      { account_code: "2.1.03", debit: 0, credit: 21, opening: 0 },
      { account_code: "3.1.01", debit: 0, credit: 0, opening: -1000 },
      { account_code: "4.1.01", debit: 0, credit: 100, opening: 0 },
    ];
    const tb = trialBalance(acc, rows);
    expect(tb.totals.debit).toBe(tb.totals.credit);
    expect(tb.lines.find((l) => l.code === "1")?.closing).toBe(1121);
    const st = statements(acc, rows);
    expect(st).toMatchObject({ ingresos: 100, egresos: 0, resultado: 100, activo: 1121, pasivo: 21, pn: 1000, cuadra: true });
  });
});
