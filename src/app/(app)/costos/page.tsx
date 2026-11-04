import type { Metadata } from "next";
import Link from "next/link";
import { CircleDollarSign } from "lucide-react";
import { requireOrg, canWrite } from "@/lib/session";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui/primitives";
import { formatDate, formatMoney } from "@/lib/format";
import { loadOrderOptions } from "@/lib/orders-options";
import { CostDialog } from "./cost-dialog";

export const metadata: Metadata = { title: "Costos" };

const METHOD: Record<string, string> = { importe: "por importe", unidades: "por unidades", manual: "manual" };

export default async function CostsPage() {
  const s = await requireOrg();
  const [{ data: costs }, { data: categories }, orders] = await Promise.all([
    s.supabase.from("costs").select("id, description, cost_date, net_amount, total_amount, allocation_method, status, cost_categories(name, kind), cost_allocations(amount, purchase_order_id, purchase_orders(bac_number, internal_number))")
      .eq("org_id", s.org.org_id).order("cost_date", { ascending: false }).limit(300),
    s.supabase.from("cost_categories").select("id, name, kind").eq("org_id", s.org.org_id).order("name"),
    loadOrderOptions(s.supabase, s.org.org_id),
  ]);
  type Row = { id: string; description: string; cost_date: string; net_amount: string; allocation_method: string; status: string;
    cost_categories: { name: string } | null; cost_allocations: { amount: string; purchase_order_id: string; purchase_orders: { bac_number: string | null; internal_number: number } }[] };

  return (
    <>
      <PageHeader title="Costos y gastos" description="Logística, embalaje, comisiones y demás gastos, asignados a las órdenes con un criterio explícito."
        actions={canWrite(s.org.role) && <CostDialog categories={categories ?? []} orders={orders} />} />
      <Card className="overflow-hidden">
        {!costs?.length ? <EmptyState icon={<CircleDollarSign />} title="Sin gastos registrados" description="Cargá fletes y otros costos para ver la ganancia operativa real de cada orden." /> : (
          <ul className="divide-y divide-border">
            {(costs as unknown as Row[]).map((c) => (
              <li key={c.id} className="flex flex-col gap-1.5 px-4 py-3 sm:flex-row sm:items-center sm:gap-4 sm:px-5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{c.description} {c.status === "anulado" && <Badge tone="danger" className="ml-1">Anulado</Badge>}</p>
                  <p className="text-xs text-fg-subtle">{c.cost_categories?.name} · {formatDate(c.cost_date)}{c.cost_allocations.length > 1 ? ` · repartido ${METHOD[c.allocation_method]}` : ""}</p>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {c.cost_allocations.length === 0 && <Badge>Gasto general</Badge>}
                    {c.cost_allocations.map((a, i) => (
                      <Link key={i} href={`/ordenes/${a.purchase_order_id}?tab=costos`} className="rounded border border-border px-1.5 py-0.5 text-[11px] hover:border-border-strong">
                        {a.purchase_orders.bac_number ?? `OC-${String(a.purchase_orders.internal_number).padStart(6, "0")}`} · {formatMoney(a.amount)}
                      </Link>
                    ))}
                  </div>
                </div>
                <span className="text-sm font-medium tabular sm:w-32 sm:text-right">{formatMoney(c.net_amount)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
