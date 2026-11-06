import { expect, it } from "vitest";
import { parseMercadoLibreMail } from "@/lib/inbound/mercadolibre";

const FROM = "Mercado Libre <no-reply@mercadolibre.com.ar>";

it("compra con cantidad, número y fecha de llegada", () => {
  const body = "Resumo da sua compra\nCompraste 4 unidades de Combo Microfono Shure Sm58 + Cable Canon Xlr De 6 Metros Negro\n\n| Resumen de tu compra |\n\n| Llega el miércoles |\n| | [](http://www.mercadolibre.com.ar) | IBARRAINSUMOS | |\n| | Compraste Combo Microfono Shure Sm58 + Cable Canon Xlr De 6 Metros NegroLlega el miércoles | |\n| Envío a domicilio |\n[| || || Ver detalle y estado | || |](https://myaccount.mercadolibre.com.ar/my_purchases/2000015904701035/status)";
  const e = parseMercadoLibreMail({ id: "m1", from: FROM, subject: "Compraste 4 unidades de Combo Microfono Shure Sm58 + Cable Canon Xlr De 6 Metros Negro", body, date: "2026-11-06T20:57:01Z" })!;
  expect(e).toMatchObject({ kind: "compra", ml_id: "2000015904701035", title: "Combo Microfono Shure Sm58 + Cable Canon Xlr De 6 Metros Negro", quantity: "4", extra_items: 0, eta: "Llega el miércoles", unit_price: null });
});

it("compra con asunto cortado y varios productos; número desde los links del HTML", () => {
  const body = "Compraste Tela Tropical Mecanico X 20 Mts... y 4 productos más\nResumen de tu compra\nIBARRAINSUMOS\nCompraste Tela Tropical Mecanico X 20 Mts - 3m Ancho Rollo productos\nEnvío a domicilio\nVer detalle y estado";
  const e = parseMercadoLibreMail({ id: "m2", from: FROM, subject: "Compraste Tela Tropical Mecanico X 20 Mts... y 4 productos más", body, date: "2026-11-05T12:34:22Z", refs: ["my_purchases/2000015876886615"] })!;
  expect(e).toMatchObject({ kind: "compra", ml_id: "2000015876886615", title: "Tela Tropical Mecanico X 20 Mts - 3m Ancho Rollo", truncated: false, extra_items: 4, quantity: "1" });
});

it("factura disponible", () => {
  const body = "| Compraste Tela Pañolenci Manualidades Navideño 1.5 De Ancho X 1 Metro, Tela Pañolenci Manualidades Navideño 1.5 De Ancho X 1 Metro y 5 productos más. |\n| ¡Tu factura ya está disponible! |";
  const e = parseMercadoLibreMail({ id: "m3", from: FROM, subject: "La factura de la compra #2000015876982673 ya está disponible", body, date: "2026-11-05T12:42:20Z" })!;
  expect(e).toMatchObject({ kind: "factura", ml_id: "2000015876982673", title: "Tela Pañolenci Manualidades Navideño 1.5 De Ancho X 1 Metro" });
});

it("entrega con fecha y hora", () => {
  const body = " Hilo Yute Soga Retorcido 6mm 50m Crudo Marrón\n\n| | Entregado |\n\n| # Llegó tu compra, ¡que la disfrutes! | |\n\nRecibiste Hilo Yute Soga Retorcido 6mm 50m Crudo Marrón.\n\n| | Entregamos el 6 de noviembre a las 16:07 hs. |\n| Ir a mi compra[](https://myaccount.mercadolibre.com.ar/my_purchases/2000015877420119/status?packId=2000015877420121) |";
  const e = parseMercadoLibreMail({ id: "m4", from: "Mercado Libre <no-reply@info.mercadolibre.com.ar>", subject: "Llegó tu compra, ¡que la disfrutes!", body, date: "2026-11-06T19:09:11Z" })!;
  expect(e).toMatchObject({ kind: "entrega", ml_id: "2000015877420119", title: "Hilo Yute Soga Retorcido 6mm 50m Crudo Marrón", at: "2026-11-06T19:07:00.000Z" });
});

it("¿Recibiste tu paquete? con título cortado", () => {
  const body = "Avísanos si lo tienes\nMercado Libre IBARRAINSUMOS 4 Ménsulas Repisa Lateral 20x20cm A...\nConfirmá si ya recibiste tu compra\nEntregamos tu compra.";
  const e = parseMercadoLibreMail({ id: "m5", from: FROM, subject: "¿Recibiste tu paquete?", body, date: "2026-11-06T14:08:10Z" })!;
  expect(e).toMatchObject({ kind: "entrega", ml_id: null, title: "4 Ménsulas Repisa Lateral 20x20cm A", truncated: true });
});

it("venta con Mercado Envíos: precio, cantidad, comprador y cobrado", () => {
  const body = "Revisa los detalles de tu venta.\n| Venta #2000015747589055 |\n| Prepará el paquete e imprimí la etiqueta para enviarlo |\n| [](https://www.mercadolibre.com.ar) | |\n| Pack X 10 Bolsa De Óbito 220cm X 90cm 200 Mic... |\n| $ 104.000 |\n| Cantidad: 3u. |\n| Vendiste con Mercado Envíos |\n\n| | |\n| Te compró Maximiliano | MADMAX2001 |\n\n| | |\n| Cobraste $ 312.000 a liquidar en tu cuenta de Mercado Pago |";
  const e = parseMercadoLibreMail({ id: "m6", from: FROM, subject: "¡Vendiste con Mercado Envíos 3 productos!", body, date: "2026-10-28T16:09:40Z" })!;
  expect(e).toMatchObject({ kind: "venta", ml_id: "2000015747589055", title: "Pack X 10 Bolsa De Óbito 220cm X 90cm 200 Mic", truncated: true, quantity: "3", unit_price: "104000", total_amount: "312000", counterpart: "Maximiliano (MADMAX2001)", shipping: "Mercado Envíos" });
});

it("venta a acordar en texto plano", () => {
  const body = "Venta #2000014907711707\nPrepará el paquete y coordiná la entrega\nDesodorante Aromatizador De Ambientes Clio X ...\n$ 38.000\nCantidad: 10u.\nVendiste con entrega a acordar\nTe compró Sumo Antares\nC.BREIT\nCobraste $ 380.000 a liquidar en tu cuenta de Mercado Pago";
  const e = parseMercadoLibreMail({ id: "m7", from: "Mercado Libre <no-responder@mercadolibre.com>", subject: "¡Vendiste! Coordiná la entrega de 10 productos", body, date: "2026-09-07T14:56:42Z" })!;
  expect(e).toMatchObject({ kind: "venta", quantity: "10", unit_price: "38000", total_amount: "380000", counterpart: "Sumo Antares (C.BREIT)", shipping: "entrega a acordar", title: "Desodorante Aromatizador De Ambientes Clio X" });
});

it("ignora mensajes, opiniones y publicidad", () => {
  expect(parseMercadoLibreMail({ id: "x", from: FROM, subject: "Tenés un mensaje nuevo en Cafe Cabrales", body: "", date: "2026-11-05T12:00:00Z" })).toBeNull();
  expect(parseMercadoLibreMail({ id: "y", from: "Mercado Ads <mercadoads@mercadolibre.com.ar>", subject: "Compraste algo", body: "", date: "2026-11-05T12:00:00Z" })).toBeNull();
});
