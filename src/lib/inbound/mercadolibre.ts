import { parseArNumber } from "@/lib/money";

/**
 * Lectura de los mails de Mercado Libre de la cuenta (compras, envíos, entregas, facturas y ventas).
 * Los mails de compra no traen el precio: sólo producto, cantidad y número de compra.
 * Las ventas sí traen precio unitario, cantidad y lo cobrado.
 */
export type MlEventKind = "compra" | "en_camino" | "entrega" | "factura" | "venta";
export type MlEvent = {
  message_id: string;
  kind: MlEventKind;
  at: string;
  ml_id: string | null;
  title: string;
  /** Título truncado por ML ("Hilo Yute Soga Retorcido..."): se usa como prefijo para encontrar la compra. */
  truncated: boolean;
  extra_items: number;
  quantity: string | null;
  unit_price: string | null;
  total_amount: string | null;
  counterpart: string | null;
  shipping: string | null;
  eta: string | null;
};

export type MlMail = { id: string; from: string; subject: string; body: string; date: string; refs?: string[] };

export const isMercadoLibreMail = (from: string) => /mercadolibre\.com/i.test(from) && !/mercadoads|promocion|marketing/i.test(from);

/** Pasa el cuerpo (markdown con tablas o texto plano) a líneas limpias. */
export function mlLines(body: string): string[] {
  return body
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1 ")
    .replace(/‌| /g, " ")
    .split(/\n|\|/)
    .map((l) => l.replace(/^#+\s*/, "").replace(/\s+/g, " ").trim())
    .filter((l) => l && !/^[-:\s]+$/.test(l));
}

const clean = (t: string) => t.replace(/\s+/g, " ").replace(/\s*\.\.\.$|…$/, "").trim();
const wasCut = (t: string) => /(\.\.\.|…)\s*$/.test(t.trim());
const money = (s: string | undefined) => (s ? parseArNumber(s) : null);
const firstRef = (text: string, refs: string[] | undefined, re: RegExp) => {
  for (const src of [...(refs ?? []), text]) { const m = re.exec(src); if (m) return m[1]; }
  return null;
};

const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
function deliveredAt(text: string, received: string): string {
  const m = /Entregamos el (\d{1,2}) de (\w+)(?: a las (\d{1,2}):(\d{2}))?/i.exec(text);
  const mi = m ? MONTHS.indexOf(m[2].toLowerCase()) : -1;
  if (!m || mi < 0) return received;
  const rec = new Date(received);
  let y = rec.getUTCFullYear();
  if (mi > rec.getUTCMonth() + 1) y -= 1; // "31 de diciembre" recibido en enero
  const hh = m[3] ? m[3].padStart(2, "0") : "12", mm = m[4] ?? "00";
  return new Date(`${y}-${String(mi + 1).padStart(2, "0")}-${m[1].padStart(2, "0")}T${hh}:${mm}:00-03:00`).toISOString();
}

const base = (m: MlMail, at: string) => ({
  message_id: m.id, at, ml_id: null as string | null, title: "", truncated: false, extra_items: 0,
  quantity: null as string | null, unit_price: null as string | null, total_amount: null as string | null,
  counterpart: null as string | null, shipping: null as string | null, eta: null as string | null,
});

export function parseMercadoLibreMail(m: MlMail): MlEvent | null {
  if (!isMercadoLibreMail(m.from)) return null;
  const date = new Date(m.date);
  if (Number.isNaN(date.getTime())) return null;
  const at = date.toISOString();
  const subject = m.subject.replace(/\s+/g, " ").trim();
  const lines = mlLines(m.body);
  const text = lines.join("\n");
  const purchaseId = () => firstRef(m.body, m.refs, /(?:my_purchases\/|purchaseId=|filterPurchase=)(\d{10,})/);

  // Compra confirmada
  let s = /^Compraste (?:(\d+) unidades de )?(.+?)(?: y (\d+) productos? más)?$/i.exec(subject);
  if (s) {
    let title = s[2];
    // El asunto puede venir cortado: el cuerpo trae el primer producto completo
    if (wasCut(title)) {
      const pre = clean(title).toLowerCase();
      const full = lines.map((l) => /^Compraste (.+?)(?:\s*productos)?(?:Llega .*| Llega .*)?$/i.exec(l)?.[1])
        .find((t) => t && !/unidades de|productos? más|\.\.\./i.test(t) && t.toLowerCase().startsWith(pre) && t.length > pre.length);
      if (full) title = full;
    }
    return {
      ...base(m, at), kind: "compra", ml_id: purchaseId(), title: clean(title), truncated: wasCut(title),
      extra_items: s[3] ? Number(s[3]) : 0, quantity: s[1] ?? "1",
      eta: /Llega (hoy|mañana|el \p{L}+)/iu.exec(text)?.[0] ?? null,
    };
  }

  // Factura del vendedor disponible
  s = /^La factura de la compra #(\d+) ya está disponible/i.exec(subject);
  if (s) {
    const line = lines.map((l) => /^Compraste (.+?)\.$/i.exec(l)?.[1]).find(Boolean) ?? "";
    const first = line.split(/, | y (?=\d+ productos? más)| y /)[0] ?? "";
    return { ...base(m, at), kind: "factura", ml_id: s[1], title: clean(first), truncated: wasCut(first) };
  }

  // Envío en camino
  if (/^Tu compra está en camino/i.test(subject)) {
    const t = /¡En camino!\s*(.+?)(?:\n|$)/.exec(text)?.[1] ?? "";
    return { ...base(m, at), kind: "en_camino", ml_id: purchaseId(), title: clean(t), truncated: wasCut(t), eta: /Llega (hoy|mañana|el \p{L}+)/iu.exec(text)?.[0] ?? null };
  }

  // Entregada
  if (/^Llegó tu compra/i.test(subject) || /^¿Recibiste tu paquete\?/i.test(subject)) {
    let t = /Recibiste (.+?)\.?(?:\n|$)/.exec(text)?.[1] ?? lines.find((l) => /\.\.\.$/.test(l)) ?? "";
    t = t.replace(/^.*IBARRAINSUMOS\s*/i, "").replace(/^Mercado Libre\s*/i, "");
    return { ...base(m, deliveredAt(text, at)), kind: "entrega", ml_id: purchaseId(), title: clean(t), truncated: wasCut(t) };
  }

  // Venta
  if (/^¡Vendiste/i.test(subject)) {
    const id = /Venta #(\d+)/.exec(text)?.[1] ?? firstRef(m.body, m.refs, /ventas\/(\d{10,})/);
    if (!id) return null;
    const items: { title: string; price: string | null; qty: number }[] = [];
    lines.forEach((l, i) => {
      const q = /^Cantidad:\s*(\d+)\s*u/i.exec(l);
      if (q && i >= 2 && /^\$\s?[\d.,]+$/.test(lines[i - 1])) items.push({ title: lines[i - 2], price: money(lines[i - 1]), qty: Number(q[1]) });
    });
    const subjTitle = /^¡Vendiste(?: con Mercado Envíos(?: Flex)?)?! (.+)$/i.exec(subject)?.[1];
    const first = items[0]?.title ?? subjTitle ?? "";
    const buyerIdx = lines.findIndex((l) => /^Te compró /i.test(l));
    const buyer = buyerIdx >= 0 ? lines[buyerIdx].replace(/^Te compró /i, "") + (lines[buyerIdx + 1] && /^[A-Z0-9._-]{3,}$/.test(lines[buyerIdx + 1]) ? ` (${lines[buyerIdx + 1]})` : "") : null;
    const qty = items.reduce((a, x) => a + x.qty, 0);
    return {
      ...base(m, at), kind: "venta", ml_id: id, title: clean(first), truncated: wasCut(first),
      extra_items: Math.max(0, items.length - 1), quantity: qty ? String(qty) : null,
      unit_price: items.length === 1 ? items[0].price : null,
      total_amount: money(/Cobraste \$\s?([\d.,]+)/.exec(text)?.[1]),
      counterpart: buyer,
      shipping: /Vendiste con (Mercado Envíos Flex|Mercado Envíos|entrega a acordar)/i.exec(text)?.[1] ?? (/Flex/.test(subject) ? "Mercado Envíos Flex" : /Coordiná/.test(subject) ? "entrega a acordar" : null),
    };
  }
  return null;
}
