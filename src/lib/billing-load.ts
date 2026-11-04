import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { InvoiceBalance, PoBilling } from "@/lib/billing";

const NONE = ["00000000-0000-0000-0000-000000000000"];

export type OrderRef = { id: string; label: string; customer: string | null; status: string; currency: string };

/** Etiquetas de órdenes (número BAC u interno + organismo) para listados. */
export async function orderRefs(sb: SupabaseClient, ids: string[]): Promise<Map<string, OrderRef>> {
  const uniq = [...new Set(ids)];
  const { data } = await sb.from("purchase_orders_overview").select("id, bac_number, display_number, customer_name, status, currency")
    .in("id", uniq.length ? uniq : NONE);
  return new Map((data ?? []).map((o) => [o.id as string, { id: o.id, label: o.bac_number ?? o.display_number, customer: o.customer_name, status: o.status, currency: o.currency }]));
}

export async function loadInvoices(sb: SupabaseClient, orgId: string, opts: { poId?: string; onlyOpen?: boolean; limit?: number } = {}) {
  let q = sb.from("invoice_balances").select("*").eq("org_id", orgId).order("issue_date", { ascending: false }).limit(opts.limit ?? 500);
  if (opts.poId) q = q.eq("purchase_order_id", opts.poId);
  if (opts.onlyOpen) q = q.eq("status", "emitida").gt("balance", 0);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as InvoiceBalance[];
  const refs = await orderRefs(sb, rows.map((r) => r.purchase_order_id));
  return rows.map((r) => ({ ...r, order: refs.get(r.purchase_order_id) ?? null }));
}
export type InvoiceWithOrder = Awaited<ReturnType<typeof loadInvoices>>[number];

/** Órdenes con saldo por facturar (no anuladas). */
export async function loadBillableOrders(sb: SupabaseClient, orgId: string) {
  const { data, error } = await sb.from("po_billing").select("*").eq("org_id", orgId).neq("status", "anulada").gt("to_invoice", 0).limit(500);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as PoBilling[];
  const refs = await orderRefs(sb, rows.map((r) => r.purchase_order_id));
  return rows.map((r) => ({ ...r, order: refs.get(r.purchase_order_id) ?? null }));
}

export async function loadPoBilling(sb: SupabaseClient, orgId: string, ids?: string[]) {
  let q = sb.from("po_billing").select("*").eq("org_id", orgId);
  if (ids) q = q.in("purchase_order_id", ids.length ? ids : NONE);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as PoBilling[];
}

/** Serie mensual de los últimos `months` meses (rellena meses vacíos). */
export async function loadMonthlyFlows(sb: SupabaseClient, orgId: string, currency: string, months = 12, offset = 0) {
  const now = new Date();
  const keys: string[] = [];
  for (let i = months - 1 + offset; i >= offset; i--) {
    keys.push(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1)).toISOString().slice(0, 7));
  }
  const { data } = await sb.from("monthly_flows").select("*").eq("org_id", orgId).eq("currency", currency)
    .gte("month", `${keys[0]}-01`).lte("month", `${keys[keys.length - 1]}-01`);
  const by = new Map((data ?? []).map((r) => [String(r.month).slice(0, 7), r]));
  return keys.map((k) => {
    const r = by.get(k);
    return {
      month: k, awarded: Number(r?.awarded ?? 0), invoiced: Number(r?.invoiced ?? 0), collected: Number(r?.collected ?? 0),
      withheld: Number(r?.withheld ?? 0), purchases: Number(r?.purchases ?? 0), paid: Number(r?.paid ?? 0), expenses: Number(r?.expenses ?? 0),
    };
  });
}
