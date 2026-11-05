import { describe, expect, it } from "vitest";
import { parseBacMail } from "@/lib/inbound/bac-mail";

const T = "\n\t\t\t\t\n\t\t\t\t\t\n";
const BAC = "notificacionesbac@buenosaires.gob.ar";
const SIGAF = "sigaf01@buenosaires.gob.ar";
const m = (from: string, subject: string, body: string) => parseBacMail({ id: "x", from, subject, date: "2026-11-04T18:00:00Z", body });

describe("avisos BAC / SIGAF (textos reales)", () => {
  it("orden generada por convenio marco", () => {
    const r = m(BAC, "Generación de orden de compra por convenio marco",
      `Ante cualquier duda comuníquese con Mesa de Ayuda${T}\t\t\t\t\t\t\t SEÑOR JUAN ERNESTO IBARRA:Tenemos el agrado de dirigirnos a ud., en su carácter de adjudicatario del convenio marco N° 623-38-CM26 Adquisición de Artículos de Tocador y Perfumería., a fin de notificarle que se le ha remitido la orden de compra Nº 420-18786-OC26 emitido a su favor.${T}Dirección General de Compras y Contrataciones`);
    expect(r?.event).toEqual({ kind: "oc_generada", bac_number: "420-18786-OC26", convenio_number: "623-38-CM26", convenio_name: "Adquisición de Artículos de Tocador y Perfumería" });
  });
  it("perfeccionamiento", () => {
    const r = m(BAC, "Perfeccionamiento - orden de compra 415-18676-OC26",
      `Estimado proveedor:Le informamos que el siguiente documento ha sido perfeccionado:\n\nDocumento número: 415-18676-OC26\n\nProceso de compra: 623-1245-LPU24 Adquisición de Artículos de Tocador y Perfumería.${T}Dirección General`);
    expect(r?.event).toEqual({ kind: "oc_perfeccionada", bac_number: "415-18676-OC26", process_number: "623-1245-LPU24", process_name: "Adquisición de Artículos de Tocador y Perfumería" });
  });
  it("PRD de SIGAF", () => {
    const r = m(SIGAF, "PRD - CPO", "Se informa que se encuentra emitido el Parte de Recepcion o Certificado Provisorio de Obra, segun corresponda, Nro. 375477/2026, perteneciente a la Orden de Compra BAC nro. 449-17467-OC26.");
    expect(r?.event).toEqual({ kind: "prd", bac_number: "449-17467-OC26", prd_number: "375477/2026" });
  });
  it("pago acreditado", () => {
    const r = m(SIGAF, "Pago Acreditado", "Se informa que se encuentra transferido al banco el pago de la factura B 2-7049 del 06/10/2026");
    expect(r?.event).toEqual({ kind: "pago", invoice_type: "B", point_of_sale: "2", number: "7049", invoice_date: "2026-10-06" });
  });
  it("publicación de pliego (oficina de compras)", () => {
    const r = m(BAC, "Publicación - proceso de compra 416-3920-CME26",
      "Estimado proveedor:Le informamos que se ha publicado el siguiente pliego que incluye ítems de las clases en las que su empresa se encuentra registrada. La apertura del mismo se llevará a cabo el día 12/11/2026.Oficina de compras: 416 - HTAL. CARLOS G. DURANDPliego: 416-3920-CME26 AM Alquiler Concentrador de Oxigeno - PED 88 PTE CANO, OSCAR - ABASTECIMIENTO 12 MESES\n\t\t\tDirección General de Compras y Contrataciones");
    expect(r?.event).toMatchObject({ kind: "publicacion", source: "bac", process_number: "416-3920-CME26", unit_code: "416", unit_name: "HTAL. CARLOS G. DURAND", opening_date: "2026-11-12", title: "AM Alquiler Concentrador de Oxigeno - PED 88 PTE CANO, OSCAR - ABASTECIMIENTO 12 MESES" });
  });
  it("COMPR.AR (Nación): proceso publicado", () => {
    const body = " ComprAR\n\nAnte cualquier duda comuníquese con [*Mesa de Ayuda*](https://comprar.gob.ar/contactenos.aspx)\n\n| [](https://comprar.gob.ar) |\n|---|\n| Estimado/a: Le informamos que se ha publicado el siguiente proceso que incluye ítems de las clases en las que su empresa se encuentra registrada: Oficina de compras: 74/35 - Parque Nacional Copo Proceso: 74/35-0592-LPR26 Adquisición de insumos para botiquines de PN Copo 2026. |\n| [](https://comprar.gob.ar) | |";
    const r = m("COMPR.AR <info@comprar.gob.ar>", "Proceso de compras 74/35-0592-LPR26: Publicado", body);
    expect(r?.event).toEqual({ kind: "publicacion", source: "comprar", process_number: "74/35-0592-LPR26", unit_code: "74/35", unit_name: "Parque Nacional Copo",
      title: "Adquisición de insumos para botiquines de PN Copo 2026", opening_date: null });
    const plain = m("info@comprar.gob.ar", "Proceso de compras 16-0021-LPR26: Publicado", "Estimado/a:\nLe informamos que se ha publicado el siguiente proceso:\nOficina de compras: 16 - Ministerio X\nProceso: 16-0021-LPR26 Adquisición de artículos de limpieza\n");
    expect(plain?.event).toMatchObject({ source: "comprar", process_number: "16-0021-LPR26", unit_name: "Ministerio X", title: "Adquisición de artículos de limpieza" });
  });
  it("ignora mails que no son avisos", () => {
    expect(m("alguien@gmail.com", "Hola", "orden de compra 420-18786-OC26")).toBeNull();
  });
});
