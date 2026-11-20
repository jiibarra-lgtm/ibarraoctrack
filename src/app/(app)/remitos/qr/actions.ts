"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireOrg, canWrite } from "@/lib/session";
import { friendlyDbError } from "@/lib/errors";
import { QR_MENU, QR_TARGETS } from "@/lib/qr";

type R = { ok: true; n?: number } | { ok: false; error: string };
const canEdit = (role: string) => canWrite(role as never) || role === "logistica";

const target = z.enum(Object.keys(QR_TARGETS) as [string, ...string[]]);
const menu = z.array(z.enum(Object.keys(QR_MENU) as [string, ...string[]])).min(1, "Elegí al menos una opción del menú").max(7);
const url = z.string().trim().max(500).refine((v) => v === "" || /^https:\/\/\S+$/.test(v), "El link tiene que empezar con https://");

const Settings = z.object({
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Color inválido"),
  logo: z.boolean(),
  caption: z.string().trim().min(1, "Poné un texto para abajo del QR").max(60),
  mode: z.enum(["single", "menu"]),
  target, menu,
  custom_url: url,
  whatsapp: z.string().trim().max(30).refine((v) => v === "" || /^\+?\d[\d\s-]{7,}$/.test(v), "WhatsApp inválido"),
});

/** Plantilla general: diseño del QR y qué muestra por defecto. Se aplica a todos los remitos (los que no tienen algo propio). */
export async function saveQrSettings(input: z.input<typeof Settings>): Promise<R> {
  const s = await requireOrg();
  if (!canEdit(s.org.role)) return { ok: false, error: "Tu rol no permite cambiar los QR" };
  const p = Settings.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Datos inválidos" };
  const v = p.data;
  if (v.mode === "single" && v.target === "url" && !v.custom_url) return { ok: false, error: "Poné el link al que tiene que ir" };
  const { error } = await s.supabase.from("qr_settings").upsert({
    org_id: s.org.org_id, color: v.color, logo: v.logo, caption: v.caption, mode: v.mode, target: v.target, menu: v.menu,
    custom_url: v.custom_url || null, whatsapp: v.whatsapp || null, updated_at: new Date().toISOString(),
  });
  if (error) return { ok: false, error: friendlyDbError(error) };
  revalidatePath("/remitos/qr");
  return { ok: true };
}

const Code = z.object({
  id: z.string().uuid(),
  // "default" = usar la plantilla general
  mode: z.enum(["default", "single", "menu"]),
  target: target.or(z.literal("default")),
  menu: menu.nullable(),
  custom_url: url,
  active: z.boolean(),
});

/** Cambia lo que muestra un QR puntual (el papel impreso sigue sirviendo). */
export async function saveQrCode(input: z.input<typeof Code>): Promise<R> {
  const s = await requireOrg();
  if (!canEdit(s.org.role)) return { ok: false, error: "Tu rol no permite cambiar los QR" };
  const p = Code.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Datos inválidos" };
  const v = p.data;
  if (v.target === "url" && !v.custom_url) return { ok: false, error: "Poné el link al que tiene que ir" };
  const { error } = await s.supabase.from("qr_codes").update({
    mode: v.mode === "default" ? null : v.mode, target: v.target === "default" ? null : v.target,
    menu: v.menu, custom_url: v.custom_url || null, active: v.active, updated_at: new Date().toISOString(),
  }).eq("id", v.id).eq("org_id", s.org.org_id);
  if (error) return { ok: false, error: friendlyDbError(error) };
  revalidatePath("/remitos/qr");
  return { ok: true };
}

const Bulk = z.object({
  ids: z.array(z.string().uuid()).min(1).max(1000),
  mode: z.enum(["default", "single", "menu"]),
  target: target.or(z.literal("default")),
});

/** Cambio masivo: todos los QR elegidos pasan a mostrar lo mismo. */
export async function bulkQr(input: z.input<typeof Bulk>): Promise<R> {
  const s = await requireOrg();
  if (!canEdit(s.org.role)) return { ok: false, error: "Tu rol no permite cambiar los QR" };
  const p = Bulk.safeParse(input);
  if (!p.success) return { ok: false, error: "Elegí al menos un QR" };
  const v = p.data;
  const { error, count } = await s.supabase.from("qr_codes").update({
    mode: v.mode === "default" ? null : v.mode, target: v.target === "default" ? null : v.target, updated_at: new Date().toISOString(),
  }, { count: "exact" }).in("id", v.ids).eq("org_id", s.org.org_id);
  if (error) return { ok: false, error: friendlyDbError(error) };
  revalidatePath("/remitos/qr");
  return { ok: true, n: count ?? v.ids.length };
}

export async function setClaimStatus(id: string, status: "visto" | "resuelto" | "nuevo"): Promise<R> {
  const s = await requireOrg();
  if (!z.string().uuid().safeParse(id).success) return { ok: false, error: "Aviso inválido" };
  const { error } = await s.supabase.from("qr_claims").update({ status }).eq("id", id).eq("org_id", s.org.org_id);
  if (error) return { ok: false, error: friendlyDbError(error) };
  revalidatePath("/remitos/qr");
  return { ok: true };
}
