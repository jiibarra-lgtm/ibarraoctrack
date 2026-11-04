import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import sharp from "sharp";
import { env } from "@/lib/env";
import { parseArNumber } from "@/lib/money";
import { emptyItem, emptyPurchaseOrder, statusFromBac, type PurchaseOrderInput } from "@/lib/po/schema";
import type { ExtractedOrder } from "./types";

/**
 * Extracción asistida por IA para capturas de pantalla, escaneos o PDFs sin capa de texto
 * de "Ver documento contractual" (BAC). La IA sólo transcribe: lo ilegible vuelve como null
 * y se marca para revisión. El resultado nunca se guarda sin confirmación humana.
 */

const S = { type: ["string", "null"] } as const;

const TOOL: Anthropic.Tool = {
  name: "registrar_orden_bac",
  description: "Registra los datos transcriptos de una orden de compra BAC. Usar null para todo dato no visible o ilegible.",
  input_schema: {
    type: "object",
    properties: {
      numero_orden: S, tipo: S, ejercicio: S, fecha_autorizacion: { ...S, description: "DD/MM/AAAA" },
      fecha_perfeccionamiento: S, estado: S, duracion_contrato: S,
      numero_expediente: { ...S, description: "Tal cual aparece, ej. EX-2023-07838510- -GCABA-DGCYC" },
      numero_procedimiento: S, tipo_proceso: S, modalidad: S, clase: S, encuadre_legal: S, acto_adjudicacion: S,
      jurisdiccion_solicitante: S, unidad_ejecutora: S, telefono_comprador: S, direccion_comprador: S, observaciones_comprador: S,
      razon_social_adjudicatario: S, numero_ente: S, cuit_adjudicatario: S,
      importe_total: { ...S, description: "Tal cual aparece, ej. ARS $132.225,00" }, importe_bonificado: S, importe_neto: S, moneda: S,
      renglones: {
        type: "array",
        items: {
          type: "object",
          properties: {
            renglon: { type: ["integer", "null"] }, opcion: { type: ["integer", "null"] }, codigo_catalogo: S,
            descripcion: { ...S, description: "Descripción completa visible, sin resumir" },
            cantidad: S, unidad_medida: S, empaquetamiento: S, precio_unitario: S, total: S,
            entrega_direccion: S, entrega_telefono: S, entrega_plazo: S, entrega_observaciones: S,
          },
          required: ["renglon", "codigo_catalogo", "descripcion", "cantidad", "precio_unitario", "total"],
        },
      },
      autorizadores: {
        type: "array",
        items: { type: "object", properties: { nombre: S, cargo: S, fecha: S }, required: ["nombre"] },
      },
      campos_dudosos: {
        type: "array", items: { type: "string" },
        description: "Nombres de campos cuya lectura no es segura (texto borroso, cortado o ambiguo).",
      },
    },
    required: ["numero_orden", "renglones", "campos_dudosos"],
  },
};

const PROMPT = `Sos un transcriptor de documentos de compras públicas del GCBA (Buenos Aires Compras).
La imagen o PDF es la pantalla "Ver documento contractual" de una orden de compra, con las secciones:
Datos de la Orden de compra, Datos del proceso de compra, Datos comprador, Datos adjudicatario,
Detalle del documento contractual (renglones), Total documento contractual, Detalle de entrega y Autorizadores.

Reglas estrictas:
- Transcribí exactamente lo que se ve. No calcules, no completes, no corrijas, no deduzcas.
- Importes y cantidades: copiá el texto tal cual (ej. "ARS 8815,00", "15,00").
- Si un dato no aparece o no se lee con certeza, devolvé null y agregalo a campos_dudosos.
- Si una descripción está cortada en la imagen, transcribí sólo lo visible.
- Las imágenes pueden ser partes consecutivas de una misma captura larga: unificalas en un solo resultado sin duplicar renglones.
Respondé únicamente llamando a la herramienta registrar_orden_bac.`;

type AiPayload = Record<string, unknown> & {
  renglones?: Record<string, unknown>[];
  autorizadores?: Record<string, unknown>[];
  campos_dudosos?: string[];
};

const MAX_TILE_HEIGHT = 1100;
const OVERLAP = 120;

/** Parte capturas largas en tiles legibles (el modelo reduce imágenes grandes y el texto quedaría ilegible). */
export async function imageToTiles(buf: Buffer): Promise<{ data: string; media_type: "image/png" }[]> {
  const img = sharp(buf, { failOn: "none" }).rotate();
  const meta = await img.metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  if (!width || !height) throw new Error("No se pudo leer la imagen");

  // Normalizar ancho a ≥1000px para que el texto chico sea legible
  const scale = width < 1000 ? 1000 / width : width > 1600 ? 1600 / width : 1;
  const W = Math.round(width * scale);
  const H = Math.round(height * scale);
  const base = await sharp(buf, { failOn: "none" }).rotate().resize(W, H).png().toBuffer();

  const tiles: { data: string; media_type: "image/png" }[] = [];
  for (let top = 0; top < H; top += MAX_TILE_HEIGHT - OVERLAP) {
    const h = Math.min(MAX_TILE_HEIGHT, H - top);
    const tile = await sharp(base).extract({ left: 0, top, width: W, height: h }).png().toBuffer();
    tiles.push({ data: tile.toString("base64"), media_type: "image/png" });
    if (top + h >= H) break;
    if (tiles.length >= 12) break; // límite defensivo
  }
  return tiles;
}

export function aiAvailable() {
  return Boolean(env.anthropicKey);
}

export async function extractWithAi(file: { buffer: Buffer; mimeType: string }): Promise<{ result: ExtractedOrder; raw: AiPayload }> {
  if (!env.anthropicKey) throw new Error("IA no configurada");
  const client = new Anthropic({ apiKey: env.anthropicKey, maxRetries: 2, timeout: 240_000 });

  const content: Anthropic.ContentBlockParam[] = [];
  if (file.mimeType === "application/pdf") {
    content.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: file.buffer.toString("base64") } });
  } else {
    const tiles = await imageToTiles(file.buffer);
    tiles.forEach((t, i) => {
      content.push({ type: "text", text: `Parte ${i + 1} de ${tiles.length}` });
      content.push({ type: "image", source: { type: "base64", media_type: t.media_type, data: t.data } });
    });
  }
  content.push({ type: "text", text: "Transcribí la orden de compra." });

  const msg = await client.messages.create({
    model: env.anthropicModel,
    max_tokens: 8000,
    system: PROMPT,
    tools: [TOOL],
    tool_choice: { type: "tool", name: TOOL.name },
    messages: [{ role: "user", content }],
  });

  const block = msg.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
  if (!block) throw new Error("La IA no devolvió datos estructurados");
  const raw = block.input as AiPayload;
  return { result: mapAiPayload(raw), raw };
}

const str = (v: unknown) => (typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim());
const date = (v: unknown) => {
  const m = /(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(str(v));
  return m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : "";
};
const num = (v: unknown) => parseArNumber(str(v)) ?? "";

/** Convierte la transcripción de la IA al formato de orden, marcando dudas y faltantes. */
export function mapAiPayload(p: AiPayload): ExtractedOrder {
  const review = new Set<string>();
  const o: PurchaseOrderInput = { ...emptyPurchaseOrder(), items: [] };

  const fieldMap: Record<string, keyof PurchaseOrderInput> = {
    numero_orden: "bac_number", tipo: "bac_type", estado: "bac_status", duracion_contrato: "contract_duration",
    numero_expediente: "expediente_number", numero_procedimiento: "process_number", tipo_proceso: "process_type",
    modalidad: "modality", clase: "process_class", encuadre_legal: "legal_framework", acto_adjudicacion: "award_act_number",
    jurisdiccion_solicitante: "jurisdiction", unidad_ejecutora: "dependencia", telefono_comprador: "buyer_phone",
    direccion_comprador: "buyer_address", observaciones_comprador: "buyer_notes", razon_social_adjudicatario: "awardee_name",
    numero_ente: "awardee_entity_number", cuit_adjudicatario: "awardee_cuit",
  };
  for (const [k, target] of Object.entries(fieldMap)) {
    (o as Record<string, unknown>)[target] = str(p[k]);
  }
  o.fiscal_year = /^\d{4}$/.test(str(p.ejercicio)) ? str(p.ejercicio) : "";
  o.issue_date = date(p.fecha_autorizacion);
  o.perfected_date = date(p.fecha_perfeccionamiento);
  o.total_amount = num(p.importe_total);
  o.discount_amount = num(p.importe_bonificado);
  o.net_amount = num(p.importe_neto);
  o.currency = /USD|U\$S/i.test(str(p.moneda) + str(p.importe_total)) ? "USD" : "ARS";
  o.customer_name = o.dependencia || o.jurisdiction || "";
  o.status = statusFromBac(o.bac_status);
  if (o.awardee_cuit && !/^\d{2}-?\d{8}-?\d$/.test(o.awardee_cuit)) {
    review.add("awardee_cuit");
  }

  (p.renglones ?? []).forEach((r, i) => {
    const it = emptyItem(Number(r.renglon) || i + 1);
    it.option_number = Number(r.opcion) || 1;
    it.bac_code = str(r.codigo_catalogo);
    it.description_original = str(r.descripcion);
    it.quantity = num(r.cantidad);
    it.unit = str(r.unidad_medida);
    it.packaging = str(r.empaquetamiento);
    it.unit_price = num(r.precio_unitario);
    it.total_amount = num(r.total);
    it.delivery_address = str(r.entrega_direccion);
    it.delivery_phone = str(r.entrega_telefono);
    it.delivery_term = str(r.entrega_plazo);
    it.delivery_notes = str(r.entrega_observaciones);
    (["quantity", "unit_price", "total_amount", "description_original"] as const).forEach((f) => {
      if (!it[f]) review.add(`items.${i}.${f}`);
    });
    o.items!.push(it);
  });
  if (o.items!.length && o.items![0].delivery_term) {
    o.delivery_term_text = o.items![0].delivery_term;
    const d = /(\d+)/.exec(o.items![0].delivery_term ?? "");
    o.delivery_term_days = d ? d[1] : "";
  }
  o.authorizers = (p.autorizadores ?? [])
    .map((a) => ({ nombre: str(a.nombre), cargo: str(a.cargo), fecha: date(a.fecha) }))
    .filter((a) => a.nombre);

  // Dudas declaradas por la IA → rutas de revisión
  const reverse: Record<string, string> = Object.fromEntries(Object.entries(fieldMap).map(([k, v]) => [k, String(v)]));
  Object.assign(reverse, {
    fecha_autorizacion: "issue_date", fecha_perfeccionamiento: "perfected_date", importe_total: "total_amount",
    importe_bonificado: "discount_amount", importe_neto: "net_amount", ejercicio: "fiscal_year",
  });
  (p.campos_dudosos ?? []).forEach((c) => {
    const key = reverse[c] ?? c;
    review.add(key);
  });

  (["bac_number", "process_number", "expediente_number", "customer_name", "issue_date", "awardee_cuit", "total_amount"] as const)
    .forEach((k) => { if (!o[k]) review.add(k); });

  const warnings: ExtractedOrder["warnings"] = [];
  if (!o.items!.length) {
    warnings.push({ level: "error", path: "items", message: "No se identificaron renglones." });
    o.items = [emptyItem(1)];
    review.add("items");
  }
  return { order: o, review: [...review], warnings };
}
