import type { Metadata } from "next";
import { requireOrg } from "@/lib/session";
import { TendersView } from "@/components/tenders/tenders-view";

export const metadata: Metadata = { title: "Licitaciones BAC" };

export default async function Page({ searchParams }: { searchParams: Promise<{ rubro?: string; tipo?: string; q?: string; ver?: string }> }) {
  const s = await requireOrg();
  return <TendersView sb={s.supabase} orgId={s.org.org_id} source="bac" params={await searchParams} />;
}
