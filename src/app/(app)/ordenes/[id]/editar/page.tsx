import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireOrg, canWrite } from "@/lib/session";
import { PageHeader } from "@/components/ui/primitives";
import { PoForm } from "@/components/po/po-form";
import { toFormValues } from "@/lib/po/load";
import { isUuid } from "@/lib/utils";
import { savePurchaseOrder } from "../../actions";

export const metadata: Metadata = { title: "Editar orden" };

export default async function EditOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const s = await requireOrg();
  if (!canWrite(s.org.role)) redirect(`/ordenes/${id}`);

  const [{ data: po }, { data: items }, { data: customers }] = await Promise.all([
    s.supabase.from("purchase_orders_overview").select("*").eq("id", id).eq("org_id", s.org.org_id).maybeSingle(),
    s.supabase.from("purchase_order_items").select("*").eq("purchase_order_id", id),
    s.supabase.from("customers").select("id, name").eq("org_id", s.org.org_id).order("name").limit(500),
  ]);
  if (!po) notFound();
  const title = po.bac_number ?? po.display_number;

  return (
    <>
      <PageHeader
        breadcrumb={<><Link href="/ordenes" className="hover:text-fg">Órdenes</Link> / <Link href={`/ordenes/${id}`} className="hover:text-fg">{title}</Link></>}
        title={`Editar ${title}`}
        description="Los cambios quedan registrados en el historial con una revisión de la versión anterior."
      />
      <PoForm
        defaultValues={toFormValues(po, items ?? [], po.customer_name ?? "")}
        onSave={savePurchaseOrder}
        customers={customers ?? []}
        cancelHref={`/ordenes/${id}`}
        submitLabel="Guardar cambios"
      />
    </>
  );
}
