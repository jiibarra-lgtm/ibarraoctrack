import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type AppRole = "admin" | "finanzas" | "compras" | "logistica" | "consulta";
export const ORG_COOKIE = "oc_org";

export const ROLE_LABEL: Record<AppRole, string> = {
  admin: "Administrador", finanzas: "Finanzas", compras: "Compras", logistica: "Logística", consulta: "Consulta",
};

export type Membership = { org_id: string; role: AppRole; org_name: string };

export const getSession = cache(async () => {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (!userId) return null;

  const [{ data: profile }, { data: members }] = await Promise.all([
    supabase.from("profiles").select("id, email, full_name").eq("id", userId).maybeSingle(),
    supabase.from("organization_members").select("org_id, role, organizations(name)").eq("user_id", userId),
  ]);

  const memberships: Membership[] = (members ?? []).map((m) => ({
    org_id: m.org_id as string,
    role: m.role as AppRole,
    org_name: (m.organizations as unknown as { name: string } | null)?.name ?? "—",
  }));

  const store = await cookies();
  const preferred = store.get(ORG_COOKIE)?.value;
  const current = memberships.find((m) => m.org_id === preferred) ?? memberships[0] ?? null;

  return {
    supabase,
    userId,
    email: (claims?.claims?.email as string | undefined) ?? profile?.email ?? "",
    fullName: profile?.full_name ?? "",
    memberships,
    org: current,
  };
});

/** Para páginas privadas: exige sesión y organización activa. */
export async function requireOrg() {
  const s = await getSession();
  if (!s) redirect("/login");
  if (!s.org) redirect("/onboarding");
  return s as typeof s & { org: Membership };
}

export function canWrite(role: AppRole) {
  return role === "admin" || role === "compras" || role === "finanzas";
}
