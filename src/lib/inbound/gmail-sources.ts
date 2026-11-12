import { BILL_QUERY } from "@/lib/inbound/bills";
import { PAYMENT_QUERY } from "@/lib/inbound/payments";
import { INVOICE_QUERY } from "@/lib/inbound/supplier-invoices";

/**
 * Qué busca el script de Gmail. El script lo pide a la app en cada corrida, así que agregar o cambiar
 * una búsqueda no obliga a pegar el script de nuevo. Una búsqueda nueva trae su historial sola (days).
 * mode: "mail" manda el texto del mail; "pdf" manda los PDF adjuntos (facturas de proveedores).
 */
export type GmailSource = { key: string; q: string; days: number; mode: "mail" | "pdf" };

export const GMAIL_SOURCES: GmailSource[] = [
  { key: "ml", days: 180, mode: "mail", q: 'from:mercadolibre {subject:compraste subject:vendiste subject:factura subject:"en camino" subject:"llegó tu compra" subject:"recibiste tu paquete"}' },
  { key: "gob", days: 180, mode: "mail", q: "{from:buenosaires.gob.ar to:buenosaires.gob.ar from:bue.edu.ar to:bue.edu.ar from:gob.ar to:gob.ar from:gov.ar to:gov.ar from:avisos.bancociudad.com.ar}" },
  { key: "servicios", days: 180, mode: "mail", q: BILL_QUERY },
  { key: "pagos", days: 180, mode: "mail", q: PAYMENT_QUERY },
  // Banco completo: todos los avisos del Ciudad (movimientos + saldo) y débitos de tarjeta que no se cubrieron
  { key: "banco", days: 400, mode: "mail", q: '{from:avisos.bancociudad.com.ar subject:"pudimos debitar"}' },
  { key: "facturas", days: 730, mode: "pdf", q: INVOICE_QUERY },
];

export const GMAIL_SOURCES_VERSION = "2026-11-12a";
