import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { FileText, Plus, Upload } from "lucide-react";
import { requireOrg, canWrite } from "@/lib/session";
import { Button } from "@/components/ui/button";
import { Card, EmptyState, PageHeader } from "@/components/ui/primitives";
import { PO_STATUSES } from "@/lib/po/schema";
import { OrdersTable, type OrderRow } from "./orders-table";
import { OrdersFilters } from "./orders-filters";

export const metadata: Metadata = { title: "Órdenes de compra" };

type SP = { q?: string; estado?: string; organismo?: string; desde?: string; hasta?: string };

export default async function OrdersPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const s = await requireOrg();

  let query = s.supabase
    .from("purchase_orders_overview")
    .select("id, display_number, bac_number, expediente_number, process_number, customer_id, customer_name, dependencia, issue_date, due_date, status, currency, total_amount, net_amount, items_count, source, created_at")
    .eq("org_id", s.org.org_id)
    .order("issue_date", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(1000);

  if (sp.estado && (PO_STATUSES as readonly string[]).includes(sp.estado)) query = query.eq("status", sp.estado);
  if (sp.organismo) query = query.eq("customer_id", sp.organismo);
  if (sp.desde && /^\d{4}-\d{2}-\d{2}$/.test(sp.desde)) query = query.gte("issue_date", sp.desde);
  if (sp.hasta && /^\d{4}-\d{2}-\d{2}$/.test(sp.hasta)) query = query.lte("issue_date", sp.hasta);
  if (sp.q) {
    const t = sp.q.replace(/[%,()*]/g, " ").trim().slice(0, 80);
    if (t) query = query.or(`bac_number.ilike.*${t}*,expediente_number.ilike.*${t}*,process_number.ilike.*${t}*,customer_name.ilike.*${t}*,dependencia.ilike.*${t}*`);
  }

  const [{ data: rows, error }, { data: customers }] = await Promise.all([
    query,
    s.supabase.from("customers").select("id, name").eq("org_id", s.org.org_id).order("name").limit(500),
  ]);
  const writable = canWrite(s.org.role);
  const hasFilters = Boolean(sp.q || sp.estado || sp.organismo || sp.desde || sp.hasta);

  return (
    <>
      <PageHeader
        title="Órdenes de compra"
        description="Todas las OC adjudicadas, con su estado y avance."
        actions={writable && (
          <>
            <Button asChild variant="secondary"><Link href="/ordenes/importar"><Upload /> Importar de BAC</Link></Button>
            <Button asChild><Link href="/ordenes/nueva"><Plus /> Nueva</Link></Button>
          </>
        )}
      />
      <Suspense><OrdersFilters customers={customers ?? []} /></Suspense>
      <Card className="mt-4 overflow-hidden">
        {error ? (
          <EmptyState title="No se pudieron cargar las órdenes" description={error.message} />
        ) : !rows?.length ? (
          <EmptyState
            icon={<FileText />}
            title={hasFilters ? "Sin órdenes para estos filtros" : "Todavía no hay órdenes"}
            description={hasFilters ? "Probá con otros criterios." : "Importá la primera desde la captura o PDF de BAC."}
            action={!hasFilters && writable && <Button asChild><Link href="/ordenes/importar"><Upload /> Importar OC</Link></Button>}
          />
        ) : (
          <OrdersTable rows={rows as OrderRow[]} />
        )}
      </Card>
    </>
  );
}
