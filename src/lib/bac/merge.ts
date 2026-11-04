import type { PurchaseOrderInput } from "@/lib/po/schema";
import type { ExtractedOrder } from "./types";

const CROSS_CHECK: (keyof PurchaseOrderInput)[] = [
  "bac_number", "process_number", "expediente_number", "issue_date", "perfected_date",
  "awardee_cuit", "total_amount", "net_amount", "discount_amount",
];

/**
 * Combina la lectura por texto (determinística) con la de IA.
 * - La IA es base cuando existe (entiende la maquetación).
 * - El texto completa vacíos de la IA.
 * - Si ambos leen distinto un campo clave o un importe de renglón, queda en revisión con aviso.
 */
export function mergeExtractions(text: ExtractedOrder | null, ai: ExtractedOrder | null): ExtractedOrder {
  if (!text && !ai) throw new Error("Sin extracciones");
  if (!ai) return text!;
  if (!text) return ai;

  const order: PurchaseOrderInput = { ...ai.order, items: [...(ai.order.items ?? [])] };
  const review = new Set([...ai.review]);
  const warnings = [...ai.warnings];

  for (const [k, v] of Object.entries(text.order)) {
    if (k === "items" || k === "authorizers") continue;
    const key = k as keyof PurchaseOrderInput;
    const aiVal = order[key];
    if ((aiVal === "" || aiVal === undefined || aiVal === null) && v !== "" && v != null) {
      (order as Record<string, unknown>)[key] = v;
      review.delete(key);
    }
  }
  if (!order.authorizers?.length && text.order.authorizers?.length) order.authorizers = text.order.authorizers;

  for (const key of CROSS_CHECK) {
    const a = String(ai.order[key] ?? "");
    const t = String(text.order[key] ?? "");
    if (a && t && a !== t) {
      review.add(key);
      warnings.push({ level: "warning", path: key, message: `Lecturas distintas para ${key}: texto "${t}" · IA "${a}". Verificá.` });
    } else if (a && t && a === t) {
      review.delete(key); // doble lectura coincidente
    }
  }

  // Renglones: emparejar por código + renglón
  const textItems = text.order.items ?? [];
  order.items = (order.items ?? []).map((it, i) => {
    const match = textItems.find((t) => t.bac_code === it.bac_code && Number(t.line_number) === Number(it.line_number));
    if (!match) return it;
    const merged = { ...it };
    (["quantity", "unit_price", "total_amount"] as const).forEach((f) => {
      const a = String(it[f] ?? "");
      const t = String(match[f] ?? "");
      if (!a && t) {
        merged[f] = t;
        review.delete(`items.${i}.${f}`);
      } else if (a && t && a !== t) {
        review.add(`items.${i}.${f}`);
        warnings.push({ level: "warning", path: `items.${i}.${f}`, message: `Renglón ${it.line_number}: texto "${t}" · IA "${a}" en ${f}.` });
      } else if (a && t) {
        review.delete(`items.${i}.${f}`);
      }
    });
    // La descripción del texto suele estar completa (la captura puede venir cortada)
    if ((match.description_original?.length ?? 0) > (it.description_original?.length ?? 0)) {
      merged.description_original = match.description_original;
    }
    return merged;
  });

  return { order, review: [...review], warnings: [...text.warnings.filter((w) => w.level === "info"), ...warnings] };
}
