import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle } from "lucide-react";
import { requireOrg } from "@/lib/session";
import { Card, CardBody, CardHeader, PageHeader } from "@/components/ui/primitives";
import { JobProgress } from "@/app/(app)/ordenes/importar/[jobId]/job-progress";
import { DeliveryForm } from "@/components/delivery/delivery-form";
import { loadDeliveryItems } from "@/lib/delivery-load";
import type { RemitoReading } from "@/lib/remito/parse";
import { isUuid } from "@/lib/utils";

export const metadata: Metadata = { title: "Confirmar remito" };

export default async function RemitoJobPage({ params, searchParams }: { params: Promise<{ jobId: string }>; searchParams: Promise<{ oc?: string }> }) {
  const { jobId } = await params;
  const { oc } = await searchParams;
  if (!isUuid(jobId)) notFound();
  const s = await requireOrg();
  const { data: job } = await s.supabase.from("import_jobs").select("id, status, attempts, max_attempts, last_error, documents(id, title, mime_type, storage_path, delivery_id, purchase_order_id)")
    .eq("id", jobId).eq("org_id", s.org.org_id).eq("kind", "remito").maybeSingle();
  if (!job) notFound();
  const doc = job.documents as unknown as { id: string; title: string; mime_type: string; storage_path: string; delivery_id: string | null; purchase_order_id: string | null };
  const header = <PageHeader breadcrumb={<Link href="/entregas" className="hover:text-fg">Entregas</Link>} title="Confirmar remito" description={doc.title} />;
  if (job.status === "confirmado") {
    return <>{header}<Card><CardBody className="text-sm">Remito ya registrado. {doc.purchase_order_id && <Link className="text-primary hover:underline" href={`/ordenes/${doc.purchase_order_id}?tab=entregas`}>Ver entregas de la orden</Link>}</CardBody></Card></>;
  }
  if (job.status !== "revision") return <>{header}<JobProgress jobId={job.id} status={job.status} attempts={job.attempts} maxAttempts={job.max_attempts} error={job.last_error} /></>;

  const [{ data: ex }, { data: signed }] = await Promise.all([
    s.supabase.from("extracted_document_data").select("data, warnings").eq("import_job_id", job.id).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    s.supabase.storage.from("documents").createSignedUrl(doc.storage_path, 1800),
  ]);
  const r = ((ex?.data ?? {}) as { remito?: RemitoReading & { purchase_order_id: string | null } }).remito;
  const poId = (oc && isUuid(oc) ? oc : null) ?? r?.purchase_order_id ?? null;
  const warnings = ((ex?.warnings ?? []) as { message: string }[]).map((w) => w.message);

  let body: React.ReactNode;
  if (!poId) {
    const { data: orders } = await s.supabase.from("purchase_orders_overview").select("id, bac_number, display_number, customer_name").eq("org_id", s.org.org_id).not("status", "in", "(anulada,cerrada,borrador)").order("issue_date", { ascending: false }).limit(100);
    body = (
      <Card>
        <CardHeader title="¿De qué orden es este remito?" />
        <ul className="divide-y divide-border">
          {(orders ?? []).map((o) => <li key={o.id}><Link href={`/entregas/remito/${job.id}?oc=${o.id}`} className="block px-4 py-3 text-sm hover:bg-surface-2/60 sm:px-5"><span className="font-medium">{o.bac_number ?? o.display_number}</span> <span className="text-fg-subtle">· {o.customer_name}</span></Link></li>)}
        </ul>
      </Card>
    );
  } else {
    const [items, { data: po }] = await Promise.all([
      loadDeliveryItems(s.supabase, poId),
      s.supabase.from("purchase_orders_overview").select("bac_number, display_number, customer_name, delivery_place").eq("id", poId).maybeSingle(),
    ]);
    const quantities = Object.fromEntries((r?.lines ?? []).filter((l) => items.some((i) => i.id === l.purchase_order_item_id)).map((l) => [l.purchase_order_item_id, l.quantity]));
    body = (
      <Card>
        <CardHeader title={`Entrega de ${po?.bac_number ?? po?.display_number}`} description={po?.customer_name ?? undefined} />
        <CardBody>
          <DeliveryForm poId={poId} items={items} jobId={job.id} submitLabel="Registrar entrega"
            defaults={{ status: "entregada", remito_number: r?.remito_number ?? "", actual_date: r?.date ?? "", delivery_place: po?.delivery_place ?? "", quantities }} />
        </CardBody>
      </Card>
    );
  }

  return (
    <>
      {header}
      {warnings.length > 0 && (
        <Card className="mb-5 border-warn/40 bg-warn-soft/40"><CardBody className="flex flex-col gap-1 text-sm">{warnings.map((w, i) => <p key={i} className="flex gap-2"><AlertTriangle className="mt-0.5 size-4 shrink-0 text-warn" />{w}</p>)}</CardBody></Card>
      )}
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="min-w-0">{body}</div>
        <Card className="self-start overflow-hidden xl:sticky xl:top-20">
          <CardHeader title="Remito" />
          <div className="max-h-[60vh] overflow-auto bg-surface-2">
            {signed?.signedUrl && (doc.mime_type.startsWith("image/")
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={signed.signedUrl} alt="Remito" className="block w-full" />
              : <iframe src={signed.signedUrl} title="Remito" className="h-[60vh] w-full" />)}
          </div>
        </Card>
      </div>
    </>
  );
}
