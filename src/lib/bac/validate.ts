import { differs, isValidDecimal, lineTotal, sum, dec } from "@/lib/money";
import { formatMoney } from "@/lib/format";
import type { PurchaseOrderInput } from "@/lib/po/schema";
import type { ExtractionWarning } from "./types";

/**
 * Validaciones aritméticas y de completitud de una orden (extraída o cargada).
 * No corrige nada por su cuenta: informa para que el usuario decida.
 */
type MathInput = Partial<Omit<PurchaseOrderInput, "items">> & {
  items?: { line_number?: unknown; quantity?: unknown; unit_price?: unknown; total_amount?: unknown; [k: string]: unknown }[];
};

export function validateOrderMath(o: MathInput): { warnings: ExtractionWarning[]; review: string[] } {
  const warnings: ExtractionWarning[] = [];
  const review: string[] = [];
  const cur = o.currency || "ARS";
  const items = o.items ?? [];

  items.forEach((it, i) => {
    const q = String(it.quantity ?? "");
    const p = String(it.unit_price ?? "");
    const t = String(it.total_amount ?? "");
    if (!isValidDecimal(q) || !isValidDecimal(p) || !isValidDecimal(t)) return;
    const expected = lineTotal(q, p);
    if (differs(expected, t)) {
      warnings.push({
        level: "warning",
        path: `items.${i}.total_amount`,
        message: `Renglón ${it.line_number}: ${q} × ${formatMoney(p, cur)} = ${formatMoney(expected, cur)}, pero el total dice ${formatMoney(t, cur)}.`,
      });
      review.push(`items.${i}.total_amount`);
    }
  });

  const totals = items.map((it) => String(it.total_amount ?? "")).filter(isValidDecimal);
  if (totals.length === items.length && items.length > 0) {
    const itemsSum = sum(totals);
    const net = String(o.net_amount ?? "");
    const total = String(o.total_amount ?? "");
    const discount = String(o.discount_amount ?? "") || "0";

    if (isValidDecimal(total) && differs(itemsSum, total)) {
      warnings.push({
        level: "warning",
        path: "total_amount",
        message: `La suma de renglones (${formatMoney(itemsSum, cur)}) no coincide con el importe total (${formatMoney(total, cur)}).`,
      });
      review.push("total_amount");
    }
    if (isValidDecimal(total) && isValidDecimal(net) && isValidDecimal(discount)) {
      const expectedNet = dec(total).minus(dec(discount)).toFixed(2);
      if (differs(expectedNet, net)) {
        warnings.push({
          level: "warning",
          path: "net_amount",
          message: `Total − bonificado = ${formatMoney(expectedNet, cur)}, pero el neto dice ${formatMoney(net, cur)}.`,
        });
        review.push("net_amount");
      }
    }
  }

  if (o.issue_date && o.perfected_date && o.perfected_date < o.issue_date) {
    warnings.push({ level: "warning", path: "perfected_date", message: "La fecha de perfeccionamiento es anterior a la de autorización." });
    review.push("perfected_date");
  }

  return { warnings, review };
}
