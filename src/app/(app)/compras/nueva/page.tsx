import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireOrg, canWrite } from "@/lib/session";
import { PageHeader } from "@/components/ui/primitives";
import { PurchaseForm } from "@/components/purchase/purchase-form";
import { emptyPurchaseItem } from "@/lib/purchase/schema";
import { todayISO } from "@/lib/format";

export const metadata: Metadata = { title: "Nueva compra" };

export default async function NewPurchasePage() {
  const s = await requireOrg();
  if (!canWrite(s.org.role)) redirect("/compras");
  const { data: suppliers } = await s.supabase.from("suppliers").select("id, name, cuit").eq("org_id", s.org.org_id).order("name");
  return (
    <>
      <PageHeader breadcrumb={<Link href="/compras" className="hover:text-fg">Compras</Link>} title="Nueva compra" />
      <PurchaseForm suppliers={suppliers ?? []} defaultValues={{ invoice_date: todayISO(), doc_type: "factura_a", net_amount: "", vat_amount: "", other_taxes: "", total_amount: "", items: [emptyPurchaseItem()] }} />
    </>
  );
}
