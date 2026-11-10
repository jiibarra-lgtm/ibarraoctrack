import { describe, expect, it } from "vitest";
import { parseNum, parseSupplierInvoice } from "@/lib/invoice/supplier-invoice";
import { supplierHint } from "@/lib/inbound/supplier-invoices";

// Datos inventados que imitan los formatos reales (CUIT con dígito verificador válido, nombres ficticios)
const OWN = "20123456786";

describe("parseNum", () => {
  it("entiende formatos argentinos e ingleses", () => {
    expect(parseNum("1.001.889,00")).toBe(1001889);
    expect(parseNum("1,998,750.00")).toBe(1998750);
    expect(parseNum("7,995.000")).toBe(7995);
    expect(parseNum("611.710,0000")).toBe(611710);
    expect(parseNum("137176,25")).toBe(137176.25);
    expect(parseNum("2401522.36")).toBe(2401522.36);
    expect(parseNum("250.00")).toBe(250);
    expect(parseNum("7.995")).toBe(7995);
    expect(parseNum("-54870,50")).toBe(-54870.5);
  });
});

describe("parseSupplierInvoice", () => {
  it("autoimpresor con código, cantidad antes de la descripción y descuento", () => {
    const r = parseSupplierInvoice([[
      "FACTURA  0020  00012345",
      "A  06/11/2026 14:08:57",
      "EMPRESA COMPRADORA",
      "20-12345678 6  01 Responsable Inscripto",
      "0053700  350  BOLIGRAFO PUNTO 1 MM AZUL  111.57  39,049.57 21",
      "0013160  10  CUADERNO 29/7 X 84 HJS RAYADO  2,601.87  42  15,090.83 21",
      "SUBTOTAL  54,140.40",
      "54,140.40  11,369.48 21.00%  2,436.32  67,946.20",
      "Imprenta: Autoimpresor Cuit: 30-71111111-1  C.A.E. Nro: 86451449993974 Vto: 16/11/2026",
    ]], { ownCuit: OWN });
    expect(r).toMatchObject({ letter: "A", point_of_sale: 20, number: 12345, issue_date: "2026-11-06", issuer_cuit: "30711111111", cae: "86451449993974", total: 67946.2 });
    expect(r.items).toHaveLength(2);
    expect(r.items[0]).toMatchObject({ code: "0053700", description: "BOLIGRAFO PUNTO 1 MM AZUL", quantity: 350, line_net: 39049.57 });
    expect(r.items[1]).toMatchObject({ quantity: 10, list_price: 2601.87, discount_pct: 42, line_net: 15090.83 });
    expect(r.factor).toBeCloseTo(67946.2 / 54140.4, 3);
    expect(r.items[0].unit_final).toBeCloseTo((39049.57 * r.factor!) / 350, 1);
  });

  it("cantidad por caja y precio por unidad (bulto de 12) con dos descuentos y código de barras", () => {
    const r = parseSupplierInvoice([[
      "FACTURA", "A", "Código 001", "FCA0001100067382",
      "PROVEEDOR DEMO S.A.  FECHA:  26/10/2026",
      "CUIT:  20-12345678-6",
      "ARTICULO  DETALLE  UM  CANTIDAD  PRECIO %Dto. %Dto. %Dto. %Dto.  TOTAL",
      "6043910  DEMO shampoo Coco 930  BOX  50  1.995,00  10,00 7,00  0,00  0,00  1.001.889,00",
      "SUBTOTAL  $  1.001.889,00",
      "TOTAL  1.242.342,36",
      "30722222225001000118643951168310720261105",
    ]], { ownCuit: OWN });
    expect(r).toMatchObject({ point_of_sale: 11, number: 67382, issuer_cuit: "30722222225", issue_date: "2026-10-26" });
    expect(r.items[0]).toMatchObject({ quantity: 50, unit: "BOX", pack: 12, list_price: 1995, description: "DEMO shampoo Coco 930" });
    expect(r.items[0].unit_net).toBeCloseTo(20037.78, 2);
  });

  it("formato AFIP con punto de venta, unidades, IVA en el renglón y copias duplicadas", () => {
    const page = [
      "Punto de Venta: 00003  Comp. Nro: 00001746",
      "Razón Social: TALLER DEMO SA  Fecha de Emisión: 21/10/2026",
      "Domicilio Comercial: Calle 1  CUIT: 30733333339",
      "Fecha de Inicio de Actividades: 01/10/1983",
      "CUIT:  20123456786  Apellido y Nombre / Razón Social: EMPRESA COMPRADORA",
      "Código  Producto / Servicio  Cantidad  U. medida  Precio Unit.  % Bonif  Subtotal",
      "3001  Reparacion y mantenimiento  1,00  unidades  51000,00  0,00  51000,00  21%  61710,00",
      "Importe Neto Gravado: $  51000,00",
      "Importe Total: $  61710,00",
      "CAE N°: 86428733217431",
    ];
    const r = parseSupplierInvoice([page, page, page], { ownCuit: OWN });
    expect(r).toMatchObject({ point_of_sale: 3, number: 1746, issue_date: "2026-10-21", issuer_cuit: "30733333339", total: 61710, quality: "ok" });
    expect(r.items).toHaveLength(1);
    expect(r.items[0]).toMatchObject({ quantity: 1, unit: "unidades", line_net: 51000, unit_final: 61710 });
  });

  it("número pegado a la unidad y sin CUIT del emisor; no confunde la letra chica con nota de débito", () => {
    const r = parseSupplierInvoice([[
      "A00004-00011306",
      "C.A.B.A., 29/10/2026",
      "EMPRESA COMPRADORA  REMITO  R00003-00019350",
      "Responsable inscripto  CUIT  20-12345678-6",
      "0402805/1500TOALLAS INTERCALADAS 20X36  250.00CAJ  250.00  7,995.000  1,998,750.00",
      "C.A.E: 86449993902612",
      "se emitira una nota de debito por la diferencia",
      "1,998,750.00  419,737.50  2,418,487.50",
    ]], { ownCuit: OWN });
    expect(r).toMatchObject({ kind: "factura", letter: "A", point_of_sale: 4, number: 11306, issuer_cuit: null, total: 2418487.5, factor: 1.21 });
    expect(r.items[0]).toMatchObject({ code: "0402805/1500", description: "TOALLAS INTERCALADAS 20X36", quantity: 250, unit: "CAJ", unit_final: 9673.95 });
  });

  it("bonificación general y continuación de descripción", () => {
    const r = parseSupplierInvoice([[
      "A  FACTURA",
      "Cód. Nº 01  Nro. 00003-00020681  ORIGINAL",
      "Fecha de emisión:  30/09/2026",
      "C.U.I.T.: 30-74444444-2",
      " CANTIDAD  ARTÍCULO  DETALLE  PRECIO  DESCUENTOS  TOTAL",
      "  20.00  10123  DISPENSER JUMBO X 400 MTS. TAPA BLANCA  7,636.00  3.00 %  148,138.40",
      "  1.00  ESCRITORIO SMART C70  611.710,0000  611.710,00",
      "  TAPA MELAMINA 25MM CON CANTO RECTO",
      "SUBTOTAL  759,848.40",
      "TOTAL Pesos  901,036.36",
    ]], { ownCuit: OWN });
    expect(r.items).toHaveLength(2);
    expect(r.items[0]).toMatchObject({ quantity: 20, discount_pct: 3, description: "DISPENSER JUMBO X 400 MTS. TAPA BLANCA", unit: null });
    expect(r.items[1].detail).toBe("TAPA MELAMINA 25MM CON CANTO RECTO");
    expect(r.issue_date).toBe("2026-09-30");
  });
});

describe("supplierHint", () => {
  it("usa el dominio de la empresa o el nombre si es una casilla gratuita", () => {
    expect(supplierHint("Juana Pérez <facturacion@proveedordemo.com.ar>")).toBe("Proveedordemo");
    expect(supplierHint("relay@abc.com.ar")).toBe("ABC");
    expect(supplierHint("Plasticos Demo <demo123@gmail.com>")).toBe("Plasticos Demo");
  });
});
