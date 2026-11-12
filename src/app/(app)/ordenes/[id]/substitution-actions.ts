"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireOrg } from "@/lib/session";
import { isUuid } from "@/lib/utils";

const Lines = z.array(z.object({ description: z.string().trim().min(1).max(300), quantity: z.number().positive().max(1e9), unit_cost: z.number().min(0).max(1e12) })).max(50);

export async function savePoSubstitution(itemId: string, lines: z.infer<typeof Lines>, notes: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const s = await requireOrg();
  if (!["admin", "compras", "finanzas"].includes(s.org.role)) return { ok: false, error: "Tu rol no permite cargar costos" };
  if (!isUuid(itemId)) return { ok: false, error: "Renglón inválido" };
  const p = Lines.safeParse(lines);
  if (!p.success) return { ok: false, error: "Revisá descripción, cantidad y costo de cada producto" };
  const { data: it } = await s.supabase.from("purchase_order_items").select("purchase_order_id").eq("id", itemId).maybeSingle();
  const { error } = await s.supabase.rpc("save_po_substitution", { p_item: itemId, p_lines: p.data, p_notes: notes.slice(0, 500) });
  if (error) return { ok: false, error: error.message };
  if (it) revalidatePath(`/ordenes/${it.purchase_order_id}`);
  revalidatePath("/costos");
  return { ok: true };
}
