import { expect, it } from "vitest";
import { isCiudadMovementsMail, parseCiudadMovements } from "@/lib/inbound/bank-ciudad";

const MD = "| |\n| Consulta de últimos movimientos |\n| Te informamos los movimientos al 30/10 de tu cuenta CA $ 000000160200126274 |\n\n| |\n| FECHA | DETALLE | IMPORTE |\n|---|---|---|\n\n| 29/10 | TRANSFERENCIA 20044240522-0000003100140911701064-VAR | $ 487.000,00 |\n\n| 29/10 | COMPRA FARMACITY - CAP.FEDERAL | $ 11.821,00 |\n\n| 28/10 | PAGO VEP Recaudacion SET-20044240522 | $ 66.041,63 |\n\n| 27/10 | PAGO A PROVEEDORES DATANET/INTERPYME 34999032089 GOBIERNO CI | $ 1.986.185,49 |\n\n| 27/10 | COMPRA DIA TIENDA 133 - CAPITAL | $ 18.272,80 |\n\n| |\n| Saldo: $ 81.291.246,51 |";

it("Banco Ciudad: sólo pagos del GCBA y SIRCREB", () => {
  expect(isCiudadMovementsMail("no-responder@avisos.bancociudad.com.ar", "Aviso - Últimos movimientos")).toBe(true);
  const r = parseCiudadMovements(MD, "2026-10-30T10:57:27Z");
  expect(r).toEqual([{ account: "000000160200126274", mov_date: "2026-10-27", detail: "PAGO A PROVEEDORES DATANET/INTERPYME 34999032089 GOBIERNO CI", amount: "1986185.49", occurrence: 1, kind: "gcba", counterpart_cuit: "34999032089" }]);
});

it("texto plano, SIRCREB y cambio de año", () => {
  const plain = "Consulta de últimos movimientos\nTe informamos los movimientos al 02/01 de tu cuenta CA $ 000000160200126274\nFECHA\nDETALLE\nIMPORTE\n30/12\nRETENIBMUL- RET IB SIRCREB 01\n$ 1.234,56\n02/01\nPAGO A PROVEEDORES DATANET/INTERPYME 34999032089 GOBIERNO CI\n$ 500.000,00\nSaldo: $ 1,00";
  const r = parseCiudadMovements(plain, "2027-01-02T10:00:00Z");
  expect(r.map((x) => [x.kind, x.mov_date, x.amount])).toEqual([["sircreb", "2026-12-30", "1234.56"], ["gcba", "2027-01-02", "500000.00"]]);
});
