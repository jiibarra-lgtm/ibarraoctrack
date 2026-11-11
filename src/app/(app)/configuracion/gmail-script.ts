/** Script de Google Apps Script que corre en la cuenta de Gmail del usuario y manda los mails de trabajo a la app. */
import { GMAIL_SOURCES } from "@/lib/inbound/gmail-sources";

export function gmailScript(url: string, token: string) {
  // copia de respaldo por si la app no responde; normalmente se piden a la app en cada corrida
  const fallback = JSON.stringify(GMAIL_SOURCES).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  return `// OC Track · Conexión con Gmail
// Manda a tu sistema los mails de trabajo: BAC / SIGAF / COMPR.AR y organismos, Banco Ciudad,
// Mercado Libre, facturas de servicios, pagos que salen y facturas de proveedores en PDF.
// Qué buscar lo decide la app: cuando se agrega algo nuevo NO hace falta volver a pegar este script.
const URL = '${url}';
const TOKEN = '${token}';
const RESPALDO = JSON.parse('${fallback}');
const MAX_PDF = 3 * 1024 * 1024;
// Números de compra / venta que vienen en los links del mail (el texto plano no los trae)
const REFS = /(my_purchases\\/\\d+|purchaseId=\\d+|filterPurchase=\\d+|ventas\\/\\d+)/g;

const LOTE = 25;                    // hilos por búsqueda
const LIMITE_MS = 4.5 * 60 * 1000;  // Google corta a los 6 minutos: frenamos antes y seguimos en la próxima corrida

// 1) Ejecutá "instalar" una sola vez (pide permiso para leer Gmail).
//    La primera vez trae el historial en varias tandas: sigue sola cada 10 minutos hasta terminar.
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

function fuentes() {
  try {
    var r = UrlFetchApp.fetch(URL.replace(/\\/gmail$/, '/config'), {
      method: 'post', contentType: 'application/json', muteHttpExceptions: true, payload: JSON.stringify({ token: TOKEN })
    });
    if (r.getResponseCode() === 401) throw new Error('OC Track: la clave del script no es válida, generá una nueva en Configuración');
    if (r.getResponseCode() === 200) return JSON.parse(r.getContentText()).sources;
  } catch (e) {
    if (/clave/.test(String(e))) throw e;
  }
  return RESPALDO;
}

const fecha = function (ms) { var d = new Date(ms); return d.getFullYear() + '/' + (d.getMonth() + 1) + '/' + d.getDate(); };

// 2) Corre sola cada 10 minutos.
function sincronizar() {
  var t0 = Date.now();
  var props = PropertiesService.getScriptProperties();
  var fs = fuentes();
  // Desde cuándo buscar lo nuevo en las búsquedas que ya trajeron su historial
  if (!props.getProperty('desde')) props.setProperty('desde', String(Math.floor(t0 / 1000) - 3600));
  var desde = props.getProperty('desde');
  var total = 0, completo = true;
  for (var i = 0; i < fs.length && completo; i++) {
    var f = fs[i];
    var historial = !props.getProperty('fin_' + f.key);
    if (historial && !props.getProperty('corte_' + f.key)) props.setProperty('corte_' + f.key, fecha(t0 - (f.days || 180) * 864e5));
    var q = f.q + ' after:' + (historial ? props.getProperty('corte_' + f.key) : desde);
    var start = historial ? Number(props.getProperty('pos_' + f.key) || 0) : 0;
    while (true) {
      if (Date.now() - t0 > LIMITE_MS) { completo = false; break; }
      var threads = GmailApp.search(q, start, LOTE);
      total += f.mode === 'pdf' ? enviarFacturas(threads) : enviarMails(threads);
      start += threads.length;
      if (historial) props.setProperty('pos_' + f.key, String(start));
      if (threads.length < LOTE) {
        if (historial) { props.setProperty('fin_' + f.key, '1'); props.deleteProperty('pos_' + f.key); }
        break;
      }
    }
  }
  if (completo) props.setProperty('desde', String(Math.floor(t0 / 1000) - 3600));
  console.log('OC Track: ' + total + ' correos enviados' + (completo ? '' : ' · sigue en la próxima corrida (en 10 minutos)'));
}

function enviarMails(threads) {
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
  for (var j = 0; j < lote.length; j += 50) enviar(lote.slice(j, j + 50));
  return lote.length;
}

// Manda los PDF de facturas de a poco (la app los lee y guarda productos y precios, no el PDF)
function enviarFacturas(threads) {
  var tanda = [], peso = 0, n = 0;
  threads.forEach(function (th) {
    th.getMessages().forEach(function (m) {
      n++;
      m.getAttachments({ includeInlineImages: false }).forEach(function (a) {
        var nombre = a.getName() || '';
        if (!/pdf/i.test(a.getContentType()) && !/\\.pdf$/i.test(nombre)) return;
        if (a.getSize() > MAX_PDF) return;
        var b64 = Utilities.base64Encode(a.getBytes());
        if (tanda.length && (peso + b64.length > 3500000 || tanda.length >= 8)) { postFacturas(tanda); tanda = []; peso = 0; }
        tanda.push({ id: m.getId(), from: m.getFrom(), subject: m.getSubject(), date: m.getDate().toISOString(), filename: nombre, pdf: b64 });
        peso += b64.length;
      });
    });
  });
  if (tanda.length) postFacturas(tanda);
  return n;
}

function postFacturas(invoices) {
  var r = UrlFetchApp.fetch(URL.replace(/\\/gmail$/, '/facturas'), {
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
