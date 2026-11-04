"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { ORG_COOKIE, getSession } from "@/lib/session";
import { isUuid } from "@/lib/utils";

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  (await cookies()).delete(ORG_COOKIE);
  redirect("/login");
}

export async function switchOrg(orgId: string) {
  const s = await getSession();
  if (!s || !isUuid(orgId) || !s.memberships.some((m) => m.org_id === orgId)) return;
  (await cookies()).set(ORG_COOKIE, orgId, { httpOnly: true, sameSite: "lax", secure: true, path: "/", maxAge: 60 * 60 * 24 * 365 });
  revalidatePath("/", "layout");
}

export type SearchResult = { kind: string; id: string; title: string; subtitle: string | null; href: string; score: number };

export async function globalSearch(q: string): Promise<SearchResult[]> {
  const s = await getSession();
  if (!s?.org) return [];
  const term = q.trim().slice(0, 100);
  if (term.length < 2) return [];
  const { data, error } = await s.supabase.rpc("global_search", { p_org: s.org.org_id, p_q: term, p_limit: 25 });
  if (error) {
    console.error("global_search", error.message);
    return [];
  }
  // Una entrada por destino, conservando la de mayor relevancia
  const seen = new Set<string>();
  return (data as SearchResult[]).filter((r) => {
    const k = `${r.kind}:${r.href}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
