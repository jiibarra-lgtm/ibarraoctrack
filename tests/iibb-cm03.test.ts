import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { parseCm03 } from "@/lib/iibb-cm03";
import { pdfLines } from "@/lib/invoice/pdf-lines";

describe("CM03 de SIFERE", () => {
  it("lee jurisdicciones, totales y el pago del VEP", () => {
    const c = parseCm03([
      "IMPUESTO SOBRE LOS INGRESOS BRUTOS", "CONVENIO MULTILATERAL", "DJ MENSUAL - CM03",
      "CUIT: 20-11111111-2  N° Verificador: 123456", "Anticipo: 202610",
      "Datos Presentación Arca: DDJJ presentada el 13/11/2026 - 15:40:30 ante ARCA",
      "CABA  $ 1.000.000,00  $ 900.000,00  $ 0,00  $ 0,00  $ 100.000,00  $ 100.000,00",
      "BUENOS AIRES  $ 500,00  $ 600,00  $ 0,00  $ 100,00  $ 0,00  $ 0,00",
      "TOTALES  $ 1.000.500,00  $ 900.600,00  $ 0,00  $ 100,00  $ 100.000,00  $ 100.000,00",
      "Total a pagar: $ 100.000,00", "Pago de VEP", "N° de VEP", "999", "Importe", "$ 100.000,00",
      "N° de secuencia  Fecha de pago", "244  13/11/2026 - 15:49:16 Hs.",
    ])!;
    expect(c).toMatchObject({ month: "2026-10", verifier: "123456", presented_at: "2026-11-13", total_tax: 1000500, total_due: 100000, paid_at: "2026-11-13", paid_amount: 100000, vep: "999" });
    expect(c.rows).toEqual([
      { code: 901, tax: 1000000, restan: 900000, suman: 0, favor_contrib: 0, favor_fisco: 100000, due: 100000 },
      { code: 902, tax: 500, restan: 600, suman: 0, favor_contrib: 100, favor_fisco: 0, due: 0 },
    ]);
  });
  it("formato viejo con código de jurisdicción y sin VEP", () => {
    const c = parseCm03(["Convenio Multilateral", "CM03", "Anticipo:  202603  Secuencia:  Original",
      "901  CABA  $4.095.324,22  $3.466.697,32  $0,00  $0,00  $628.626,90  $628.626,90"])!;
    expect(c.month).toBe("2026-03");
    expect(c.rows[0]).toMatchObject({ code: 901, tax: 4095324.22, due: 628626.9 });
    expect(c.paid_at).toBeNull();
  });
  it("no confunde una factura con un CM03", () => {
    expect(parseCm03(["FACTURA A", "Total $ 100,00"])).toBeNull();
  });
  const real = "tests/fixtures/real/2026-10.pdf";
  it.skipIf(!existsSync(real))("PDF real", async () => {
    const c = parseCm03((await pdfLines(new Uint8Array(readFileSync(real)))).flat())!;
    expect(c.month).toBe("2026-10");
    expect(c.rows.length).toBe(2);
    expect(c.total_due).toBeGreaterThan(0);
    expect(c.paid_amount).toBe(c.total_due);
  });
});
