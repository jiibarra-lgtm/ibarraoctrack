import { parseArNumber, lineTotal, differs, isValidDecimal } from "@/lib/money";
import { parseArDate } from "@/lib/format";
import { emptyItem, emptyPurchaseOrder, statusFromBac, type PurchaseOrderInput } from "@/lib/po/schema";
import type { ExtractedOrder } from "./types";

/**
 * Parser determinístico para "Ver documento contractual" de Buenos Aires Compras (BAC).
 *
 * Acepta dos fuentes de texto:
 *  - PDF con capa de texto: etiqueta y valor apilados ("Tipo:\nOriginal").
 *  - OCR de una captura: etiquetas en una fila y valores en la siguiente, alineados por columna.
 *
 * Se apoya en patrones propios de BAC (número de OC, procedimiento, expediente, códigos de
 * catálogo) y tolera errores típicos de OCR (O/0, tildes, "Detaile"). Lo que no reconoce
 * con certeza queda vacío y marcado para revisión: nunca inventa datos.
 */

// ---------------------------------------------------------------------------
// Normalización (misma longitud que el original, para poder mapear índices)
// ---------------------------------------------------------------------------
const FOLD: Record<string, string> = {
  á: "a", é: "e", í: "i", ó: "o", ú: "u", ü: "u", ñ: "n", Á: "a", É: "e", Í: "i", Ó: "o", Ú: "u", Ü: "u", Ñ: "n",
};
function fold(s: string): string {
  let out = "";
  for (const ch of s) out += FOLD[ch] ?? ch.toLowerCase();
  return out.length === s.length ? out : s.toLowerCase(); // seguridad ante caracteres raros
}

const SECTIONS = [
  ["orden", /datos de la orden de compra/],
  ["proceso", /datos del proceso de compra/],
  ["comprador", /datos (del )?comprador/],
  ["adjudicatario", /datos (del )?adjudicatario/],
  ["detalle", /deta[il1|]{2}e del documento contractual/],
  ["totales", /total documento contractual/],
  ["entrega", /deta[il1|]{2}e de entrega/],
  ["autorizadores", /autorizadores/],
] as const;
type Section = (typeof SECTIONS)[number][0];

function splitSections(text: string): Partial<Record<Section, string>> {
  const f = fold(text);
  const found: { key: Section; start: number; end: number }[] = [];
  for (const [key, re] of SECTIONS) {
    const m = re.exec(f);
    if (m) found.push({ key, start: m.index, end: m.index + m[0].length });
  }
  found.sort((a, b) => a.start - b.start);
  const out: Partial<Record<Section, string>> = {};
  found.forEach((s, i) => {
    out[s.key] = text.slice(s.end, i + 1 < found.length ? found[i + 1].start : text.length);
  });
  return out;
}

const RE = {
  ocNumber: /\b(\d{2,4})-(\d{3,7})-[O0o]C(\d{2})\b/,
  procNumber: /\b\d{2,4}-\d{3,5}-(?![O0]C)[A-Z]{2,5}\d{2}\b/,
  expediente: /\bEX-\d{4}-\d{5,10}[\s-]*-?\s*[A-Z]{2,}(?:-[A-Z]{2,})+/,
  awardAct: /\b(?:RS|DI|RESOL|DISFC|IF)-\d{4}-\d{5,10}[\s-]*-?\s*[A-Z]{2,}(?:-[A-Z]{2,})*/,
  cuit: /\b\d{2}-\d{8}-\d\b/,
  date: /\b\d{1,2}\/\d{1,2}\/\d{4}\b/g,
  catalog: /\b\d{2}\.\d{2}\.\d{3}\.\d{4}\.\d{1,3}\b/g,
  decimal: /(?<![\d.,])(?:\d{1,3}(?:\.\d{3})+|\d+)[.,]\d{2}(?!\d)/g,
};

function clean(s: string): string {
  return s.replace(/ /g, " ").replace(/[ \t]+/g, " ").replace(/\r/g, "").trim();
}

// ---------------------------------------------------------------------------
// Pares etiqueta → valor
// ---------------------------------------------------------------------------
const LABEL_SEG = /^[A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚÑáéíóúñ°º. ]{1,60}:?$/;

/** Formato apilado (PDF): "Etiqueta:\nValor" o "Etiqueta: Valor". */
function stackedValue(section: string, label: string): string {
  const f = fold(section);
  const idx = f.indexOf(fold(label));
  if (idx < 0) return "";
  const rest = section.slice(idx + label.length).replace(/^\s*:?[ \t]*/, "");
  const line = rest.split("\n").map((l) => l.trim()).find((l) => l.length > 0) ?? "";
  // Si lo que sigue es otra etiqueta, no es un valor
  if (/^[A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚÑáéíóúñ. ]{1,40}:/.test(line)) return "";
  // Si en la línea siguiente hay varias columnas, no es formato apilado
  if (/\S\s{3,}\S/.test(line)) return "";
  return clean(line);
}

/** Formato por filas (OCR): una línea de etiquetas y debajo la de valores, alineadas por columna. */
function rowPairs(section: string): Map<string, string> {
  const map = new Map<string, string>();
  const lines = section.split("\n");
  const segs = (line: string) => {
    const out: { text: string; col: number }[] = [];
    const re = /\S+(?: \S+)*/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(line))) out.push({ text: m[0], col: m.index });
    return out;
  };
  for (let i = 0; i < lines.length; i++) {
    const labels = segs(lines[i]).filter((s) => s.text.endsWith(":") || LABEL_SEG.test(s.text));
    if (!labels.length || !labels.some((l) => l.text.endsWith(":"))) continue;
    if (labels.length !== segs(lines[i]).length) continue; // línea mixta: no es fila de etiquetas
    let j = i + 1;
    while (j < lines.length && !lines[j].trim()) j++;
    if (j >= lines.length) break;
    const values = segs(lines[j]);
    if (values.some((v) => v.text.endsWith(":") && LABEL_SEG.test(v.text))) continue;
    const lineLen = (segsArr: { text: string; col: number }[]) => {
      const last = segsArr[segsArr.length - 1];
      return Math.max(1, last.col + last.text.length);
    };
    const put = (label: string, value: string) => {
      const key = fold(label.replace(/:$/, "")).trim();
      map.set(key, map.has(key) ? `${map.get(key)} ${value}` : value);
    };
    if (values.length === labels.length) {
      // Misma cantidad de columnas: se emparejan en orden
      values.forEach((v, k) => put(labels[k].text, v.text));
    } else {
      // Columnas vacías: se asigna por posición relativa en la línea (el OCR no conserva espacios exactos)
      const lw = lineLen(labels), vw = Math.max(lineLen(values), lw * 0.6);
      const used = new Set<number>();
      values.forEach((v) => {
        let best = 0, dist = Infinity;
        labels.forEach((l, k) => {
          const d = Math.abs(l.col / lw - v.col / vw);
          if (d < dist && !used.has(k)) { dist = d; best = k; }
        });
        used.add(best);
        put(labels[best].text, v.text);
      });
    }
  }
  return map;
}

function field(section: string | undefined, pairs: Map<string, string>, ...labels: string[]): string {
  if (!section) return "";
  for (const l of labels) {
    const v = stackedValue(section, l);
    if (v) return v;
  }
  for (const l of labels) {
    const v = pairs.get(fold(l));
    if (v) return clean(v);
  }
  return "";
}

function firstMatch(re: RegExp, s: string | undefined): string {
  if (!s) return "";
  const m = s.match(re);
  return m ? clean(m[0]) : "";
}

const normalizeHyphens = (s: string) => s.replace(/\s+-\s*-/g, "- -").replace(/\s{2,}/g, " ").trim();

const MODALIDADES = [
  "Convenio Marco", "Licitación Pública", "Licitación Privada", "Contratación Directa", "Contratación Menor",
  "Compra Menor", "Concurso Público", "Subasta Inversa",
];

/** Dígito verificador de CUIT/CUIL. */
export function validCuit(cuit: string): boolean {
  const d = cuit.replace(/\D/g, "");
  if (d.length !== 11) return false;
  const w = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const s = w.reduce((acc, x, i) => acc + x * Number(d[i]), 0);
  let v = 11 - (s % 11);
  if (v === 11) v = 0;
  if (v === 10) v = 9;
  return v === Number(d[10]);
}

// ---------------------------------------------------------------------------
export function parseBacText(raw: string): ExtractedOrder {
  const text = raw.replace(/\r\n/g, "\n").replace(/ /g, " ");
  const flat = clean(text.replace(/\n+/g, " "));
  const S = splitSections(text);
  const review: string[] = [];
  const warnings: ExtractedOrder["warnings"] = [];
  const o: PurchaseOrderInput = { ...emptyPurchaseOrder(), items: [] };
  const P = Object.fromEntries((Object.keys(S) as Section[]).map((k) => [k, rowPairs(S[k] ?? "")])) as Record<Section, Map<string, string>>;
  const pairsOf = (k: Section) => P[k] ?? new Map<string, string>();

  // ---- Orden de compra
  const ordenSec = S.orden ?? text;
  const oc = RE.ocNumber.exec(ordenSec) ?? RE.ocNumber.exec(text);
  o.bac_number = oc ? `${oc[1]}-${oc[2]}-OC${oc[3]}` : "";
  o.fiscal_year = oc ? `20${oc[3]}` : "";
  o.bac_type = firstMatch(/\b(Original|Ampliaci[oó]n|Pr[oó]rroga|Disminuci[oó]n|Modificaci[oó]n)\b/i, ordenSec);
  o.bac_status = firstMatch(/\b(Perfeccionad[oa]|Autorizad[oa]|Anulad[oa]|Rescindid[oa]|Finalizad[oa]|Notificad[oa])\b/i, ordenSec);
  o.contract_duration = field(ordenSec, pairsOf("orden"), "Duración del contrato");
  const ordenDates = (ordenSec.match(RE.date) ?? []).map((d) => parseArDate(d)).filter(Boolean) as string[];
  o.issue_date = ordenDates[0] ?? "";
  if (/perfeccionamiento/i.test(ordenSec)) o.perfected_date = ordenDates[1] ?? "";
  o.status = statusFromBac(o.bac_status);

  // ---- Proceso de compra
  const procSec = S.proceso ?? text;
  o.expediente_number = normalizeHyphens(firstMatch(RE.expediente, procSec) || firstMatch(RE.expediente, flat));
  o.process_number = firstMatch(RE.procNumber, procSec) || firstMatch(RE.procNumber, flat);
  o.award_act_number = normalizeHyphens(firstMatch(RE.awardAct, procSec));
  o.process_type = firstMatch(/\b(Bienes|Servicios|Obras)\b/, procSec);
  o.modality = MODALIDADES.find((m) => fold(procSec).includes(fold(m))) ?? "";
  const ley = /Ley\s+N\S?\s*[\d.]+[^\n]*?(?=\s{3,}|\n|$)/i.exec(procSec);
  o.legal_framework = ley ? clean(ley[0]) : "";
  o.process_class = field(procSec, pairsOf("proceso"), "Clase");

  // ---- Comprador
  const compSec = S.comprador ?? "";
  const units = [...compSec.matchAll(/(?<![\d-])(\d{2,4})\s?-\s?([A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ0-9.,'()° ]*?[A-ZÁÉÍÓÚÑ.)])(?=\s{2,}|\n|$|\s(?:Tel[eé]fono|Direcci[oó]n|Observaciones|Unidad|Jurisdicci[oó]n))/g)];
  if (units[0]) o.jurisdiction = clean(`${units[0][1]} - ${units[0][2]}`);
  if (units[1]) o.dependencia = clean(`${units[1][1]} - ${units[1][2]}`);
  o.customer_name = o.dependencia || o.jurisdiction || "";
  o.buyer_phone = field(compSec, pairsOf("comprador"), "Teléfono");
  o.buyer_address = field(compSec, pairsOf("comprador"), "Dirección");
  o.buyer_notes = field(compSec, pairsOf("comprador"), "Observaciones");

  // ---- Adjudicatario
  const adjSec = S.adjudicatario ?? "";
  o.awardee_cuit = firstMatch(RE.cuit, adjSec);
  o.awardee_name = field(adjSec, pairsOf("adjudicatario"), "Razón social");
  o.awardee_entity_number = field(adjSec, pairsOf("adjudicatario"), "Número ente", "Numero ente").replace(/\D/g, "");

  // ---- Totales
  const totSec = S.totales ?? "";
  const totalOf = (label: string) => {
    const m = new RegExp(`${label}\\s*:?\\s*(?:ARS|USD)?\\s*\\$?\\s*(\\d[\\d.,]*\\d)`, "i").exec(totSec);
    return m ? parseArNumber(m[1]) ?? "" : "";
  };
  o.total_amount = totalOf("Importe total");
  o.discount_amount = totalOf("Importe bonificado");
  o.net_amount = totalOf("Importe neto");
  o.currency = /USD|U\$S/.test(totSec) ? "USD" : "ARS";

  // ---- Renglones
  const detSec = S.detalle ?? "";
  const codes = [...detSec.matchAll(RE.catalog)];
  codes.forEach((m, idx) => {
    const start = m.index ?? 0;
    const end = idx + 1 < codes.length ? (codes[idx + 1].index ?? detSec.length) : detSec.length;
    const before = detSec.slice(Math.max(0, start - 40), start);
    const lo = /(\d{1,4})\s+(\d{1,3})\s*$/.exec(before);
    let seg = detSec.slice(start + m[0].length, end);
    seg = seg.replace(/\s\d{1,4}\s+\d{1,3}\s*$/, "");

    const it = emptyItem(lo ? Number(lo[1]) : idx + 1);
    it.option_number = lo ? Number(lo[2]) : 1;
    it.bac_code = m[0];

    const nums = [...seg.matchAll(RE.decimal)].map((a) => ({ raw: a[0], at: a.index ?? 0, value: parseArNumber(a[0]) }));
    const qty = nums[0];
    it.quantity = qty?.value ?? "";
    let unitRaw = "";
    if (qty) {
      const u = /^\s*([A-ZÁÉÍÓÚÑ]{2,}(?:\s(?:X|DE)\s[\w.]+)?)/.exec(seg.slice(qty.at + qty.raw.length));
      unitRaw = u ? u[1] : "";
      it.unit = unitRaw;
    }
    const amounts = nums.slice(1);
    it.unit_price = amounts[0]?.value ?? "";
    // El total es el importe que coincide con cantidad × precio (puede estar en otra línea por el ajuste de columna)
    const expected = isValidDecimal(String(it.quantity)) && isValidDecimal(String(it.unit_price)) ? lineTotal(String(it.quantity), String(it.unit_price)) : null;
    const matchTotal = expected ? amounts.slice(1).find((a) => a.value && !differs(a.value, expected)) : undefined;
    it.total_amount = matchTotal?.value ?? amounts[1]?.value ?? "";

    let desc = seg;
    for (const n of [qty, ...amounts.slice(0, 2), matchTotal].filter(Boolean)) desc = desc.replace(n!.raw, " ");
    if (unitRaw) desc = desc.replace(new RegExp(`\\b${unitRaw}\\b`), " ");
    desc = desc
      .replace(/\bARS\b|\$|Ver Detalle|Ver m[aá]s|\bTo\b/gi, " ")
      .replace(/[|]/g, "I")
      .replace(/\s+/g, " ")
      .trim();
    it.description_original = desc;

    const i = o.items!.length;
    (["quantity", "unit_price", "total_amount", "description_original"] as const).forEach((f) => {
      if (!it[f]) review.push(`items.${i}.${f}`);
    });
    o.items!.push(it);
  });

  // ---- Detalle de entrega (sólo lo inequívoco)
  const entSec = S.entrega ?? "";
  if (entSec && o.items!.length) {
    const ecodes = [...entSec.matchAll(RE.catalog)];
    ecodes.forEach((m, idx) => {
      const seg = entSec.slice((m.index ?? 0) + m[0].length, idx + 1 < ecodes.length ? ecodes[idx + 1].index : entSec.length);
      const target = o.items!.find((it) => it.bac_code === m[0]) ?? o.items![idx];
      if (!target) return;
      const plazo = /Durante\s+l[oa]s?\s+\d+\s+a\s+partir\s+de\s+D[ií]as\s+(?:h[áa]biles|corridos)/i.exec(seg.replace(/\s+/g, " "));
      if (plazo) target.delivery_term = clean(plazo[0]);
      const ph = /(?<![\d.,])(\d{8,10})(?![\d.,])/.exec(seg);
      if (ph) target.delivery_phone = ph[1];
    });
    const first = o.items![0];
    if (first?.delivery_term) {
      o.delivery_term_text = first.delivery_term;
      const days = /(\d+)/.exec(first.delivery_term);
      o.delivery_term_days = days ? days[1] : "";
    }
  }

  // ---- Autorizadores
  const autSec = S.autorizadores ?? "";
  for (const a of autSec.matchAll(/([A-ZÁÉÍÓÚÑ]{2,}(?:\s[A-ZÁÉÍÓÚÑ]{2,})+)\s+([A-ZÁÉÍÓÚÑa-záéíóúñ][\wáéíóúñÁÉÍÓÚÑ ]*?)\s+(\d{1,2}\/\d{1,2}\/\d{4})/g)) {
    if (/NOMBRE AUTORIDAD/i.test(a[1])) continue;
    o.authorizers!.push({ nombre: clean(a[1]), cargo: clean(a[2]), fecha: parseArDate(a[3]) ?? "" });
  }

  // ---- Campos clave faltantes → revisión
  (["bac_number", "process_number", "customer_name", "issue_date", "total_amount"] as const).forEach((k) => {
    if (!o[k]) review.push(k);
  });
  if (o.awardee_cuit && !validCuit(o.awardee_cuit)) review.push("awardee_cuit");
  if (!o.items!.length) {
    warnings.push({ level: "error", path: "items", message: "No se encontraron renglones en el documento." });
    o.items = [emptyItem(1)];
    review.push("items");
  }

  return { order: o, review, warnings };
}
