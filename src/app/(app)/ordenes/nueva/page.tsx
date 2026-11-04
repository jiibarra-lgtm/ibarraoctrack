import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireOrg, canWrite } from "@/lib/session";
import { PageHeader } from "@/components/ui/primitives";
import { PoForm } from "@/components/po/po-form";
import { emptyPurchaseOrder } from "@/lib/po/schema";
import { savePurchaseOrder } from "../actions";

export const metadata: Metadata = { title: "Nueva orden" };

export default async function NewOrderPage() {
  const s = await requireOrg();
  if (!canWrite(s.org.role)) redirect("/ordenes");
  const { data: customers } = await s.supabase.from("customers").select("id, name").eq("org_id", s.org.org_id).order("name").limit(500);

  return (
    <>
      <PageHeader
        breadcrumb={<Link href="/ordenes" className="hover:text-fg">Órdenes</Link>}
        title="Nueva orden de compra"
        description={<>Carga manual. Si tenés el documento de BAC, es más rápido <Link className="text-primary hover:underline" href="/ordenes/importar">importarlo</Link>.</>}
      />
      <PoForm defaultValues={emptyPurchaseOrder()} onSave={savePurchaseOrder} customers={customers ?? []} cancelHref="/ordenes" submitLabel="Crear orden" />
    </>
  );
}
