import { describe, expect, it } from "vitest";
import { zipSync, strToU8 } from "fflate";
import { arNumber, parseComprobantes, readComprobantesFile } from "@/lib/arca-comprobantes";

const emitidosViejo = [
  `"Fecha";"Tipo";"Punto de Venta";"Número Desde";"Número Hasta";"Cód. Autorización";"Tipo Doc. Receptor";"Nro. Doc. Receptor";"Denominación Receptor";"Tipo Cambio";"Moneda";"Imp. Neto Gravado";"Imp. Neto No Gravado";"Imp. Op. Exentas";"Otros Tributos";"IVA";"Imp. Total"`,
  `"27/10/2026";"6 - Factura B";"00002";"00007049";"00007049";"76431234567890";"80";"30546664620";"HOSPITAL ARGERICH";"1,00";"$";"1000,00";"0,00";"0,00";"0,00";"210,00";"1210,00"`,
  `"28/10/2026";"8 - Nota de Crédito B";"2";"7060";"7060";"76431234567891";"80";"30546664620";"HOSPITAL ARGERICH";"1";"$";"100";"0";"0";"0";"21";"121"`,
].join("\r\n");

const recibidosNuevo = [
  `Fecha de Emisión;Tipo de Comprobante;Punto de Venta;Número Desde;Número Hasta;Cód. Autorización;Tipo Doc. Emisor;Nro. Doc. Emisor;Denominación Emisor;Tipo Cambio;Moneda;Imp. Neto Gravado IVA 10,5%;IVA 10,5%;Imp. Neto Gravado IVA 21%;IVA 21%;Imp. Neto No Gravado;Imp. Op. Exentas;Otros Tributos;Imp. Total`,
  `2026-10-05;1;4;123;123;7600000000001;80;30712345678;DISTRIBUIDORA SANCHEZ SA;1;PES;1.000,00;105,00;2.000,00;420,00;0;0;30,50;3.555,50`,
].join("\n");

describe("Mis Comprobantes ARCA", () => {
  it("lee números argentinos", () => {
    expect(arNumber("1.234,56")).toBe(1234.56);
    expect(arNumber("1234.56")).toBe(1234.56);
    expect(arNumber("-12,5")).toBe(-12.5);
    expect(arNumber("")).toBe(0);
  });

  it("formato viejo de emitidos", () => {
    const p = parseComprobantes(emitidosViejo, "Mis Comprobantes Emitidos.csv");
    expect(p.direction).toBe("emitido");
    expect(p.rows).toHaveLength(2);
    expect(p.rows[0]).toMatchObject({ issue_date: "2026-10-27", voucher_type: 6, point_of_sale: 2, number: "7049", doc_number: "30546664620", net_taxed: 1000, vat: 210, total: 1210, currency: "ARS" });
    expect(p.rows[1]).toMatchObject({ voucher_type: 8, total: 121 });
  });

  it("formato nuevo de recibidos con alícuotas", () => {
    const p = parseComprobantes(recibidosNuevo, "x.csv");
    expect(p.direction).toBe("recibido");
    expect(p.rows[0]).toMatchObject({ voucher_type: 1, net_taxed: 3000, vat: 525, other_taxes: 30.5, total: 3555.5, name: "DISTRIBUIDORA SANCHEZ SA" });
    expect(p.rows[0].vat_detail).toEqual({ "10.5": { neto: 1000, iva: 105 }, "21": { neto: 2000, iva: 420 } });
  });

  it("abre el ZIP de ARCA", async () => {
    const zip = zipSync({ "comprobantes.csv": strToU8(recibidosNuevo) });
    const f = new File([zip], "Mis Comprobantes Recibidos - CUIT 20044240522.zip");
    const [p] = await readComprobantesFile(f);
    expect(p.direction).toBe("recibido");
    expect(p.rows).toHaveLength(1);
  });

  it("rechaza archivos que no son del listado", () => {
    expect(() => parseComprobantes("a;b\n1;2", "otro.csv")).toThrow();
  });
});

describe("recibidos reales de ARCA (traen emisor y receptor)", () => {
  it("se detectan como recibidos", () => {
    const head = `"Fecha de Emisión";"Tipo de Comprobante";"Punto de Venta";"Número Desde";"Número Hasta";"Cód. Autorización";"Tipo Doc. Emisor";"Nro. Doc. Emisor";"Denominación Emisor";"Tipo Doc. Receptor";"Nro. Doc. Receptor";"Tipo Cambio";"Moneda";"Imp. Neto Gravado IVA 0%";"IVA 2,5%";"Imp. Neto Gravado IVA 2,5%";"IVA 5%";"Imp. Neto Gravado IVA 5%";"IVA 10,5%";"Imp. Neto Gravado IVA 10,5%";"IVA 21%";"Imp. Neto Gravado IVA 21%";"IVA 27%";"Imp. Neto Gravado IVA 27%";"Imp. Neto Gravado Total";"Imp. Neto No Gravado";"Imp. Op. Exentas";"Otros Tributos";"Total IVA";"Imp. Total"`;
    const p = parseComprobantes(`${head}\n2026-11-02;1;6;96224;96224;86440650283593;80;20937543094;LEVY IOSEF;80;20044240522;1,00;$;;;;;;;;156706,86;746223,14;;;746223,14;0,00;0,00;0,00;156706,86;902930,00`, "comprobantes_consulta_csv_recibidos.csv");
    expect(p.direction).toBe("recibido");
    expect(p.rows[0]).toMatchObject({ doc_number: "20937543094", name: "LEVY IOSEF" });
  });
});
