import { expect, it } from "vitest";
import { parseBillMail } from "@/lib/inbound/bills";

const d = "2026-10-25T16:29:54Z";
it("Movistar hogar", () => {
  const e = parseBillMail({ id: "1", from: "Factura Movistar <factura.sinpapel@movistar.com.ar>", subject: "Movistar te acerca tu factura", date: d,
    body: "# ¡HOLA CLIENTE EJEMPLO! Movistar te acerca tu factura hogar Vencimiento 05/11/2026 Total a pagar $87.905,41 La misma se debitará de tu Tarjeta American Express Número de Cuenta 100000001" })!;
  expect(e).toMatchObject({ provider_key: "movistar", account_ref: "100000001", amount: "87905.41", due_date: "2026-11-05" });
});
it("Movistar empresas (tabla)", () => {
  const e = parseBillMail({ id: "2", from: "factura.sinpapel@movistar.com.ar", subject: "Movistar Empresas te acerca tu factura", date: d,
    body: "# Cliente Cuenta Vencimiento Total a pagar Adherido a débito automático Factura 200000001 200000002 23/10/2026 $90.353,62 fac" })!;
  expect(e).toMatchObject({ account_ref: "200000002", amount: "90353.62", due_date: "2026-10-23" });
});
it("Metrogas", () => {
  const e = parseBillMail({ id: "3", from: "MetroGAS <no-reply@metrogas.com.ar>", subject: "Metrogas - Vencimiento Factura 40000000001", date: d,
    body: "¡Hola! CLIENTE EJEMPLO Te queremos informar que tu factura vence hoy. Número de cliente: 40000000001 Dirección: Calle Falsa 123 Total a pagar $ 5.568,38 Periodo" })!;
  expect(e).toMatchObject({ provider_key: "metrogas", account_ref: "40000000001", amount: "5568.38" });
});
it("Edesur", () => {
  const e = parseBillMail({ id: "4", from: "Facturas Edesur <noresponder@facturas.edesur.com.ar>", subject: "Edesur informa Emisión de Factura", date: d,
    body: "Hola CLIENTE EJEMPLO, Te informamos que tenés disponible tu factura con fecha de vencimiento el día 03/11/2026, por un importe de $ 6.268,94. Cliente Nº: 300001 Suministro Nº: 300001" })!;
  expect(e).toMatchObject({ provider_key: "edesur", account_ref: "300001", amount: "6268.94", due_date: "2026-11-03" });
});
it("Débito automático de AySA (Santander)", () => {
  const e = parseBillMail({ id: "5", from: "Aviso Santander <mensajesyavisos@mails.santander.com.ar>", subject: "Servicios adheridos a débito automático", date: d,
    body: "Información sobre tu débito Hola Debitamos el siguiente servicio de tu cuenta. Fecha 02/11/2026 Servicio AYSA SA Importe $ 29.510,40 Cuenta" })!;
  expect(e).toMatchObject({ provider_key: "aysa", provider_name: "AySA", amount: "29510.40", due_date: "2026-11-02", paid: true });
});
it("Galeno sin importe en el mail y promos ignoradas", () => {
  expect(parseBillMail({ id: "6", from: "Factura Galeno <eresumen@galeno.com.ar>", subject: "Factura Electronica Galeno Argentina-Socio Nro 500001", date: d, body: "Estimado: Cliente Ejemplo" }))
    .toMatchObject({ provider_key: "galeno", account_ref: "500001", amount: null });
  expect(parseBillMail({ id: "7", from: "Movistar <noreply@movistar.com.ar>", subject: "👉 Tu suscripción está a punto de cambiar.", date: d, body: "precio" })).toBeNull();
});
