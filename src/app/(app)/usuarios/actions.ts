"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireOrg } from "@/lib/session";
import { friendlyDbError } from "@/lib/errors";

const ROLES = ["admin", "finanzas", "compras", "logistica", "consulta"] as const;

export async function addMember(_: unknown, form: FormData) {
  const s = await requireOrg();
  if (s.org.role !== "admin") return { error: "Sólo administradores." };
  const parsed = z.object({ email: z.string().trim().email("Email inválido"), role: z.enum(ROLES) }).safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { error } = await s.supabase.rpc("add_member_by_email", { p_org: s.org.org_id, p_email: parsed.data.email, p_role: parsed.data.role });
  if (error) return { error: friendlyDbError(error) };
  revalidatePath("/usuarios");
  return { ok: `${parsed.data.email} ahora tiene acceso.` };
}

export async function updateRole(memberId: string, role: string) {
  const s = await requireOrg();
  if (s.org.role !== "admin" || !(ROLES as readonly string[]).includes(role)) return { error: "No permitido" };
  const { data: m } = await s.supabase.from("organization_members").select("user_id").eq("id", memberId).maybeSingle();
  if (m?.user_id === s.userId && role !== "admin") return { error: "No podés quitarte el rol de administrador a vos mismo." };
  const { error } = await s.supabase.from("organization_members").update({ role }).eq("id", memberId).eq("org_id", s.org.org_id);
  if (error) return { error: friendlyDbError(error) };
  revalidatePath("/usuarios");
  return { ok: true };
}

export async function removeMember(memberId: string) {
  const s = await requireOrg();
  if (s.org.role !== "admin") return { error: "No permitido" };
  const { error } = await s.supabase.from("organization_members").delete().eq("id", memberId).eq("org_id", s.org.org_id);
  if (error) return { error: friendlyDbError(error) };
  revalidatePath("/usuarios");
  return { ok: true };
}
