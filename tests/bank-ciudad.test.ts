import { describe, expect, it } from "vitest";
import { classifyMovement, parseCiudad } from "@/lib/inbound/bank-ciudad";

const BODY = `| Consulta de últimos movimientos |
| Te informamos los movimientos al 12/11 de tu cuenta CA $ 000000111122223333 |
| FECHA | DETALLE | IMPORTE |
| 12/11 | TRANSFERENCIA 27111111112 PEREZ ANA | $ 1.585.584,00 |
| 11/11 | COMPRA SUPER DEMO - FLORESTA | $ 11.500,00 |
| 11/11 | PAGO A PROVEEDORES DATANET/INTERPYME 34999032089 Cuenta Unic | $ 1.004.959,04 |
| 11/11 | IMP.LEY 25413 S/DEB | $ 1.200,50 |
| 10/11 | SIRCREB | $ 9.300,00 |
| Saldo: $ 58.780.200,08 |`;

describe("Banco Ciudad completo", () => {
  it("lee todos los movimientos y el saldo", () => {
    const r = parseCiudad(BODY, "2026-11-12T10:41:47Z");
    expect(r.movements).toHaveLength(5);
    expect(r.balance).toEqual({ account: "000000111122223333", as_of: "2026-11-12T10:41:47Z", balance: "58780200.08" });
    const [t, c, g, i, s] = r.movements;
    expect(t).toMatchObject({ kind: "transferencia", direction: null, counterpart_cuit: "27111111112", counterpart_name: "PEREZ ANA", amount: "1585584.00" });
    expect(c).toMatchObject({ kind: "compra", direction: "out", counterpart_name: "SUPER DEMO" });
    expect(g).toMatchObject({ kind: "gcba", direction: "in", counterpart_cuit: "34999032089" });
    expect(i).toMatchObject({ kind: "imp_cheque", direction: "out" });
    expect(s).toMatchObject({ kind: "sircreb", direction: "out", mov_date: "2026-11-10" });
  });
  it("clasifica otros movimientos", () => {
    expect(classifyMovement("EMBARGO OFICIO 123")).toMatchObject({ kind: "embargo", direction: "out" });
    expect(classifyMovement("DEPOSITO DE CHEQUE 45678")).toMatchObject({ kind: "cheque_depositado", direction: "in" });
    expect(classifyMovement("INTERESES SALDO DEUDOR")).toMatchObject({ kind: "interes_descubierto", direction: "out" });
    expect(classifyMovement("TRANSFERENCIA 20111111112-0000003100140911701064-VAR")).toMatchObject({ kind: "transferencia", counterpart_cuit: "20111111112", cbu: "0000003100140911701064" });
  });
});

import { parseCardAlert } from "@/lib/inbound/card-alerts";
describe("Tarjeta Mercado Pago", () => {
  it("lee cuánto se debitó y cuánto falta", () => {
    const a = parseCardAlert({ id: "x", from: "Mercado Pago <no-responder@mercadopago.com.ar>", subject: "Solo pudimos debitar una parte para pagar tu tarjeta",
      body: "Hicimos el débito automático, pero no lograste cubrir el total\nDebitamos $ 1.000,50, pero faltan $ 2.345,67", date: "2026-10-14T00:13:18Z" });
    expect(a).toMatchObject({ debited: "1000.50", missing: "2345.67" });
  });
});
