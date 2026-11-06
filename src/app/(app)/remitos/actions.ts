"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireOrg, canWrite } from "@/lib/session";
import { friendlyDbError } from "@/lib/errors";
import { isUuid } from "@/lib/utils";
import { loadDeliveryItems } from "@/lib/delivery-load";

const canEmit = (role: string) => canWrite(role as never) || role === "logistica";

const Line = z.object({
  description: z.string().trim().max(500),
  quantity: z.string().trim().max(20),
  detail: z.string().trim().max(300).optional().default(""),
  purchase_order_item_id: z.string().uuid().optional().or(z.literal("")),
  product_id: z.string().uuid().optional().or(z.literal("")),
});
const Payload = z.object({
  recipient_name: z.string().trim().min(1, "Indicá el destinatario").max(300),
  recipient_address: z.string().trim().max(300).optional().default(""),
  recipient_cuit: z.string().trim().max(20).optional().default(""),
  recipient_iva: z.string().trim().max(60).optional().default(""),
  place_id: z.string().uuid().optional().or(z.literal("")),
  customer_id: z.string().uuid().optional().or(z.literal("")),
  purchase_order_id: z.string().uuid().optional().or(z.literal("")),
  register_delivery: z.boolean().default(false),
  save_place: z.boolean().default(false),
  provisional: z.boolean().default(true),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time: z.string().regex(/^\d{2}:\d{2}$/),
  notes: z.string().trim().max(1000).optional().default(""),
  items: z.array(Line).max(200),
});
export type EmitPayload = z.input<typeof Payload>;

export async function emitRemito(input: EmitPayload): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const s = await requireOrg();
  if (!canEmit(s.org.role)) return { ok: false, error: "Tu rol no permite emitir remitos" };
  const p = Payload.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Datos inválidos" };
  const v = p.data;
  const items = v.items
    .map((i) => ({ ...i, quantity: i.quantity.replace(/\./g, "").replace(",", ".") }))
    .filter((i) => i.description && Number(i.quantity) > 0);
  if (!items.length) return { ok: false, error: "Agregá al menos un producto con cantidad" };
  if (items.some((i) => !Number.isFinite(Number(i.quantity)))) return { ok: false, error: "Hay una cantidad inválida" };
  const { date, time, ...rest } = v;
  const { data, error } = await s.supabase.rpc("emit_remito", {
    p_org: s.org.org_id,
    p_payload: { ...rest, items, issued_at: `${date}T${time}:00-03:00` },
  });
  if (error) return { ok: false, error: friendlyDbError(error) };
  revalidatePath("/remitos");
  if (v.purchase_order_id) revalidatePath(`/ordenes/${v.purchase_order_id}`);
  return { ok: true, id: data as string };
}

export type OrderForRemito = {
  id: string; number: string; customer_id: string | null; customer_name: string | null; customer_address: string | null; customer_cuit: string | null;
  delivery_place: string | null; dependencia: string | null;
  items: { id: string; line: number; description: string; quantity: string; pending: string }[];
};

/** Busca una OC por número (BAC o interno) para completar el remito. */
export async function findOrderForRemito(q: string): Promise<OrderForRemito | null> {
  const s = await requireOrg();
  const n = q.trim().toUpperCase();
  if (n.length < 3) return null;
  const { data: rows } = await s.supabase.from("purchase_orders_overview")
    .select("id, bac_number, display_number, customer_id, customer_name, delivery_place, dependencia, status")
    .eq("org_id", s.org.org_id).neq("status", "anulada")
    .or(`bac_number.ilike.*${n.replace(/[%*,()]/g, "")}*,display_number.ilike.*${n.replace(/[%*,()]/g, "")}*`)
    .order("issue_date", { ascending: false }).limit(1);
  const po = rows?.[0];
  if (!po) return null;
  const [items, cust] = await Promise.all([
    loadDeliveryItems(s.supabase, po.id),
    po.customer_id ? s.supabase.from("customers").select("address, cuit").eq("id", po.customer_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  return {
    id: po.id, number: po.bac_number ?? po.display_number, customer_id: po.customer_id, customer_name: po.customer_name,
    customer_address: cust.data?.address ?? null, customer_cuit: cust.data?.cuit ?? null,
    delivery_place: po.delivery_place, dependencia: po.dependencia,
    items: items.map((i) => ({ id: i.id, line: i.line_number, description: i.description, quantity: i.quantity, pending: String(Math.max(0, Number(i.quantity) - Number(i.committed))) })),
  };
}

export async function searchProducts(q: string) {
  const s = await requireOrg();
  const n = q.trim();
  if (n.length < 2) return [];
  const { data } = await s.supabase.from("products").select("id, description, unit").eq("org_id", s.org.org_id).eq("is_active", true)
    .ilike("description", `%${n.replace(/[%_]/g, "")}%`).order("description").limit(12);
  return (data ?? []) as { id: string; description: string; unit: string | null }[];
}

type R = { ok: true } | { ok: false; error: string };

export async function remitoAction(id: string, kind: "impreso" | "entregado" | "anulado" | "nota", note?: string): Promise<R> {
  const s = await requireOrg();
  if (!isUuid(id)) return { ok: false, error: "Remito inválido" };
  const { error } = await s.supabase.rpc("remito_action", { p_id: id, p_kind: kind, p_note: note ?? null, p_document: null });
  if (error) return { ok: false, error: friendlyDbError(error) };
  revalidatePath(`/remitos/${id}`);
  revalidatePath("/remitos");
  return { ok: true };
}

const Signed = z.object({
  remitoId: z.string().uuid(),
  storagePath: z.string().min(10).max(500),
  title: z.string().trim().min(1).max(255),
  mimeType: z.enum(["application/pdf", "image/jpeg", "image/png", "image/webp", "image/heic"]),
  size: z.number().int().positive().max(25 * 1024 * 1024),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
});

/** Copia firmada del remito: queda en Documentos (y en la orden si está vinculada) y el remito pasa a "firmado". */
export async function attachSignedRemito(input: z.input<typeof Signed>): Promise<R> {
  const s = await requireOrg();
  if (!canEmit(s.org.role)) return { ok: false, error: "Tu rol no permite adjuntar documentos" };
  const p = Signed.safeParse(input);
  if (!p.success) return { ok: false, error: "Archivo inválido" };
  const d = p.data;
  if (!d.storagePath.startsWith(`${s.org.org_id}/`)) return { ok: false, error: "Ruta de archivo inválida" };
  const { data: r } = await s.supabase.from("remitos").select("purchase_order_id, delivery_id, provisional").eq("id", d.remitoId).eq("org_id", s.org.org_id).maybeSingle();
  if (!r) return { ok: false, error: "Remito inexistente" };
  const { data: doc, error } = await s.supabase.from("documents").insert({
    org_id: s.org.org_id, purchase_order_id: r.purchase_order_id, delivery_id: r.delivery_id,
    doc_type: r.provisional ? "remito_provisorio" : "remito_oficial", title: d.title, storage_path: d.storagePath,
    mime_type: d.mimeType, size_bytes: d.size, sha256: d.sha256, uploaded_by: s.userId,
  }).select("id").single();
  if (error || !doc) {
    await s.supabase.storage.from("documents").remove([d.storagePath]);
    return { ok: false, error: friendlyDbError(error) };
  }
  const { error: e2 } = await s.supabase.rpc("remito_action", { p_id: d.remitoId, p_kind: "firmado", p_note: d.title, p_document: doc.id });
  if (e2) return { ok: false, error: friendlyDbError(e2) };
  revalidatePath(`/remitos/${d.remitoId}`);
  revalidatePath("/remitos");
  if (r.purchase_order_id) revalidatePath(`/ordenes/${r.purchase_order_id}`);
  return { ok: true };
}
