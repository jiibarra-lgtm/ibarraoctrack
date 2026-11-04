import { describe, expect, it } from "vitest";
import { parseInvoiceText } from "@/lib/invoice/parse";

// Texto típico de un comprobante electrónico (formato AFIP/ARCA)
const afip = `ORIGINAL
A
FACTURA
COD. 01
Razón Social: QUIMICA DEL SUR S.R.L.          Punto de Venta: 00004  Comp. Nro: 00012345
Domicilio Comercial: Av. Directorio 4500 - CABA     Fecha de Emisión: 03/11/2026
CUIT: 30-71234567-9
Condición frente al IVA: IVA Responsable Inscripto
CUIT: 20-04424052-2   Apellido y Nombre / Razón Social: JUAN ERNESTO IBARRA
Código  Producto / Servicio                  Cantidad  U. Medida  Precio Unit.  % Bonif  Subtotal   Alícuota IVA  Subtotal c/IVA
1001    Lavandina conc. 55 g/l bidón 5 lts   15,00     unidades   5200,00       0,00     78000,00   21%           94380,00
1002    Papel hig. 100 mts x 4               20,00     unidades   1000,00       10,00    18000,00   21%           21780,00
Importe Neto Gravado: $ 96000,00
IVA 27%: $ 0,00
IVA 21%: $ 20160,00
IVA 10.5%: $ 0,00
Importe Otros Tributos: $ 1440,00
Importe Total: $ 117600,00
CAE N°: 76451234567890   Fecha de Vto. de CAE: 13/11/2026`;

describe("parseInvoiceText (AFIP)", () => {
  const { draft, review, warnings } = parseInvoiceText(afip, "20-04424052-2");
  it("cabecera", () => {
    expect(draft.doc_type).toBe("factura_a");
    expect(draft.point_of_sale).toBe("00004");
    expect(draft.number).toBe("00012345");
    expect(draft.invoice_date).toBe("2026-11-03");
    expect(draft.supplier_cuit).toBe("30-71234567-9"); // no confunde con el CUIT propio
    expect(draft.supplier_name).toBe("QUIMICA DEL SUR S.R.L.");
    expect(draft.cae).toBe("76451234567890");
  });
  it("totales", () => {
    expect(draft.net_amount).toBe("96000.00");
    expect(draft.vat_amount).toBe("20160.00");
    expect(draft.other_taxes).toBe("1440.00");
    expect(draft.total_amount).toBe("117600.00");
  });
  it("renglones con y sin bonificación", () => {
    expect(draft.items).toHaveLength(2);
    expect(draft.items[0]).toMatchObject({ description: "Lavandina conc. 55 g/l bidón 5 lts", quantity: "15.00", unit_price: "5200.00", net_amount: "78000.00", unit: "unidades" });
    expect(draft.items[1]).toMatchObject({ description: "Papel hig. 100 mts x 4", quantity: "20.00", unit_price: "1000.00", discount_pct: "10.00", net_amount: "18000.00" });
  });
  it("sin dudas", () => {
    expect(review).toEqual([]);
    expect(warnings).toEqual([]);
  });
});
