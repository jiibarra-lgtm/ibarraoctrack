import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireOrg, canWrite } from "@/lib/session";
import { PageHeader } from "@/components/ui/primitives";
import { isUuid } from "@/lib/utils";
import type { ExtractedOrder } from "@/lib/bac/types";
import { emptyPurchaseOrder } from "@/lib/po/schema";
import { ImportReview } from "./import-review";
import { JobProgress } from "./job-progress";

export const metadata: Metadata = { title: "Revisar importación" };

export default async function ImportJobPage({ params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  if (!isUuid(jobId)) notFound();
  const s = await requireOrg();
  if (!canWrite(s.org.role)) redirect("/ordenes");

  const { data: job } = await s.supabase
    .from("import_jobs")
    .select("id, status, attempts, max_attempts, last_error, result_purchase_order_id, document_id, documents(id, title, mime_type, storage_path)")
    .eq("id", jobId).eq("org_id", s.org.org_id).maybeSingle();
  if (!job) notFound();
  if (job.status === "confirmado" && job.result_purchase_order_id) redirect(`/ordenes/${job.result_purchase_order_id}`);

  const doc = job.documents as unknown as { id: string; title: string; mime_type: string; storage_path: string };
  const header = (
    <PageHeader
      breadcrumb={<><Link href="/ordenes" className="hover:text-fg">Órdenes</Link> / <Link href="/ordenes/importar" className="hover:text-fg">Importar</Link></>}
      title="Revisar importación"
      description={doc.title}
    />
  );

  if (job.status !== "revision") {
    return (<>{header}<JobProgress jobId={job.id} status={job.status} attempts={job.attempts} maxAttempts={job.max_attempts} error={job.last_error} /></>);
  }

  const [{ data: extracted }, { data: signed }, { data: customers }] = await Promise.all([
    s.supabase.from("extracted_document_data").select("extractor, method, data, warnings").eq("import_job_id", job.id).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    s.supabase.storage.from("documents").createSignedUrl(doc.storage_path, 60 * 30),
    s.supabase.from("customers").select("id, name").eq("org_id", s.org.org_id).order("name").limit(500),
  ]);

  const data = (extracted?.data ?? {}) as { order?: ExtractedOrder["order"]; review?: string[] };
  return (
    <>
      {header}
      <ImportReview
        jobId={job.id}
        order={{ ...emptyPurchaseOrder(), ...(data.order ?? {}) }}
        review={data.review ?? []}
        warnings={(extracted?.warnings ?? []) as ExtractedOrder["warnings"]}
        extractor={extracted?.extractor ?? null}
        method={extracted?.method ?? null}
        documentUrl={signed?.signedUrl ?? null}
        mimeType={doc.mime_type}
        customers={customers ?? []}
      />
    </>
  );
}
