import { describe, expect, it } from "vitest";
import { mlDeadline, parseMlReturnMail } from "@/lib/inbound/mercadolibre";

const mail = (subject: string, body: string, date = "2026-11-18T14:38:24Z") => ({ id: "m1", from: "no-responder@mercadolibre.com.ar", subject, body, date });

describe("devoluciones de Mercado Libre", () => {
  it("fecha límite", () => {
    expect(mlDeadline("Tenés tiempo hasta el jueves 26 de noviembre.", "2026-11-18T14:00:00Z")).toBe("2026-11-26");
    expect(mlDeadline("hasta el 5 de enero", "2026-12-20T14:00:00Z")).toBe("2027-01-05");
  });
  it("llevar al punto de despacho", () => {
    const e = parseMlReturnMail(mail("Llevá el producto a un Punto de despacho", "Tenés tiempo hasta el jueves 26 de noviembre.\nIr a Mercado libre\nShure Sm87a Microfono Condenser Supercar...\nTenés hasta el jueves 26 de noviembre para hacer la devolución"));
    expect(e).toMatchObject({ stage: "despachar", title: "Shure Sm87a Microfono Condenser Supercar", deadline: "2026-11-26" });
  });
  it("reembolso cierra", () => {
    expect(parseMlReturnMail(mail("Te devolvimos el dinero de Rallador Cuatro Caras Crystal Rock Gris", "Porque ya devolviste el producto.")))
      .toMatchObject({ stage: "reembolsada", title: "Rallador Cuatro Caras Crystal Rock Gris" });
  });
  it("compra protegida", () => {
    const e = parseMlReturnMail(mail("El reclamo se venció, pero tu compra sigue protegida hasta el 19 de noviembre", "Aún podés pedirnos ayuda con Estantes Flotantes De Melamina Mensula Invisible 80x20\nIr a Mercado libre\nEstantes Flotantes De Melamina Mensula I...", "2026-10-30T03:28:21Z"));
    expect(e).toMatchObject({ stage: "protegida", deadline: "2026-11-19", title: "Estantes Flotantes De Melamina Mensula I" });
  });
  it("ignora otros mails", () => {
    expect(parseMlReturnMail(mail("Actualizamos nuestros Términos y Condiciones", "x"))).toBeNull();
  });
});
