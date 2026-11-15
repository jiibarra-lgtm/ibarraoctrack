import type { SupabaseClient } from "@supabase/supabase-js";
import { formatDate } from "@/lib/format";

/** Texto corto de la compra de la que sale el costo de cada renglón (proveedor, fecha y factura). */
export async function sourceLabels(sb: SupabaseClient, rows: { cost_source_item_id: string | null; cost_source_divisor: string | number | null }[]) {
  const ids = [...new Set(rows.map((r) => r.cost_source_item_id).filter((x): x is string => Boolean(x)))];
  const out = new Map<string, string>();
  if (!ids.length) return out;
  const { data } = await sb.from("supplier_items_overview").select("id, supplier_name, issue_date, description").in("id", ids);
  const div = new Map(rows.map((r) => [r.cost_source_item_id, Number(r.cost_source_divisor ?? 1)]));
  for (const x of (data ?? []) as { id: string; supplier_name: string | null; issue_date: string | null; description: string }[])
    out.set(x.id, `${x.supplier_name ?? "Proveedor"}${x.issue_date ? ` ${formatDate(x.issue_date)}` : ""}${(div.get(x.id) ?? 1) !== 1 ? ` ÷${div.get(x.id)}` : ""} · ${x.description.slice(0, 40)}`);
  return out;
}
