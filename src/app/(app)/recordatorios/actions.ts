"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireOrg } from "@/lib/session";
import { friendlyDbError } from "@/lib/errors";
import { isUuid } from "@/lib/utils";

type R = { ok: true; id?: string } | { ok: false; error: string };
const refresh = () => { revalidatePath("/recordatorios"); revalidatePath("/ordenes/[id]", "page"); revalidatePath("/entregas/pendientes"); };

const schema = z.object({
  id: z.string().uuid().optional().or(z.literal("")),
  title: z.string().trim().min(1, "Poné qué te tengo que recordar").max(200),
  notes: z.string().trim().max(2000).optional().default(""),
  due: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "Elegí día y hora"),
  repeat: z.enum(["none", "daily", "weekdays", "weekly", "monthly"]).default("none"),
  nag_minutes: z.number().int().min(15).max(1440).nullable().optional(),
  priority: z.enum(["normal", "alta"]).default("normal"),
  order_id: z.string().uuid().nullable().optional(),
  board_id: z.string().uuid().nullable().optional(),
  link_path: z.string().trim().max(500).regex(/^\/[^/\\]/, "Enlace inválido").nullable().optional().or(z.literal("")),
  link_label: z.string().trim().max(200).nullable().optional(),
});
export type ReminderInput = z.input<typeof schema>;

/** Argentina no tiene horario de verano: la hora elegida es siempre -03:00. */
const toTs = (local: string) => new Date(`${local}:00-03:00`).toISOString();

export async function saveReminder(input: ReminderInput): Promise<R> {
  const s = await requireOrg();
  const p = schema.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Datos inválidos" };
  const d = p.data;
  const row = {
    title: d.title, notes: d.notes || null, due_at: toTs(d.due), repeat: d.repeat, nag_minutes: d.nag_minutes ?? null, priority: d.priority,
    order_id: d.order_id ?? null, board_id: d.board_id ?? null, link_path: d.link_path || null, link_label: d.link_label || null,
    notified_at: null, status: "pendiente" as const, done_at: null, updated_at: new Date().toISOString(),
  };
  if (d.id) {
    const { error } = await s.supabase.from("reminders").update(row).eq("id", d.id).eq("org_id", s.org.org_id);
    if (error) return { ok: false, error: friendlyDbError(error) };
    await s.supabase.rpc("reminder_log", { p_id: d.id, p_kind: "editado", p_detail: null });
    refresh();
    return { ok: true, id: d.id };
  }
  const { data, error } = await s.supabase.from("reminders").insert({ ...row, org_id: s.org.org_id }).select("id").single();
  if (error) return { ok: false, error: friendlyDbError(error) };
  await s.supabase.rpc("reminder_log", { p_id: data.id, p_kind: "creado", p_detail: null });
  refresh();
  return { ok: true, id: data.id as string };
}

export async function actReminder(id: string, action: "done" | "snooze" | "reopen" | "cancel", minutes?: number): Promise<R> {
  const s = await requireOrg();
  if (!isUuid(id)) return { ok: false, error: "No permitido" };
  const { error } = await s.supabase.rpc("reminder_act", { p_id: id, p_action: action, p_minutes: minutes ?? null });
  if (error) return { ok: false, error: friendlyDbError(error) };
  refresh();
  return { ok: true };
}

export async function deleteReminder(id: string): Promise<R> {
  const s = await requireOrg();
  if (!isUuid(id)) return { ok: false, error: "No permitido" };
  const { error } = await s.supabase.from("reminders").delete().eq("id", id).eq("org_id", s.org.org_id);
  if (error) return { ok: false, error: friendlyDbError(error) };
  refresh();
  return { ok: true };
}

export type LinkOption = { kind: "orden" | "entrega" | "pantalla"; order_id?: string; board_id?: string; path: string; label: string; sub?: string };

const SCREENS: LinkOption[] = [
  { kind: "pantalla", path: "/precios-stock", label: "Precios y stock" },
  { kind: "pantalla", path: "/entregas/pendientes", label: "Entregas pendientes" },
  { kind: "pantalla", path: "/cobranzas", label: "Cobranzas" },
  { kind: "pantalla", path: "/impuestos", label: "Impuestos y ARCA" },
  { kind: "pantalla", path: "/gastos-fijos", label: "Gastos fijos" },
  { kind: "pantalla", path: "/correos", label: "Correos" },
  { kind: "pantalla", path: "/compras", label: "Compras" },
  { kind: "pantalla", path: "/ordenes/importar", label: "Importar OC" },
];

/** Para enlazar: OC por número / organismo, entregas pendientes por lugar, o una pantalla. */
export async function searchReminderLinks(q: string): Promise<LinkOption[]> {
  const s = await requireOrg();
  const term = q.trim().replace(/[%_,()]/g, " ").slice(0, 60);
  if (term.length < 2) return SCREENS;
  const like = `%${term}%`;
  const [{ data: orders }, { data: board }] = await Promise.all([
    s.supabase.from("purchase_orders_overview").select("id, bac_number, display_number, customer_name, dependencia, status")
      .eq("org_id", s.org.org_id).or(`bac_number.ilike.${like},display_number.ilike.${like},customer_name.ilike.${like},dependencia.ilike.${like}`)
      .order("issue_date", { ascending: false }).limit(8),
    s.supabase.from("delivery_board").select("id, place, oc_text, note").eq("org_id", s.org.org_id).eq("status", "pendiente")
      .or(`place.ilike.${like},oc_text.ilike.${like},note.ilike.${like}`).limit(6),
  ]);
  const low = term.toLowerCase();
  return [
    ...(orders ?? []).map((o) => ({ kind: "orden" as const, order_id: o.id as string, path: `/ordenes/${o.id}`, label: `OC ${o.bac_number ?? o.display_number}`, sub: (o.dependencia ?? o.customer_name ?? "") as string })),
    ...(board ?? []).map((b) => ({ kind: "entrega" as const, board_id: b.id as string, path: "/entregas/pendientes", label: `Entrega: ${b.place}`, sub: (b.oc_text ?? b.note ?? "") as string })),
    ...SCREENS.filter((x) => x.label.toLowerCase().includes(low)),
  ];
}
