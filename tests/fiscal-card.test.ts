import { describe, expect, it } from "vitest";
import { parseCardAlert } from "@/lib/inbound/card-alerts";
import { parseTaxNotice } from "@/lib/inbound/tax-notices";
import { parseBacMail } from "@/lib/inbound/bac-mail";

const MP = "Mercado Pago <no-responder@mercadopago.com.ar>";
describe("Tarjeta Mercado Pago", () => {
  it("cierre del resumen con vencimiento", () => {
    const a = parseCardAlert({ id: "1", from: MP, subject: "Debitaremos el total de tu tarjeta el 10 de noviembre", date: "2026-11-06T12:12:06Z",
      body: "Cerró el resumen de noviembre\nTarjeta de crédito\nCerró el resumen de tu tarjeta y debitaremos el total Usaremos tu dinero disponible. El 10 de noviembre haremos el débito automático\n$ 590.000,\nRevisá el" });
    expect(a).toMatchObject({ kind: "resumen", amount: "590000", due_date: "2026-11-10" });
  });
  it("débito exitoso", () => {
    const a = parseCardAlert({ id: "2", from: MP, subject: "Hicimos el débito automático para pagar tu tarjeta", date: "2026-11-11T00:31:08Z",
      body: "El débito automático para pagar tu tarjeta fue exitoso Debitamos de tu dinero disponible $ 99.055,71 ¡Liberaste límite" });
    expect(a).toMatchObject({ kind: "pagado", amount: "99055.71" });
  });
  it("vencimiento en enero desde un mail de diciembre", () => {
    const a = parseCardAlert({ id: "3", from: MP, subject: "Debitaremos el total de tu tarjeta el 10 de enero", date: "2026-12-30T12:00:00Z", body: "haremos el débito automático $ 1.000," });
    expect(a?.due_date).toBe("2027-01-10");
  });
  it("sin deuda", () => {
    expect(parseCardAlert({ id: "4", from: MP, subject: "Estás al día con tu tarjeta, no tenés nada que pagar", date: "2026-09-06T11:57:22Z", body: "" })?.kind).toBe("sin_deuda");
  });
});

describe("Avisos fiscales", () => {
  it("e-Ventanilla falta de presentación", () => {
    const n = parseTaxNotice({ id: "a", from: "eventanilla@arca.gob.ar", date: "2026-07-28T08:32:03Z",
      subject: 'ARCA e-Ventanilla: nueva comunicación del sistema "Sistema de Cuentas Tributarias - Recordatorio por falta de presentación"',
      body: 'En tu Ventanilla Electrónica encontrarás una nueva comunicación emitida por el sistema "X" para PEREZ,ANA [20-11111111-2].' });
    expect(n).toMatchObject({ source: "arca", kind: "falta_presentacion", severity: "danger", cuit: "20111111112" });
  });
  it("AGIP VEP", () => {
    const n = parseTaxNotice({ id: "b", from: "AGIP <agip_envios@agip.gov.ar>", date: "2026-10-09T14:41:38Z", subject: "AGIP Alta de Plan Judicial. CUIT: 20111111112",
      body: "El CUIT: 20111111112 ha generado el vep 1234567890 para pago de honorarios del Plan Judicial" });
    expect(n).toMatchObject({ source: "agip", kind: "vep", vep_number: "1234567890" });
  });
});

describe("Actos administrativos del BAC", () => {
  it("ampliación de OC", () => {
    const p = parseBacMail({ id: "x", from: "notificacionesbac@buenosaires.gob.ar", date: "2026-10-20T18:36:04Z",
      subject: "Acto administrativo de ampliación - documento contractual original 455-7296-OC26",
      body: "Estimado proveedor:Tenemos el agrado de dirigirnos a ud., en su carácter de adjudicatario del proceso de compra 455-1015-CME26 Adquisición de Pilas,\n\ta fin de notificarle que el acto administrativo Nº DI-2026-46715600- -HGACG de aprobación de ampliación ha sido publicado" });
    expect(p?.event).toMatchObject({ kind: "acto", act: "ampliacion", bac_number: "455-7296-OC26", process_number: "455-1015-CME26", process_name: "Adquisición de Pilas", act_number: "DI-2026-46715600-HGACG" });
  });
  it("prórroga de convenio marco", () => {
    const p = parseBacMail({ id: "y", from: "notificacionesbac@buenosaires.gob.ar", date: "2026-10-14T18:41:07Z", subject: "Acto administrativo prórroga - convenio marco 623-38-CM26",
      body: "en su carácter de adjudicatario del convenio marco 623-38-CM26 Adquisición de Artículos de Tocador y Perfumería., a fin de notificarle que el acto administrativo Nº RS-2026-45696161- -MHFGC que aprueba la prórroga" });
    expect(p?.event).toMatchObject({ kind: "acto", act: "prorroga", bac_number: null, contract_number: "623-38-CM26", act_number: "RS-2026-45696161-MHFGC" });
  });
});
