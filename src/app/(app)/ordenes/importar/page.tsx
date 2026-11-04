import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CheckCircle2, CircleAlert, Clock, Loader2, ScanSearch, XCircle } from "lucide-react";
import { requireOrg, canWrite } from "@/lib/session";
import { Badge, Card, CardHeader, EmptyState, PageHeader } from "@/components/ui/primitives";
import { formatDateTime } from "@/lib/format";
import { aiAvailable } from "@/lib/bac/ai";
import { Uploader } from "./uploader";

export const metadata: Metadata = { title: "Importar orden BAC" };

const STATUS: Record<string, { label: string; tone: "neutral" | "warn" | "accent" | "danger" | "primary"; icon: React.ReactNode }> = {
  pendiente: { label: "Pendiente", tone: "neutral", icon: <Clock className="size-3" /> },
  procesando: { label: "Leyendo", tone: "primary", icon: <Loader2 className="size-3 animate-spin" /> },
  revision: { label: "Para revisar", tone: "warn", icon: <ScanSearch className="size-3" /> },
  confirmado: { label: "Importada", tone: "accent", icon: <CheckCircle2 className="size-3" /> },
  error: { label: "Error", tone: "danger", icon: <CircleAlert className="size-3" /> },
  descartado: { label: "Descartada", tone: "neutral", icon: <XCircle className="size-3" /> },
};

export default async function ImportPage() {
  const s = await requireOrg();
  if (!canWrite(s.org.role)) redirect("/ordenes");
  const { data: jobs } = await s.supabase
    .from("import_jobs")
    .select("id, status, created_at, last_error, result_purchase_order_id, documents(title, mime_type)")
    .eq("org_id", s.org.org_id)
    .order("created_at", { ascending: false })
    .limit(30);

  return (
    <>
      <PageHeader
        breadcrumb={<Link href="/ordenes" className="hover:text-fg">Órdenes</Link>}
        title="Importar orden de BAC"
        description="Subí la captura de “Ver documento contractual” o el PDF. Extraemos los datos, verificamos las cuentas y vos confirmás antes de guardar."
      />
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
        <Uploader orgId={s.org.org_id} aiEnabled={aiAvailable()} />
        <Card className="self-start">
          <CardHeader title="Importaciones recientes" />
          {!jobs?.length ? (
            <EmptyState title="Sin importaciones todavía" />
          ) : (
            <ul className="divide-y divide-border">
              {jobs.map((j) => {
                const st = STATUS[j.status] ?? STATUS.pendiente;
                const doc = j.documents as unknown as { title: string } | null;
                const href = j.status === "confirmado" && j.result_purchase_order_id ? `/ordenes/${j.result_purchase_order_id}` : `/ordenes/importar/${j.id}`;
                return (
                  <li key={j.id}>
                    <Link href={href} className="flex items-center gap-3 px-4 py-3 hover:bg-surface-2/60">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm">{doc?.title ?? "Documento"}</p>
                        <p className="truncate text-xs text-fg-subtle">{formatDateTime(j.created_at)}{j.status === "error" && j.last_error ? ` · ${j.last_error}` : ""}</p>
                      </div>
                      <Badge tone={st.tone}>{st.icon}{st.label}</Badge>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
