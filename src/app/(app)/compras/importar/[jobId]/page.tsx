import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireOrg, canWrite } from "@/lib/session";
import { Card, CardHeader, PageHeader } from "@/components/ui/primitives";
import { PurchaseForm } from "@/components/purchase/purchase-form";
import { JobProgress } from "@/app/(app)/ordenes/importar/[jobId]/job-progress";
import { emptyPurchaseItem, type PurchaseInput } from "@/lib/purchase/schema";
import type { InvoiceDraft } from "@/lib/invoice/parse";
import type { Suggestion } from "../../actions";
import { isUuid } from "@/lib/utils";
import { todayISO } from "@/lib/format";

export const metadata: Metadata = { title: "Revisar factura" };

export default async function InvoiceJobPage({ params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  if (!isUuid(jobId)) notFound();
  const s = await requireOrg();
  if (!canWrite(s.org.role)) redirect("/compras");
  const { data: job } = await s.supabase.from("import_jobs")
    .select("id, status, attempts, max_attempts, last_error, document_id, documents(id, title, mime_type, storage_path, purchase_id)")
    .eq("id", jobId).eq("org_id", s.org.org_id).eq("kind", "factura_proveedor").maybeSingle();
  if (!job) notFound();
  const doc = job.documents as unknown as { id: string; title: string; mime_type: string; storage_path: string; purchase_id: string | null };
  if (job.status === "confirmado" && doc.purchase_id) redirect(`/compras/${doc.purchase_id}`);
  const header = <PageHeader breadcrumb={<Link href="/compras" className="hover:text-fg">Compras</Link>} title="Revisar factura" description={doc.title} />;
  if (job.status !== "revision") return <>{header}<JobProgress jobId={job.id} status={job.status} attempts={job.attempts} maxAttempts={job.max_attempts} error={job.last_error} /></>;

  const [{ data: ex }, { data: signed }, { data: suppliers }] = await Promise.all([
    s.supabase.from("extracted_document_data").select("data, warnings").eq("import_job_id", job.id).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    s.supabase.storage.from("documents").createSignedUrl(doc.storage_path, 1800),
    s.supabase.from("suppliers").select("id, name, cuit").eq("org_id", s.org.org_id).order("name"),
  ]);
  const data = (ex?.data ?? {}) as { invoice?: InvoiceDraft; review?: string[]; suggestions?: Record<number, Suggestion[]> };
  const inv = data.invoice;
  const supplier = inv?.supplier_cuit ? suppliers?.find((x) => x.cuit?.replace(/\D/g, "") === inv.supplier_cuit.replace(/\D/g, "")) : undefined;
  const defaults: PurchaseInput = {
    supplier_id: supplier?.id ?? "", supplier_name: supplier?.name ?? inv?.supplier_name ?? "", supplier_cuit: inv?.supplier_cuit ?? "",
    doc_type: inv?.doc_type ?? "factura_a", point_of_sale: inv?.point_of_sale ?? "", number: inv?.number ?? "",
    invoice_date: inv?.invoice_date || todayISO(), due_date: inv?.due_date ?? "", net_amount: inv?.net_amount ?? "",
    vat_amount: inv?.vat_amount ?? "", other_taxes: inv?.other_taxes ?? "", total_amount: inv?.total_amount ?? "",
    cae: inv?.cae ?? "", document_id: doc.id, import_job_id: job.id,
    items: inv?.items?.length ? inv.items.map((it, i) => {
      const best = data.suggestions?.[i]?.[0];
      // Sólo se pre-vincula una equivalencia ya confirmada antes; lo demás queda como sugerencia
      const allocations = best?.by_alias && best.score >= 0.6
        ? [{ purchase_order_item_id: best.purchase_order_item_id, label: `${best.order_label} · R${best.line_number}`, quantity: String(Math.min(Number(it.quantity), Number(best.remaining))) }]
        : [];
      return { ...it, allocations };
    }) : [emptyPurchaseItem()],
  };
  const isImage = doc.mime_type.startsWith("image/");
  const aside = (
    <Card className="overflow-hidden">
      <CardHeader title="Comprobante original" />
      <div className="max-h-[50vh] overflow-auto bg-surface-2 xl:max-h-[calc(100dvh-180px)]">
        {signed?.signedUrl && (isImage
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={signed.signedUrl} alt="Factura" className="block w-full" />
          : <iframe src={signed.signedUrl} title="Factura" className="h-[70vh] w-full" />)}
      </div>
    </Card>
  );
  return (
    <>
      {header}
      <PurchaseForm defaultValues={defaults} suppliers={suppliers ?? []} review={data.review} initialSuggestions={data.suggestions}
        warnings={((ex?.warnings ?? []) as { message: string }[]).map((w) => w.message)} aside={aside} submitLabel="Confirmar compra" />
    </>
  );
}
