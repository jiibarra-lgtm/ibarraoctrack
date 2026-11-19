import { describe, expect, it } from "vitest";
import { parseBillMail } from "@/lib/inbound/bills";

describe("Galeno", () => {
  it("toma el importe del aviso de aumento del plan", () => {
    const b = parseBillMail({ id: "1", from: "Factura Galeno <eresumen@galeno.com.ar>", subject: "Informacion de Interes. Nro de Socio 70501364", date: "2026-11-13T20:51:01Z",
      body: "Nos comunicamos para informarle que de acuerdo con la Resolución 2024-2155-APN-SSS/MS el importe de su plan médico para el mes de Diciembre es $ 1.008.208,62 más impuestos, el cual tiene aplicado un ajuste del 2.3 %. cuyo vencimiento de esta factura opera en el mes de Diciembre de 2026." });
    expect(b).toMatchObject({ provider_key: "galeno", account_ref: "70501364", amount: "1008208.62", due_date: "2026-12-10" });
  });
  it("la factura mensual sin importe igual cuenta", () => {
    const b = parseBillMail({ id: "2", from: "eresumen@galeno.com.ar", subject: "Factura Electronica Galeno Argentina-Socio Nro 70501364", date: "2026-11-06T05:37:40Z", body: "Estimado: Ibarra Juan Ernesto Ante cualquier duda" });
    expect(b).toMatchObject({ provider_key: "galeno", account_ref: "70501364", amount: null });
  });
  it("ignora recetas y resultados", () => {
    expect(parseBillMail({ id: "3", from: "galeno-noreply@galeno.com.ar", subject: "Resultados de Imágenes", date: "2026-11-01T15:37:01Z", body: "te enviamos el presente link" })).toBeNull();
  });
});
