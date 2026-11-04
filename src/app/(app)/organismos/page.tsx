import type { Metadata } from "next";
import Link from "next/link";
import { Building2 } from "lucide-react";
import { requireOrg } from "@/lib/session";
import { Card, EmptyState, PageHeader } from "@/components/ui/primitives";
import { formatMoney } from "@/lib/format";
import { sum } from "@/lib/money";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Organismos" };

export default async function CustomersPage({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
  const { id } = await searchParams;
  const s = await requireOrg();
  const [{ data: customers }, { data: orders }] = await Promise.all([
    s.supabase.from("customers").select("id, name, cuit, address").eq("org_id", s.org.org_id).order("name"),
    s.supabase.from("purchase_orders").select("customer_id, currency, total_amount, net_amount, status, jurisdiction").eq("org_id", s.org.org_id).neq("status", "anulada"),
  ]);

  type Stat = { n: number; jurisdiction?: string; byCur: Map<string, string[]> };
  const stats = new Map<string, Stat>();
  (orders ?? []).forEach((o) => {
    if (!o.customer_id) return;
    const st: Stat = stats.get(o.customer_id) ?? { n: 0, byCur: new Map() };
    st.n++;
    st.jurisdiction ??= o.jurisdiction ?? undefined;
    const v = o.total_amount ?? o.net_amount;
    if (v != null) st.byCur.set(o.currency, [...(st.byCur.get(o.currency) ?? []), String(v)]);
    stats.set(o.customer_id, st);
  });

  return (
    <>
      <PageHeader title="Organismos" description="Compradores públicos. Se crean automáticamente al cargar o importar una orden." />
      <Card className="overflow-hidden">
        {!customers?.length ? (
          <EmptyState icon={<Building2 />} title="Sin organismos todavía" description="Aparecen al cargar la primera orden." />
        ) : (
          <ul className="divide-y divide-border">
            {customers.map((c) => {
              const st = stats.get(c.id);
              return (
                <li key={c.id} className={cn(id === c.id && "bg-info-soft/50")}>
                  <Link href={`/ordenes?organismo=${c.id}`} className="flex flex-col gap-1 px-4 py-3.5 hover:bg-surface-2/60 sm:flex-row sm:items-center sm:gap-4 sm:px-5">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{c.name}</p>
                      <p className="truncate text-xs text-fg-subtle">{[st?.jurisdiction, c.address, c.cuit].filter(Boolean).join(" · ") || "—"}</p>
                    </div>
                    <span className="text-xs text-fg-muted tabular">{st?.n ?? 0} órdenes</span>
                    <span className="text-sm font-medium tabular sm:w-44 sm:text-right">
                      {st ? [...st.byCur.entries()].map(([cur, vals]) => formatMoney(sum(vals), cur)).join(" · ") : "—"}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </>
  );
}
