import { describe, expect, it } from "vitest";
import { afipQrUrl, computeTotals, guessIvaCondition, IVA_CONDITIONS } from "@/lib/einvoice";

describe("computeTotals", () => {
  it("separa el IVA de precios finales (OC del GCBA) sin cambiar el total", () => {
    const t = computeTotals([
      { description: "Toallas", quantity: 250, unit: "caja", unit_price: 9673.95, vat_rate: 21 },
      { description: "Jabón", quantity: 3, unit: null, unit_price: 1000.01, vat_rate: 21 },
    ], true);
    expect(t.total).toBe(2421487.53);
    expect(t.net + t.vat_total).toBeCloseTo(t.total, 2);
    expect(t.vat).toHaveLength(1);
    expect(t.vat[0]).toMatchObject({ id: 5, rate: 21 });
    expect(t.net).toBeCloseTo(2421487.53 / 1.21, 1);
  });
  it("suma IVA a precios netos y agrupa por alícuota", () => {
    const t = computeTotals([
      { description: "A", quantity: 2, unit: null, unit_price: 100, vat_rate: 21 },
      { description: "B", quantity: 1, unit: null, unit_price: 100, vat_rate: 10.5 },
    ], false);
    expect(t).toMatchObject({ net: 300, vat_total: 52.5, total: 352.5 });
    expect(t.vat.map((v) => v.id).sort()).toEqual([4, 5]);
  });
});

describe("reglas", () => {
  it("organismo público = exento (factura B); RI = A", () => {
    expect(guessIvaCondition("Hospital General de Agudos J. M. Ramos Mejía", "30999999993")).toBe(4);
    expect(IVA_CONDITIONS[4].letter).toBe("B");
    expect(IVA_CONDITIONS[guessIvaCondition("Distribuidora Demo SA", "30711111111")].letter).toBe("A");
  });
  it("QR con los datos del comprobante", () => {
    const u = afipQrUrl({ date: "2026-11-12", cuit: "20123456786", pointOfSale: 4, type: 6, number: 1, total: 1210, docType: 80, docNumber: "30-99999999-3", cae: "86451449993974" });
    const p = JSON.parse(Buffer.from(u.split("p=")[1], "base64").toString());
    expect(p).toMatchObject({ ver: 1, fecha: "2026-11-12", ptoVta: 4, tipoCmp: 6, nroCmp: 1, importe: 1210, tipoDocRec: 80, nroDocRec: 30999999993, tipoCodAut: "E", codAut: 86451449993974 });
  });
});
