import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Pencil } from "lucide-react";
import { requireOrg, canWrite } from "@/lib/session";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/primitives";
import { StatusBadge } from "@/components/po/status-badge";
import { isUuid } from "@/lib/utils";
import type { PoStatus } from "@/lib/po/schema";
import { OrderTabs } from "./order-tabs";
import { StatusDialog } from "./status-dialog";
import { DocumentButton } from "./document-button";
import { loadProfitability } from "@/lib/profitability";
import { loadDeliveries, loadDeliveryItems } from "@/lib/delivery-load";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  if (!isUuid(id)) return { title: "Orden" };
  const s = await requireOrg();
  const { data } = await s.supabase.from("purchase_orders_overview").select("bac_number, display_number").eq("id", id).maybeSingle();
  return { title: data?.bac_number ?? data?.display_number ?? "Orden" };
}

export default async function OrderPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { id } = await params;
  const { tab } = await searchParams;
  if (!isUuid(id)) notFound();
  const s = await requireOrg();
  const sb = s.supabase;
  const auditAllowed = s.org.role === "admin" || s.org.role === "finanzas";

  const [po, items, docs, history, revisions, audit] = await Promise.all([
    sb.from("purchase_orders_overview").select("*").eq("id", id).eq("org_id", s.org.org_id).maybeSingle(),
    sb.from("purchase_order_items").select("*").eq("purchase_order_id", id).order("line_number").order("option_number"),
    sb.from("documents").select("id, title, doc_type, mime_type, size_bytes, created_at, uploaded_by").eq("purchase_order_id", id).order("created_at", { ascending: false }),
    sb.from("purchase_order_status_history").select("id, from_status, to_status, reason, changed_by, changed_at").eq("purchase_order_id", id).order("changed_at", { ascending: false }),
    sb.from("purchase_order_revisions").select("id, revision, changed_by, changed_at").eq("purchase_order_id", id).order("revision", { ascending: false }).limit(50),
    auditAllowed
      ? sb.from("audit_logs").select("id, table_name, action, actor, at, old_data, new_data").eq("org_id", s.org.org_id).eq("table_name", "purchase_order_items").or(`new_data->>purchase_order_id.eq.${id},old_data->>purchase_order_id.eq.${id}`).order("at", { ascending: false }).limit(100)
      : Promise.resolve({ data: [] as never[] }),
  ]);
  if (!po.data) notFound();
  const o = po.data;

  const [profit, itemProfit, allocations, costAllocs, categories, deliveryItems, deliveries] = await Promise.all([
    loadProfitability(sb, s.org.org_id, [id]).then((r) => r[0] ?? null),
    sb.from("po_item_profitability").select("*").eq("purchase_order_id", id).order("line_number").order("option_number").then((r) => r.data ?? []),
    sb.from("purchase_allocations").select("id, quantity, unit_cost, amount, purchase_order_item_id, purchase_items(description, purchases(id, invoice_date, number, point_of_sale, status, suppliers(name)))").eq("purchase_order_id", id).then((r) => r.data ?? []),
    sb.from("cost_allocations").select("id, amount, purchase_order_item_id, costs(id, description, cost_date, status, allocation_method, cost_categories(name, kind))").eq("purchase_order_id", id).then((r) => r.data ?? []),
    sb.from("cost_categories").select("id, name, kind").eq("org_id", s.org.org_id).order("name").then((r) => r.data ?? []),
    loadDeliveryItems(sb, id),
    loadDeliveries(sb, id),
  ]);
  const orderOption = {
    id, label: o.bac_number ?? o.display_number, customer: o.customer_name,
    sales: String(o.net_amount ?? o.items_total ?? "0"),
    units: String((items.data ?? []).reduce((a, x) => a + Number(x.quantity), 0)),
  };

  const actorIds = [...new Set([...(history.data ?? []).map((h) => h.changed_by), ...(revisions.data ?? []).map((r) => r.changed_by), ...(docs.data ?? []).map((d) => d.uploaded_by), o.created_by].filter(Boolean))] as string[];
  const { data: people } = actorIds.length
    ? await sb.from("profiles").select("id, full_name, email").in("id", actorIds)
    : { data: [] };
  const names = Object.fromEntries((people ?? []).map((p) => [p.id, p.full_name || p.email]));
  const original = (docs.data ?? []).find((d) => d.doc_type === "orden_compra");
  const writable = canWrite(s.org.role);

  return (
    <>
      <PageHeader
        breadcrumb={<Link href="/ordenes" className="hover:text-fg">Órdenes</Link>}
        title={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {o.bac_number ?? o.display_number}
            <StatusBadge status={o.status as PoStatus} />
          </span>
        }
        description={
          <span className="flex flex-wrap gap-x-2">
            <span>{o.customer_name ?? "Sin organismo"}</span>
            {o.jurisdiction && <span className="text-fg-subtle">· {o.jurisdiction}</span>}
            <span className="font-mono text-xs text-fg-subtle">· {o.display_number}</span>
          </span>
        }
        actions={
          <>
            {original && <DocumentButton documentId={original.id} label="Ver original" />}
            {writable && <StatusDialog id={o.id} status={o.status as PoStatus} version={o.version} />}
            {writable && <Button asChild variant="secondary"><Link href={`/ordenes/${o.id}/editar`}><Pencil /> Editar</Link></Button>}
          </>
        }
      />
      <OrderTabs
        initialTab={tab}
        po={o}
        items={items.data ?? []}
        documents={(docs.data ?? []).map((d) => ({ ...d, uploader: d.uploaded_by ? names[d.uploaded_by] : null }))}
        history={(history.data ?? []).map((h) => ({ ...h, actor: h.changed_by ? names[h.changed_by] : null }))}
        revisions={(revisions.data ?? []).map((r) => ({ ...r, actor: r.changed_by ? names[r.changed_by] : null }))}
        itemAudit={audit.data ?? []}
        createdBy={o.created_by ? names[o.created_by] : null}
        orgId={s.org.org_id}
        canWrite={writable}
        canDeliver={writable || s.org.role === "logistica"}
        profit={profit}
        itemProfit={itemProfit as never}
        allocations={allocations as never}
        costAllocs={costAllocs as never}
        categories={categories}
        orderOption={orderOption}
        deliveryItems={deliveryItems}
        deliveries={deliveries}
      />
    </>
  );
}
