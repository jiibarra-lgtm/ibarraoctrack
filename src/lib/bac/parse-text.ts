import { parseArNumber } from "@/lib/money";
import { parseArDate } from "@/lib/format";
import { emptyItem, emptyPurchaseOrder, statusFromBac, type PurchaseOrderInput } from "@/lib/po/schema";
import type { ExtractedOrder } from "./types";

/**
 * Parser determinístico para el texto de "Ver documento contractual" de
 * Buenos Aires Compras (BAC), exportado como PDF con capa de texto.
 *
 * Se basa en patrones propios de BAC (número de OC, procedimiento,
 * expediente, códigos de catálogo) para no depender del orden en que el
 * PDF entregue las columnas. Lo que no reconoce con certeza queda vacío
 * y marcado para revisión: nunca inventa datos.
 */

const SECTION_MARKERS = [
  "Datos de la Orden de compra",
  "Datos del proceso de compra",
  "Datos comprador",
  "Datos adjudicatario",
  "Detalle del documento contractual",
  "Total documento contractual",
  "Detalle de entrega",
  "Autorizadores",
] as const;
type Section = (typeof SECTION_MARKERS)[number];

const RE = {
  ocNumber: /\b\d{2,4}-\d{3,7}-OC\d{2}\b/i,
  procNumber: /\b\d{2,4}-\d{3,5}-(?!OC)[A-Z]{2,5}\d{2}\b/,
  expediente: /\bEX-\d{4}-\d{5,10}[\s-]*-?\s*[A-Z]{2,}(?:-[A-Z]{2,})+/,
  awardAct: /\b(?:RS|DI|RESOL|DISFC|IF)-\d{4}-\d{5,10}[\s-]*-?\s*[A-Z]{2,}(?:-[A-Z]{2,})*/,
  cuit: /\b\d{2}-\d{8}-\d\b/,
  date: /\b\d{1,2}\/\d{1,2}\/\d{4}\b/g,
  catalog: /\b\d{2}\.\d{2}\.\d{3}\.\d{4}\.\d{1,3}\b/g,
  money: /ARS\s*\$?\s*(\d[\d.]*(?:,\d{1,4})?)/g,
  qty: /(?<![\d.,])(\d{1,3}(?:\.\d{3})*,\d{2,4}|\d+,\d{2,4})(?![\d])/,
};

function clean(s: string): string {
  return s.replace(/ /g, " ").replace(/[ \t]+/g, " ").replace(/\r/g, "").trim();
}

function splitSections(text: string): Partial<Record<Section, string>> {
  const out: Partial<Record<Section, string>> = {};
  const positions = SECTION_MARKERS.map((m) => ({ m, i: text.toLowerCase().indexOf(m.toLowerCase()) }))
    .filter((p) => p.i >= 0)
    .sort((a, b) => a.i - b.i);
  positions.forEach((p, idx) => {
    const end = idx + 1 < positions.length ? positions[idx + 1].i : text.length;
    out[p.m] = text.slice(p.i + p.m.length, end);
  });
  return out;
}

/** Valor que sigue a una etiqueta en la misma "celda" (hasta la próxima etiqueta "Xxx:"). */
function valueAfter(section: string | undefined, label: string): string {
  if (!section) return "";
  const idx = section.toLowerCase().indexOf(label.toLowerCase());
  if (idx < 0) return "";
  const rest = section.slice(idx + label.length).replace(/^\s*:?\s*/, "");
  // Si inmediatamente sigue otra etiqueta, el PDF puso etiquetas y valores en filas separadas: no adivinamos.
  if (/^[A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚÑáéíóúñ. ]{1,40}:/.test(rest)) return "";
  const stop = rest.search(/\s(?:[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:\s[a-záéíóúñA-ZÁÉÍÓÚÑ.]+){0,4}):\s/);
  const line = rest.split("\n")[0];
  const value = stop >= 0 && stop < line.length ? rest.slice(0, stop) : line;
  return clean(value);
}

function firstMatch(re: RegExp, s: string | undefined): string {
  if (!s) return "";
  const m = s.match(re);
  return m ? clean(m[0]) : "";
}

function normalizeHyphens(s: string) {
  return s.replace(/\s+-\s*-/g, "- -").replace(/\s{2,}/g, " ").trim();
}

const MODALIDADES = [
  "Convenio Marco", "Licitación Pública", "Licitación Privada", "Contratación Directa", "Contratación Menor",
  "Compra Menor", "Concurso Público", "Subasta Inversa", "Licitación Pública Internacional",
];

export function parseBacText(raw: string): ExtractedOrder {
  const text = clean(raw.replace(/\r\n/g, "\n"));
  const flat = text.replace(/\n+/g, " ");
  const S = splitSections(text);
  const review: string[] = [];
  const warnings: ExtractedOrder["warnings"] = [];
  const o: PurchaseOrderInput = { ...emptyPurchaseOrder(), items: [] };

  // ---- Orden de compra
  const ordenSec = S["Datos de la Orden de compra"] ?? flat;
  o.bac_number = firstMatch(RE.ocNumber, ordenSec) || firstMatch(RE.ocNumber, flat);
  const yy = /OC(\d{2})$/i.exec(o.bac_number ?? "");
  o.fiscal_year = yy ? `20${yy[1]}` : "";
  o.bac_type = firstMatch(/\b(Original|Ampliaci[oó]n|Pr[oó]rroga|Disminuci[oó]n|Modificaci[oó]n)\b/i, ordenSec);
  o.bac_status = firstMatch(/\b(Perfeccionad[oa]|Autorizad[oa]|Anulad[oa]|Rescindid[oa]|Finalizad[oa]|Notificad[oa])\b/i, ordenSec);
  o.contract_duration = valueAfter(ordenSec, "Duración del contrato");
  const ordenDates = (ordenSec.match(RE.date) ?? []).map((d) => parseArDate(d)).filter(Boolean) as string[];
  o.issue_date = ordenDates[0] ?? "";
  if (/perfeccionamiento/i.test(ordenSec)) o.perfected_date = ordenDates[1] ?? "";
  o.status = statusFromBac(o.bac_status);

  // ---- Proceso de compra
  const procSec = S["Datos del proceso de compra"] ?? flat;
  o.expediente_number = normalizeHyphens(firstMatch(RE.expediente, procSec) || firstMatch(RE.expediente, flat));
  o.process_number = firstMatch(RE.procNumber, procSec) || firstMatch(RE.procNumber, flat.replace(o.bac_number ?? "", ""));
  o.award_act_number = normalizeHyphens(firstMatch(RE.awardAct, procSec));
  o.process_type = firstMatch(/\b(Bienes|Servicios|Obras)\b/, procSec);
  o.modality = MODALIDADES.find((m) => procSec.toLowerCase().includes(m.toLowerCase())) ?? "";
  const ley = /Ley\s+N[°º]\s*[\d.]+[^\n]*/i.exec(procSec);
  o.legal_framework = ley ? clean(ley[0]).replace(/\s*Número acto.*$/i, "") : "";
  o.process_class = valueAfter(procSec, "Clase");

  // ---- Comprador
  const compSec = S["Datos comprador"] ?? "";
  const units = [...compSec.matchAll(/\b(\d{2,4})\s-\s([A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ0-9.,'()° ]{2,80}?)(?=\s{1,}(?:Tel[eé]fono|Direcci[oó]n|Observaciones|Unidad|Jurisdicci[oó]n|\d{2,4}\s-\s)|\n|$)/g)];
  if (units[0]) o.jurisdiction = clean(`${units[0][1]} - ${units[0][2]}`);
  if (units[1]) o.dependencia = clean(`${units[1][1]} - ${units[1][2]}`);
  o.customer_name = o.dependencia || o.jurisdiction || "";
  o.buyer_phone = valueAfter(compSec, "Teléfono");
  o.buyer_address = valueAfter(compSec, "Dirección");
  const obs = /Observaciones:?\s*([\s\S]+)$/i.exec(compSec);
  o.buyer_notes = obs && !/^[A-ZÁÉÍÓÚÑ][a-z]+:/.test(obs[1].trim()) ? clean(obs[1].replace(/\n/g, " ")) : "";

  // ---- Adjudicatario
  const adjSec = S["Datos adjudicatario"] ?? "";
  o.awardee_cuit = firstMatch(RE.cuit, adjSec);
  o.awardee_name = valueAfter(adjSec, "Razón social");
  o.awardee_entity_number = valueAfter(adjSec, "Número ente").replace(/\D/g, "");

  // ---- Totales
  const totSec = S["Total documento contractual"] ?? "";
  const totalOf = (label: string) => {
    const m = new RegExp(`${label}\\s*:?\\s*(?:ARS)?\\s*\\$?\\s*(\\d[\\d.]*(?:,\\d{1,4})?)`, "i").exec(totSec);
    return m ? parseArNumber(m[1]) ?? "" : "";
  };
  o.total_amount = totalOf("Importe total");
  o.discount_amount = totalOf("Importe bonificado");
  o.net_amount = totalOf("Importe neto");
  o.currency = /USD|U\$S/.test(totSec) ? "USD" : "ARS";

  // ---- Renglones
  const detSec = S["Detalle del documento contractual"] ?? "";
  const codes = [...detSec.matchAll(RE.catalog)];
  codes.forEach((m, idx) => {
    const start = m.index ?? 0;
    const end = idx + 1 < codes.length ? (codes[idx + 1].index ?? detSec.length) : detSec.length;
    const before = detSec.slice(Math.max(0, start - 30), start);
    const lo = /(\d{1,4})\s+(\d{1,3})\s*$/.exec(before);
    let seg = detSec.slice(start + m[0].length, end);
    // Cortar el prefijo "renglón opción" del próximo ítem
    seg = seg.replace(/\s\d{1,4}\s+\d{1,3}\s*$/, "");

    const it = emptyItem(lo ? Number(lo[1]) : idx + 1);
    it.option_number = lo ? Number(lo[2]) : 1;
    it.bac_code = m[0];

    const amounts = [...seg.matchAll(RE.money)].map((a) => ({ raw: a[0], value: parseArNumber(a[1]) }));
    const q = RE.qty.exec(seg);
    it.quantity = q ? parseArNumber(q[1]) ?? "" : "";
    if (q) {
      const afterQty = seg.slice((q.index ?? 0) + q[0].length);
      const unit = /^\s*([A-ZÁÉÍÓÚÑ]{2,}(?:\s(?:X|DE)\s[\w.]+)?)/.exec(afterQty);
      it.unit = unit ? unit[1] : "";
    }
    it.unit_price = amounts[0]?.value ?? "";
    it.total_amount = amounts[1]?.value ?? "";

    let desc = seg;
    if (q) desc = desc.replace(q[0], " ");
    if (it.unit) desc = desc.replace(new RegExp(`\\b${it.unit}\\b`), " ");
    amounts.forEach((a) => (desc = desc.replace(a.raw, " ")));
    desc = desc.replace(/Ver Detalle|Ver más/gi, " ").replace(/\s+/g, " ").trim();
    it.description_original = desc;

    const i = o.items!.length;
    if (!it.quantity) review.push(`items.${i}.quantity`);
    if (!it.unit_price) review.push(`items.${i}.unit_price`);
    if (!it.total_amount) review.push(`items.${i}.total_amount`);
    if (!it.description_original) review.push(`items.${i}.description_original`);
    o.items!.push(it);
  });

  // ---- Detalle de entrega (por renglón)
  const entSec = S["Detalle de entrega"] ?? "";
  if (entSec && o.items!.length) {
    const ecodes = [...entSec.matchAll(RE.catalog)];
    ecodes.forEach((m, idx) => {
      const seg = entSec.slice((m.index ?? 0) + m[0].length, idx + 1 < ecodes.length ? ecodes[idx + 1].index : entSec.length);
      const target = o.items!.find((it) => it.bac_code === m[0]) ?? o.items![idx];
      if (!target) return;
      const plazo = /Durante\s+l[oa]s?\s+\d+[\s\S]{0,60}?(?:h[áa]biles|corridos)/i.exec(seg);
      if (plazo) target.delivery_term = clean(plazo[0].replace(/\n/g, " "));
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
  const autSec = S["Autorizadores"] ?? "";
  for (const a of autSec.matchAll(/([A-ZÁÉÍÓÚÑ]{2,}(?:\s[A-ZÁÉÍÓÚÑ]{2,})+)\s+([A-ZÁÉÍÓÚÑa-záéíóúñ][\wáéíóúñÁÉÍÓÚÑ ]*?)\s+(\d{1,2}\/\d{1,2}\/\d{4})/g)) {
    if (/NOMBRE AUTORIDAD/i.test(a[1])) continue;
    o.authorizers!.push({ nombre: clean(a[1]), cargo: clean(a[2]), fecha: parseArDate(a[3]) ?? "" });
  }

  // ---- Campos clave faltantes → revisión
  const key: (keyof PurchaseOrderInput)[] = [
    "bac_number", "process_number", "expediente_number", "customer_name", "issue_date", "awardee_cuit", "total_amount",
  ];
  key.forEach((k) => {
    if (!o[k]) review.push(String(k));
  });
  if (!o.items!.length) {
    warnings.push({ level: "error", path: "items", message: "No se encontraron renglones en el documento." });
    o.items = [emptyItem(1)];
    review.push("items");
  }

  return { order: o, review, warnings };
}
