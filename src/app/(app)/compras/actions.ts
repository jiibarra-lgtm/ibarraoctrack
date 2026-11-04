"use server";
import { revalidatePath } from "next/cache";
import { requireOrg, canWrite } from "@/lib/session";
import { purchaseSchema, type PurchaseInput } from "@/lib/purchase/schema";
import { friendlyDbError } from "@/lib/errors";
import { isUuid } from "@/lib/utils";
import { parseArNumber } from "@/lib/money";

export type Suggestion = {
  purchase_order_item_id: string; purchase_order_id: string; order_label: string; customer_name: string | null;
  line_number: number; description: string; quantity: string; purchased: string; remaining: string; unit_price: string;
  score: number; by_alias: boolean;
};

export async function suggestPoItems(text: string): Promise<Suggestion[]> {
  const s = await requireOrg();
  const t = text.trim().slice(0, 300);
  if (t.length < 3) return [];
  const { data } = await s.supabase.rpc("suggest_po_items", { p_org: s.org.org_id, p_text: t, p_limit: 8 });
  return (data ?? []) as Suggestion[];
}

export async function savePurchase(input: PurchaseInput): Promise<{ ok: true; id: string } | { ok: false; error: string; fieldErrors?: Record<string, string> }> {
  const s = await requireOrg();
  if (!canWrite(s.org.role)) return { ok: false, error: "Tu rol no permite registrar compras." };
  const parsed = purchaseSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    parsed.error.issues.forEach((i) => (fieldErrors[i.path.join(".")] ??= i.message));
    return { ok: false, error: "Revisá los campos marcados.", fieldErrors };
  }
  const d = parsed.data;
  const payload = {
    ...d,
    id: d.id || undefined, supplier_id: d.supplier_id || undefined, document_id: d.document_id || undefined,
    import_job_id: d.import_job_id || undefined,
    items: d.items.map((it) => ({ ...it, allocations: it.allocations.map(({ purchase_order_item_id, quantity }) => ({ purchase_order_item_id, quantity })) })),
  };
  const { data, error } = await s.supabase.rpc("save_purchase", { p_org: s.org.org_id, p_payload: payload });
  if (error) {
    const msg = error.message.includes("uq_purchases_doc") ? "Esa factura de ese proveedor ya está registrada." : friendlyDbError(error);
    return { ok: false, error: msg };
  }
  revalidatePath("/compras");
  revalidatePath("/ordenes", "layout");
  revalidatePath("/analitica/ranking");
  return { ok: true, id: data as string };
}

export async function voidPurchase(id: string, reason: string) {
  const s = await requireOrg();
  if (!isUuid(id) || !reason.trim()) return { ok: false as const, error: "Indicá el motivo" };
  const { error } = await s.supabase.rpc("void_purchase", { p_id: id, p_reason: reason.trim().slice(0, 500) });
  if (error) return { ok: false as const, error: friendlyDbError(error) };
  revalidatePath("/compras");
  revalidatePath(`/compras/${id}`);
  return { ok: true as const };
}

export async function setEstimatedCost(poItemId: string, value: string) {
  const s = await requireOrg();
  if (!canWrite(s.org.role) || !isUuid(poItemId)) return { ok: false as const, error: "No permitido" };
  const v = value.trim() === "" ? null : parseArNumber(value);
  if (value.trim() !== "" && (v === null || Number(v) < 0)) return { ok: false as const, error: "Número inválido" };
  const { data, error } = await s.supabase.from("purchase_order_items").update({ estimated_unit_cost: v }).eq("id", poItemId).eq("org_id", s.org.org_id).select("purchase_order_id").single();
  if (error) return { ok: false as const, error: friendlyDbError(error) };
  revalidatePath(`/ordenes/${data.purchase_order_id}`);
  return { ok: true as const };
}
