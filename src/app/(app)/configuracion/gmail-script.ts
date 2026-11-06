/** Script de Google Apps Script que corre en la cuenta de Gmail del usuario y manda los mails de trabajo a la app. */
export function gmailScript(url: string, token: string) {
  return `// OC Track · Conexión con Gmail
// Manda a tu sistema los avisos de BAC / SIGAF / COMPR.AR, los correos con organismos públicos
// y el aviso diario de movimientos de Banco Ciudad (sólo se toman los pagos del GCBA y SIRCREB).
const URL = '${url}';
const TOKEN = '${token}';
const QUERY = '{from:buenosaires.gob.ar to:buenosaires.gob.ar from:bue.edu.ar to:bue.edu.ar from:gob.ar to:gob.ar from:gov.ar to:gov.ar from:avisos.bancociudad.com.ar}';

// 1) Ejecutá "instalar" una sola vez (pide permiso para leer Gmail).
function instalar() {
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('sincronizar').timeBased().everyMinutes(10).create();
  PropertiesService.getScriptProperties().deleteProperty('desde');
  sincronizar();
}

// 2) Después corre solo cada 10 minutos.
function sincronizar() {
  var props = PropertiesService.getScriptProperties();
  var desde = props.getProperty('desde');
  var q = QUERY + (desde ? ' after:' + desde : ' newer_than:180d');
  var inicio = Math.floor(Date.now() / 1000);
  var start = 0, total = 0;
  while (true) {
    var threads = GmailApp.search(q, start, 50);
    if (!threads.length) break;
    var lote = [];
    threads.forEach(function (th) {
      th.getMessages().forEach(function (m) {
        lote.push({
          id: m.getId(), threadId: th.getId(), from: m.getFrom(), to: m.getTo(), subject: m.getSubject(),
          date: m.getDate().toISOString(), body: m.getPlainBody().slice(0, 30000),
          attachments: m.getAttachments({ includeInlineImages: false }).slice(0, 20).map(function (a) {
            return { name: a.getName(), size: a.getSize(), type: a.getContentType() };
          })
        });
      });
    });
    for (var i = 0; i < lote.length; i += 100) enviar(lote.slice(i, i + 100));
    total += lote.length;
    start += threads.length;
    if (threads.length < 50 || start >= 1500) break;
  }
  props.setProperty('desde', String(inicio - 3600));
  console.log('OC Track: ' + total + ' correos enviados');
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
