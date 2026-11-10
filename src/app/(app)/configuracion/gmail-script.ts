/** Script de Google Apps Script que corre en la cuenta de Gmail del usuario y manda los mails de trabajo a la app. */
import { BILL_QUERY } from "@/lib/inbound/bills";
import { PAYMENT_QUERY } from "@/lib/inbound/payments";
import { INVOICE_QUERY } from "@/lib/inbound/supplier-invoices";

export function gmailScript(url: string, token: string) {
  const BILLS = BILL_QUERY;
  const PAYS = PAYMENT_QUERY.replace(/'/g, "\\'");
  const INVS = INVOICE_QUERY.replace(/'/g, "\\'");
  return `// OC Track · Conexión con Gmail
// Manda a tu sistema los avisos de BAC / SIGAF / COMPR.AR, los correos con organismos públicos
// el aviso diario de movimientos de Banco Ciudad (sólo se toman los pagos del GCBA y SIRCREB)
// los avisos de Mercado Libre (compras, envíos, entregas, facturas y ventas)
// las facturas de servicios (gas, luz, agua, teléfono, prepaga) y los pagos que salen (transferencias,
// tarjeta, débitos automáticos) para Gastos fijos y variables
// y las facturas de proveedores en PDF (productos, precios, fecha y proveedor).
const URL = '${url}';
const URL_FACTURAS = URL.replace(/\/gmail$/, '/facturas');
const TOKEN = '${token}';
const QUERIES = [
  'from:mercadolibre {subject:compraste subject:vendiste subject:factura subject:"en camino" subject:"llegó tu compra" subject:"recibiste tu paquete"}',
  '{from:buenosaires.gob.ar to:buenosaires.gob.ar from:bue.edu.ar to:bue.edu.ar from:gob.ar to:gob.ar from:gov.ar to:gov.ar from:avisos.bancociudad.com.ar}',
  '${BILLS}',
  '${PAYS}',
  '${INVS}'
];
const FACTURAS = QUERIES.length - 1; // de esta búsqueda se mandan los PDF adjuntos
const MAX_PDF = 3 * 1024 * 1024;
// Números de compra / venta que vienen en los links del mail (el texto plano no los trae)
const REFS = /(my_purchases\\/\\d+|purchaseId=\\d+|filterPurchase=\\d+|ventas\\/\\d+)/g;

const LOTE = 25;                    // hilos por búsqueda
const LIMITE_MS = 4.5 * 60 * 1000;  // Google corta a los 6 minutos: frenamos antes y seguimos en la próxima corrida

// 1) Ejecutá "instalar" una sola vez (pide permiso para leer Gmail).
//    La primera vez trae los últimos 6 meses en varias tandas: sigue sola cada 10 minutos hasta terminar.
function instalar() {
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('sincronizar').timeBased().everyMinutes(10).create();
  sincronizar();
}

// Vuelve a traer todo desde cero (no duplica: la app ignora lo que ya tiene).
function reiniciar() {
  PropertiesService.getScriptProperties().deleteAllProperties();
  instalar();
}

// 2) Corre sola cada 10 minutos.
function sincronizar() {
  var t0 = Date.now();
  var props = PropertiesService.getScriptProperties();
  var desde = props.getProperty('desde');
  if (!desde && !props.getProperty('inicio')) {
    var c = new Date(t0 - 180 * 864e5);
    props.setProperty('inicio', String(Math.floor(t0 / 1000)));
    props.setProperty('corte', c.getFullYear() + '/' + (c.getMonth() + 1) + '/' + c.getDate());
  }
  var total = 0, completo = true;
  for (var i = 0; i < QUERIES.length && completo; i++) {
    if (!desde && props.getProperty('fin' + i)) continue;
    var q = QUERIES[i] + (desde ? ' after:' + desde : ' after:' + props.getProperty('corte'));
    var start = desde ? 0 : Number(props.getProperty('pos' + i) || 0);
    while (true) {
      if (Date.now() - t0 > LIMITE_MS) { completo = false; break; }
      var threads = GmailApp.search(q, start, LOTE);
      var lote = [];
      threads.forEach(function (th) {
        th.getMessages().forEach(function (m) {
          lote.push({
            id: m.getId(), threadId: th.getId(), from: m.getFrom(), to: m.getTo(), subject: m.getSubject(),
            date: m.getDate().toISOString(), body: m.getPlainBody().slice(0, 30000),
            refs: /mercadolibre/i.test(m.getFrom()) ? (m.getBody().match(REFS) || []).slice(0, 40) : [],
            attachments: m.getAttachments({ includeInlineImages: false }).slice(0, 20).map(function (a) {
              return { name: a.getName(), size: a.getSize(), type: a.getContentType() };
            })
          });
        });
      });
      if (i === FACTURAS) enviarFacturas(threads);
      else for (var j = 0; j < lote.length; j += 50) enviar(lote.slice(j, j + 50));
      total += lote.length;
      start += threads.length;
      if (!desde) props.setProperty('pos' + i, String(start));
      if (threads.length < LOTE) { if (!desde) props.setProperty('fin' + i, '1'); break; }
    }
  }
  if (completo) {
    // Historial terminado (o pasada nueva completa): desde ahora sólo lo nuevo
    var base = desde ? Math.floor(t0 / 1000) : Number(props.getProperty('inicio'));
    props.deleteAllProperties();
    props.setProperty('desde', String(base - 3600));
  }
  console.log('OC Track: ' + total + ' correos enviados' + (completo ? '' : ' · sigue en la próxima corrida (en 10 minutos)'));
}

// Manda los PDF de facturas de a poco (la app los lee y guarda productos y precios, no el PDF)
function enviarFacturas(threads) {
  var tanda = [], peso = 0;
  threads.forEach(function (th) {
    th.getMessages().forEach(function (m) {
      m.getAttachments({ includeInlineImages: false }).forEach(function (a) {
        var nombre = a.getName() || '';
        if (!/pdf/i.test(a.getContentType()) && !/\.pdf$/i.test(nombre)) return;
        if (a.getSize() > MAX_PDF) return;
        var b64 = Utilities.base64Encode(a.getBytes());
        if (tanda.length && (peso + b64.length > 3500000 || tanda.length >= 8)) { postFacturas(tanda); tanda = []; peso = 0; }
        tanda.push({ id: m.getId(), from: m.getFrom(), subject: m.getSubject(), date: m.getDate().toISOString(), filename: nombre, pdf: b64 });
        peso += b64.length;
      });
    });
  });
  if (tanda.length) postFacturas(tanda);
}

function postFacturas(invoices) {
  var r = UrlFetchApp.fetch(URL_FACTURAS, {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    payload: JSON.stringify({ token: TOKEN, invoices: invoices })
  });
  if (r.getResponseCode() === 401) throw new Error('OC Track: la clave del script no es válida, generá una nueva en Configuración');
  if (r.getResponseCode() !== 200) console.log('OC Track facturas respondió ' + r.getResponseCode() + ': ' + r.getContentText().slice(0, 300));
}

function enviar(messages) {
  var r = UrlFetchApp.fetch(URL, {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    payload: JSON.stringify({ token: TOKEN, messages: messages })
  });
  if (r.getResponseCode() !== 200) throw new Error('OC Track respondió ' + r.getResponseCode() + ': ' + r.getContentText());
}
`;
}
