import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { OrderOption } from "@/app/(app)/costos/cost-dialog";

/** Órdenes vigentes para asignar gastos (con importe y unidades para repartir). */
export async function loadOrderOptions(sb: SupabaseClient, orgId: string): Promise<OrderOption[]> {
  const { data } = await sb.from("purchase_orders_overview")
    .select("id, bac_number, display_number, customer_name, net_amount, items_total, purchase_order_items(quantity)")
    .eq("org_id", orgId).not("status", "in", "(anulada,cerrada)").order("issue_date", { ascending: false }).limit(300);
  return (data ?? []).map((o) => ({
    id: o.id as string,
    label: (o.bac_number ?? o.display_number) as string,
    customer: o.customer_name as string | null,
    sales: String(o.net_amount ?? o.items_total ?? "0"),
    units: String(((o.purchase_order_items ?? []) as { quantity: string }[]).reduce((a, x) => a + Number(x.quantity), 0)),
  }));
}
