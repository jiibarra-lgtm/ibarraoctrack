import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * 79) Punto de equilibrio: cuánto tenés que vender (neto de IVA) en el mes para cubrir los gastos fijos,
 * con el margen bruto real de tus órdenes de los últimos 6 meses.
 */
export async function loadBreakEven(sb: SupabaseClient, org: string, month: string) {
  const mStart = `${month}-01`;
  const mEnd = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 1)).toISOString().slice(0, 10);
  const from = new Date(Date.parse(mEnd) - 183 * 864e5).toISOString().slice(0, 10);
  const [{ data: fc }, { data: pr }] = await Promise.all([
    sb.from("fixed_costs").select("amount, frequency, source").eq("org_id", org).eq("active", true).eq("is_variable", false).limit(1000),
    sb.from("po_profitability").select("issue_date, sales_net, gross_profit_estimated").eq("org_id", org).eq("currency", "ARS")
      .not("status", "in", "(anulada,borrador)").gte("issue_date", from).lt("issue_date", mEnd).limit(5000),
  ]);
  const fixed = ((fc ?? []) as { amount: string; frequency: number | null; source: string }[])
    .filter((c) => !["arca", "mail"].includes(c.source)).reduce((a, c) => a + Number(c.amount) / Math.max(1, Number(c.frequency) || 1), 0);
  const rows = ((pr ?? []) as { issue_date: string; sales_net: string | null; gross_profit_estimated: string | null }[]).filter((r) => r.gross_profit_estimated != null && Number(r.sales_net) > 0);
  const net = rows.reduce((a, r) => a + Number(r.sales_net), 0);
  const gross = rows.reduce((a, r) => a + Number(r.gross_profit_estimated), 0);
  const marginPct = net > 0 ? gross / net : null;
  const needed = marginPct && marginPct > 0 ? fixed / marginPct : null;
  const sold = rows.filter((r) => r.issue_date >= mStart).reduce((a, r) => a + Number(r.sales_net), 0);
  return { fixed, marginPct, needed, sold, pct: needed ? sold / needed : null };
}
export type BreakEven = Awaited<ReturnType<typeof loadBreakEven>>;
