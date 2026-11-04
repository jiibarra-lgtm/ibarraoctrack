import type { Metadata } from "next";
import Link from "next/link";
import { requireOrg } from "@/lib/session";
import { PageHeader } from "@/components/ui/primitives";
import { DocUploader } from "@/components/doc-uploader";
import { isUuid } from "@/lib/utils";

export const metadata: Metadata = { title: "Leer remito" };

export default async function RemitoUploadPage({ searchParams }: { searchParams: Promise<{ oc?: string }> }) {
  const { oc } = await searchParams;
  const s = await requireOrg();
  const poId = oc && isUuid(oc) ? oc : undefined;
  const { data: po } = poId ? await s.supabase.from("purchase_orders_overview").select("bac_number, display_number").eq("id", poId).maybeSingle() : { data: null };
  return (
    <>
      <PageHeader breadcrumb={poId ? <Link href={`/ordenes/${poId}?tab=entregas`} className="hover:text-fg">{po?.bac_number ?? po?.display_number}</Link> : <Link href="/entregas" className="hover:text-fg">Entregas</Link>}
        title="Leer remito firmado" description="Sacale una foto al remito: identificamos la orden, los renglones y las cantidades. Vos confirmás antes de registrar." />
      <div className="max-w-2xl">
        <DocUploader orgId={s.org.org_id} kind="remito" purchaseOrderId={poId} folder="remitos"
          title="Foto o PDF del remito" hint="Que se lean bien los números y el código o la descripción de cada producto."
          jobHref={(id) => `/entregas/remito/${id}`} />
      </div>
    </>
  );
}
