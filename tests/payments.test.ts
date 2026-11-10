import { expect, it } from "vitest";
import { parsePaymentMail, payeeKey } from "@/lib/inbound/payments";

const d = "2026-11-10T18:04:16Z";
it("transferencia Red Link a una aseguradora", () => {
  const body = "| # Débito de Transferencia |\n| Le informamos que se cursó con éxito el débito de la Transferencia generado el día 10/11/2026 a las 15:04:15 a través de Home Banking/Banca Electrónica para Empresas. |\n| Identificador de Transferencia | RD00TEST0000000000000X |\n| Concepto | VAR |\n| Número de Comprobante | |\n| Importe | $ 615963.02 |\n| CBU Débito | 0000000000000000000011 |\n| CUIT del Destinatario | 20000000001 |\n| Nombre del Destinatario | Aseguradora Ejemplo Seguros SA |\n| CBU Crédito | 0000000000000000000022 |";
  const e = parsePaymentMail({ id: "1", from: "Red Link <noreply@avisos.redlink.com.ar>", subject: "Transferencia Debitada -  10/11/2026 15:04", body, date: d })!;
  expect(e).toMatchObject({ kind: "transferencia", paid_at: "2026-11-10", amount: "615963.02", payee: "Aseguradora Ejemplo Seguros SA", cbu: "0000000000000000000022", concept: "VAR", category: "seguros" });
});
it("sueldo por concepto HAB", () => {
  const body = "Concepto HAB Importe $ 850000.00 Nombre del Destinatario PEREZ JUAN CBU Crédito 0110000000000000000001 generado el día 01/11/2026";
  expect(parsePaymentMail({ id: "2", from: "noreply@avisos.redlink.com.ar", subject: "Transferencia Debitada - 01/11/2026", body, date: d })).toMatchObject({ category: "sueldos", amount: "850000.00" });
});
it("débito automático con tarjeta y consumo con débito", () => {
  const a = parsePaymentMail({ id: "3", from: "mensajesyavisos@mails.santander.com.ar", subject: "Aviso de débito automático", date: d,
    body: "| Te acercamos el detalle del débito con tu Tarjeta Santander Visa Crédito terminada en 1111. |\n| Monto $63.526,14 Comercio AUTOPISTAS URBANAS Fecha 05/11/2026 Hora 07:41 |" })!;
  expect(a).toMatchObject({ kind: "debito_automatico", amount: "63526.14", payee: "AUTOPISTAS URBANAS", card: "1111", paid_at: "2026-11-05", category: "vehiculos" });
  const b = parsePaymentMail({ id: "4", from: "mensajesyavisos@mails.santander.com.ar", subject: "Pagaste $97.200,00", date: d,
    body: "Te acercamos el detalle de tu consumo con la Tarjeta Santander Visa Débito terminada en 2222. Monto $97.200,00 Comercio MERPAGO*TVC5SA Fecha 06/11/2026 Hora 10:34" })!;
  expect(b).toMatchObject({ kind: "tarjeta", payee_key: "TVC5SA", category: "telefonia" });
  expect(parsePaymentMail({ id: "5", from: "mensajesyavisos@mails.santander.com.ar", subject: "Aviso de débito automático", date: d,
    body: "Monto $4.334,87 Comercio CESOP DA GAS Fecha 05/11/2026 Hora 03:22" })).toMatchObject({ category: "servicios" });
});
it("resumen de tarjeta e ignorados", () => {
  expect(parsePaymentMail({ id: "6", from: "mensajesyavisos@mails.santander.com.ar", subject: "Tu resumen vence pronto", date: d,
    body: "Te recordamos que el resumen de tu Tarjeta Santander Visa terminada en 1111 vence el 11/11/2026. Monto en pesos $ 1.234.567,89 Monto en dólares" }))
    .toMatchObject({ kind: "resumen_tarjeta", due_date: "2026-11-11", amount: "1234567.89", payee: "Tarjeta Santander Visa 1111" });
  expect(parsePaymentMail({ id: "7", from: "mensajesyavisos@mails.santander.com.ar", subject: "Consulta de saldo CLIENTE EJEMPLO", date: d, body: "" })).toBeNull();
  expect(payeeKey("MERPAGO*SUPERSANBER")).toBe("SUPERSANBER");
});
