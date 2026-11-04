import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { DeliveryItemOption } from "@/components/delivery/delivery-form";
import type { DeliveryRow } from "@/components/delivery/deliveries-panel";

export async function loadDeliveryItems(sb: SupabaseClient, poId: string): Promise<DeliveryItemOption[]> {
  const [{ data: items }, { data: prog }] = await Promise.all([
    sb.from("purchase_order_items").select("id, line_number, option_number, description_original, quantity").eq("purchase_order_id", poId).order("line_number").order("option_number"),
    sb.from("po_item_delivery").select("purchase_order_item_id, delivered_qty, scheduled_qty").eq("purchase_order_id", poId),
  ]);
  const p = new Map((prog ?? []).map((x) => [x.purchase_order_item_id, Number(x.delivered_qty) + Number(x.scheduled_qty)]));
  return (items ?? []).map((i) => ({
    id: i.id, line_number: i.line_number, option_number: i.option_number, description: i.description_original.slice(0, 140),
    quantity: String(i.quantity), committed: String(p.get(i.id) ?? 0),
  }));
}

export async function loadDeliveries(sb: SupabaseClient, poId: string): Promise<DeliveryRow[]> {
  const { data } = await sb.from("deliveries")
    .select("id, internal_number, status, planned_date, actual_date, remito_number, delivery_place, responsible, transport, notes, version, delivery_items(purchase_order_item_id, quantity, purchase_order_items(line_number)), documents(id, title, created_at), delivery_incidents(id, kind, description, created_at)")
    .eq("purchase_order_id", poId).order("created_at", { ascending: false });
  return (data ?? []).map((d) => ({
    ...(d as unknown as DeliveryRow),
    items: ((d.delivery_items ?? []) as unknown as { purchase_order_item_id: string; quantity: string; purchase_order_items: { line_number: number } }[])
      .map((i) => ({ purchase_order_item_id: i.purchase_order_item_id, quantity: i.quantity, line_number: i.purchase_order_items.line_number }))
      .sort((a, b) => a.line_number - b.line_number),
    documents: (d.documents ?? []) as DeliveryRow["documents"],
    incidents: (d.delivery_incidents ?? []) as DeliveryRow["incidents"],
  }));
}
