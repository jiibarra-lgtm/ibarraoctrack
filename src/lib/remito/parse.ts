import { parseArNumber } from "@/lib/money";
import { parseArDate } from "@/lib/format";

/**
 * Lectura de remitos / constancias de entrega (texto de PDF u OCR de foto).
 * Sólo sugiere: orden, renglones y cantidades. Nada se registra sin confirmación.
 * Detectar un bloque de firma NO valida su autenticidad.
 */
export type RemitoLine = { purchase_order_item_id: string; line_number: number; quantity: string; source: string; confidence: "alta" | "media" };
export type RemitoReading = {
  remito_number: string;
  date: string;
  oc_numbers: string[];
  signature_block: boolean;
  lines: RemitoLine[];
};

type PoItem = { id: string; line_number: number; bac_code: string | null; description_original: string; quantity: string | number };

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const words = (s: string) => new Set(fold(s).split(/[^a-z0-9]+/).filter((w) => w.length >= 4));

export function readRemitoHeader(raw: string): Omit<RemitoReading, "lines"> {
  const text = raw.replace(/\r/g, "");
  const flat = text.replace(/\s+/g, " ");
  const rn = /Remito\s*(?:N[°º]|Nro\.?|N\.)?\s*:?\s*([A-Z]?\s?\d{4,5}\s*-\s*\d{6,8}|\d{6,12})/i.exec(flat) ?? /\b(\d{4,5}-\d{8})\b/.exec(flat);
  const date = /Fecha:?\s*(\d{1,2}\/\d{1,2}\/\d{4})/i.exec(flat) ?? /\b(\d{1,2}\/\d{1,2}\/\d{4})\b/.exec(flat);
  const ocs = [...flat.matchAll(/\b(\d{2,4})-(\d{3,7})-[O0o]C(\d{2})\b/g)].map((m) => `${m[1]}-${m[2]}-OC${m[3]}`);
  return {
    remito_number: rn ? rn[1].replace(/\s+/g, "") : "",
    date: date ? parseArDate(date[1]) ?? "" : "",
    oc_numbers: [...new Set(ocs)],
    signature_block: /firma|recib[ií]\s+conforme|aclaraci[oó]n|sello/i.test(flat),
  };
}

/** Empareja líneas del remito con renglones de la orden: por código de catálogo o por descripción. */
export function matchRemitoLines(raw: string, items: PoItem[]): RemitoLine[] {
  const out: RemitoLine[] = [];
  const used = new Set<string>();
  const lines = raw.replace(/\r/g, "").split("\n").map((l) => l.trim()).filter(Boolean);
  for (const line of lines) {
    if (/^(fecha|remito|cuit|domicilio|firma|aclaraci)/i.test(line)) continue;
    const lw = words(line);
    let best: PoItem | null = null, conf: RemitoLine["confidence"] = "media", score = 0;
    for (const it of items) {
      if (used.has(it.id)) continue;
      if (it.bac_code && line.includes(it.bac_code)) { best = it; conf = "alta"; score = 1; break; }
      const iw = words(it.description_original.slice(0, 120));
      const inter = [...lw].filter((w) => iw.has(w)).length;
      const s = inter / Math.max(3, Math.min(lw.size, 8));
      if (inter >= 2 && s > score) { best = it; score = s; }
    }
    if (!best || score < 0.4) continue;
    // Cantidad: primer número de la línea que no forme parte del código de catálogo
    const cleaned = best.bac_code ? line.replace(best.bac_code, " ") : line;
    const qm = /(?<![\d.,])(\d{1,6}(?:[.,]\d{1,2})?)(?![\d.,]*\d*\s*(?:g\/l|mts?|lts?|cm|mm|kg|grs?|ml)\b)/i.exec(cleaned);
    const q = qm ? parseArNumber(qm[1]) : null;
    if (!q || Number(q) <= 0) continue;
    used.add(best.id);
    out.push({ purchase_order_item_id: best.id, line_number: best.line_number, quantity: q, source: line.slice(0, 160), confidence: conf });
  }
  return out;
}
