"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireOrg, canWrite } from "@/lib/session";
import { friendlyDbError } from "@/lib/errors";
import { isValidDecimal, parseArNumber } from "@/lib/money";
import { isUuid } from "@/lib/utils";

const money = z.string().trim().transform((v) => (v === "" ? "0" : (parseArNumber(v) ?? v))).refine(isValidDecimal, "Importe inválido");

const costSchema = z.object({
  id: z.string().uuid().optional().or(z.literal("")),
  category_id: z.string().uuid("Elegí una categoría"),
  description: z.string().trim().min(1, "Descripción obligatoria").max(500),
  cost_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida"),
  net_amount: money.refine((v) => Number(v) > 0, "El importe debe ser mayor a 0"),
  vat_amount: money,
  allocation_method: z.enum(["importe", "unidades", "manual"]),
  notes: z.string().trim().max(2000).optional().default(""),
  targets: z.array(z.object({
    purchase_order_id: z.string().uuid(),
    purchase_order_item_id: z.string().uuid().optional().or(z.literal("")),
    amount: z.string().optional().default(""),
  })).default([]),
});
export type CostInput = z.input<typeof costSchema>;

export async function saveCost(input: CostInput) {
  const s = await requireOrg();
  if (!canWrite(s.org.role)) return { ok: false as const, error: "Tu rol no permite registrar gastos." };
  const parsed = costSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0].message };
  const d = parsed.data;
  const payload = {
    ...d, id: d.id || undefined,
    targets: d.targets.map((t) => ({ ...t, purchase_order_item_id: t.purchase_order_item_id || undefined, amount: d.allocation_method === "manual" ? (parseArNumber(t.amount) ?? "0") : undefined })),
  };
  const { data, error } = await s.supabase.rpc("save_cost", { p_org: s.org.org_id, p_payload: payload });
  if (error) return { ok: false as const, error: friendlyDbError(error) };
  revalidatePath("/costos");
  revalidatePath("/ordenes", "layout");
  revalidatePath("/analitica/ranking");
  return { ok: true as const, id: data as string };
}

export async function voidCost(id: string, reason: string) {
  const s = await requireOrg();
  if (!isUuid(id) || !reason.trim()) return { ok: false as const, error: "Indicá el motivo" };
  const { error } = await s.supabase.rpc("void_cost", { p_id: id, p_reason: reason.trim() });
  if (error) return { ok: false as const, error: friendlyDbError(error) };
  revalidatePath("/costos");
  revalidatePath("/ordenes", "layout");
  return { ok: true as const };
}
