import type { Metadata } from "next";
import Link from "next/link";
import { FileSignature } from "lucide-react";
import { requireOrg, canWrite } from "@/lib/session";
import { Card, EmptyState, PageHeader } from "@/components/ui/primitives";
import { formatDateTime } from "@/lib/format";
import type { RemitoRow } from "@/lib/remitos";
import { PhotoButton } from "./photo-button";

export const metadata: Metadata = { title: "Remitos para firmar" };

function daysAgoIso(n: number) {
  return new Date(Date.now() - n * 864e5).toISOString();
}

/** Pantalla pensada para el celular en la calle: remitos sin copia firmada, con un botón de cámara cada uno. */
export default async function SignRemitosPage() {
  const s = await requireOrg();
  const writable = canWrite(s.org.role) || s.org.role === "logistica";
  const since = daysAgoIso(90);
  const { data } = await s.supabase.from("remitos_overview").select("id, label, issued_at, recipient_name, po_number, items_text, units, status")
    .eq("org_id", s.org.org_id).in("status", ["emitido", "entregado"]).gte("issued_at", since).order("issued_at", { ascending: false }).limit(100);
  const rows = (data ?? []) as Pick<RemitoRow, "id" | "label" | "issued_at" | "recipient_name" | "po_number" | "items_text" | "units" | "status">[];

  return (
    <>
      <PageHeader title="Remitos para firmar" description="Sacale una foto al remito firmado y sellado: queda guardado en el remito y en la orden como prueba de entrega." />
      <div className="mb-4 flex gap-2 text-sm">
        <Link href="/remitos" className="text-fg-muted hover:text-fg">← Remitos</Link>
      </div>
      <Card>
        {!rows.length ? <EmptyState icon={<FileSignature />} title="No hay remitos pendientes de firma" description="Los remitos de los últimos 90 días ya tienen su copia firmada." /> : (
          <ul className="divide-y divide-border">
            {rows.map((r) => (
              <li key={r.id} className="flex items-center gap-3 px-4 py-3 sm:px-5">
                <Link href={`/remitos/${r.id}`} className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{r.recipient_name}</p>
                  <p className="truncate text-xs text-fg-subtle"><span className="font-mono">{r.label}</span>{r.po_number ? ` · OC ${r.po_number}` : ""} · {formatDateTime(r.issued_at)}</p>
                  {r.items_text && <p className="truncate text-xs text-fg-subtle">{r.items_text}</p>}
                </Link>
                {writable && <PhotoButton id={r.id} orgId={s.org.org_id} />}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
