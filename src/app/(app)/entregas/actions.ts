"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireOrg, canWrite, type AppRole } from "@/lib/session";
import { friendlyDbError } from "@/lib/errors";
import { isValidDecimal, parseArNumber } from "@/lib/money";
import { isUuid } from "@/lib/utils";
import { DELIVERY_STATUSES } from "@/lib/delivery";

const canDeliver = (r: AppRole) => canWrite(r) || r === "logistica";
const optDate = z.string().regex(/^(\d{4}-\d{2}-\d{2})?$/).optional().default("");

const deliverySchema = z.object({
  id: z.string().uuid().optional().or(z.literal("")),
  version: z.number().int().optional(),
  purchase_order_id: z.string().uuid(),
  planned_date: optDate, actual_date: optDate,
  delivery_place: z.string().trim().max(300).optional().default(""),
  responsible: z.string().trim().max(120).optional().default(""),
  transport: z.string().trim().max(120).optional().default(""),
  remito_number: z.string().trim().max(40).optional().default(""),
  status: z.enum(DELIVERY_STATUSES).default("programada"),
  notes: z.string().trim().max(2000).optional().default(""),
  items: z.array(z.object({
    purchase_order_item_id: z.string().uuid(),
    quantity: z.string().transform((v) => (v.trim() === "" ? "0" : (parseArNumber(v) ?? v))).refine(isValidDecimal, "Cantidad inválida"),
  })),
});
export type DeliveryInput = z.input<typeof deliverySchema>;

export async function saveDelivery(input: DeliveryInput) {
  const s = await requireOrg();
  if (!canDeliver(s.org.role)) return { ok: false as const, error: "Tu rol no permite registrar entregas." };
  const parsed = deliverySchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0].message };
  const d = parsed.data;
  const items = d.items.filter((i) => Number(i.quantity) > 0);
  if (!items.length) return { ok: false as const, error: "Indicá la cantidad de al menos un renglón." };
  const { data, error } = await s.supabase.rpc("save_delivery", { p_org: s.org.org_id, p_payload: { ...d, id: d.id || undefined, items } });
  if (error) return { ok: false as const, error: friendlyDbError(error) };
  revalidatePath(`/ordenes/${d.purchase_order_id}`);
  revalidatePath("/entregas");
  revalidatePath("/dashboard");
  return { ok: true as const, id: data as string };
}

export async function setDeliveryStatus(id: string, status: string, reason: string, poId: string) {
  const s = await requireOrg();
  if (!canDeliver(s.org.role) || !isUuid(id) || !(DELIVERY_STATUSES as readonly string[]).includes(status)) return { ok: false as const, error: "No permitido" };
  const { error } = await s.supabase.rpc("set_delivery_status", { p_id: id, p_status: status, p_reason: reason.trim() || null });
  if (error) return { ok: false as const, error: friendlyDbError(error) };
  revalidatePath(`/ordenes/${poId}`);
  revalidatePath("/entregas");
  return { ok: true as const };
}

export async function addIncident(deliveryId: string, kind: string, description: string, poId: string) {
  const s = await requireOrg();
  if (!canDeliver(s.org.role) || !isUuid(deliveryId) || !description.trim()) return { ok: false as const, error: "Describí la incidencia" };
  const { error } = await s.supabase.from("delivery_incidents").insert({
    org_id: s.org.org_id, delivery_id: deliveryId, kind, description: description.trim().slice(0, 1000), created_by: s.userId,
  });
  if (error) return { ok: false as const, error: friendlyDbError(error) };
  revalidatePath(`/ordenes/${poId}`);
  return { ok: true as const };
}

/** Confirmación de la lectura de un remito: registra la entrega con las cantidades revisadas. */
export async function confirmRemito(jobId: string, input: DeliveryInput) {
  const s = await requireOrg();
  if (!isUuid(jobId)) return { ok: false as const, error: "Lectura inválida" };
  const { data: job } = await s.supabase.from("import_jobs").select("id, status, document_id").eq("id", jobId).eq("org_id", s.org.org_id).eq("kind", "remito").maybeSingle();
  if (!job || job.status !== "revision") return { ok: false as const, error: "La lectura ya fue procesada." };
  const res = await saveDelivery(input);
  if (!res.ok) return res;
  await s.supabase.from("documents").update({ delivery_id: res.id, purchase_order_id: input.purchase_order_id, doc_type: "remito" }).eq("id", job.document_id);
  await s.supabase.from("import_jobs").update({ status: "confirmado", confirmed_by: s.userId, finished_at: new Date().toISOString() }).eq("id", jobId);
  return res;
}
