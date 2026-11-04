import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export type ProfitRow = {
  purchase_order_id: string; currency: string; status: string; issue_date: string | null; customer_id: string | null;
  sales_gross: string; sales_net: string; direct_cost_real: string; direct_cost_estimated: string | null;
  cost_estimate_complete: boolean; fully_purchased: boolean; purchased_pct: string; other_costs: string;
  logistic_costs: string; financial_costs: string; operating_costs: string; min_margin_pct: string;
  gross_profit_estimated: string | null; operating_profit_estimated: string | null; gross_margin_estimated: string | null;
  operating_margin_estimated: string | null; markup_estimated: string | null;
  delivered_pct?: string; sales_delivered_net?: string; cost_delivered?: string | null; other_costs_delivered?: string;
  gross_profit_realized?: string | null; operating_profit_realized?: string | null; operating_margin_realized?: string | null;
};

export async function loadProfitability(sb: SupabaseClient, orgId: string, ids?: string[]) {
  let q = sb.from("po_profitability").select("*").eq("org_id", orgId);
  if (ids) q = q.in("purchase_order_id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as ProfitRow[];
}
