/**
 * Separa el texto libre de una entrega ("8x12 acondicionador - 48x18 higiénico beige - 50 cajas de toalla blanca al 19/11")
 * en renglones con cantidad, presentación y producto.
 */
export type DeliveryLine = { qty: number | null; unit?: string | null; pack?: string | null; product: string; note?: string | null };

const UNITS = /^(cajas?|bultos?|bidones?|packs?|paquetes?|rollos?|unidades?|u\.?|litros?|lts?\.?|kg|kilos?|hojas?|hj|fardos?|resmas?|pares?)\b\s*(?:de\s+)?/i;
const PACK = /^(\d+(?:[.,]\d+)?)\s*x\s*(\d+(?:[.,]\d+)?\s*(?:lts?\.?|litros?|l|kg|gr?|ml|mts?|m|cm|u)?)\b\.?\s*(?:de\s+)?/i;
const DATE = /\s*(?:\bal\s+)?\b(\d{1,2}\/\d{1,2})\s*$/i;
const REST = /^(?:resta|restan)\s+/i;

const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const num = (s: string) => Number(s.replace(",", "."));
const normUnit = (u: string) => {
  const x = u.toLowerCase().replace(/\.$/, "");
  if (/^(lts?|litros?)$/.test(x)) return "litros";
  if (x === "hj") return "hojas";
  if (/^u$/.test(x)) return "unidades";
  return x;
};
const normPack = (p: string) => `x${p.replace(/\s+/g, " ").replace(/\b(lts?\.?|litros?)\b/i, "L").trim()}`;

export function parseDeliveryNote(text: string | null | undefined): DeliveryLine[] {
  const t = (text ?? "").replace(/\s+/g, " ").trim();
  if (!t) return [];
  const parts = t.split(/\s+[-–]\s+|\s*\.-\s*|\s*;\s*|\s*,\s+(?=\d)|\s+y\s+(?=\d)/).map((x) => x.trim()).filter(Boolean);
  const out: DeliveryLine[] = [];
  for (let p of parts) {
    const notes: string[] = [];
    if (REST.test(p)) { notes.push("restan"); p = p.replace(REST, ""); }
    const d = DATE.exec(p);
    if (d) { notes.push(`al ${d[1]}`); p = p.slice(0, d.index).trim(); }
    const line: DeliveryLine = { qty: null, product: p };
    const pk = PACK.exec(p);
    if (pk) {
      line.qty = num(pk[1]); line.pack = normPack(pk[2]); line.product = p.slice(pk[0].length);
    } else {
      const q = /^(\d+(?:[.,]\d+)?)\s*(?:x\s+)?/.exec(p);
      if (q) {
        line.qty = num(q[1]);
        let rest = p.slice(q[0].length);
        const u = UNITS.exec(rest);
        if (u && rest.length > u[0].length) { line.unit = normUnit(u[1]); rest = rest.slice(u[0].length); }
        line.product = rest;
      }
    }
    line.product = cap(line.product.replace(/^de\s+/i, "").trim()) || p;
    if (notes.length) line.note = notes.join(" · ");
    out.push(line);
  }
  return out.slice(0, 60);
}

/** "139 cajas" / "13 × 12" para mostrar. */
export function lineQty(l: DeliveryLine) {
  if (l.qty === null) return "";
  const n = l.qty.toLocaleString("es-AR");
  return [n, l.unit, l.pack].filter(Boolean).join(" ");
}
