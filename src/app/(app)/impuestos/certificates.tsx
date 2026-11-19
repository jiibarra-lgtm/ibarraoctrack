import type { SupabaseClient } from "@supabase/supabase-js";
import { ExternalLink, FileCheck2 } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/primitives";
import { formatDate } from "@/lib/format";

type Cert = { id: string; thread_id: string | null; message_id: string; from_email: string; from_name: string | null; subject: string | null; received_at: string; file: string | null };
const gmail = (x: Cert) => `https://mail.google.com/mail/u/0/#all/${x.thread_id ?? x.message_id}`;

/** 28) Certificados de retención que llegaron por mail, juntos para el contador. */
export async function RetentionCertificates({ sb, org }: { sb: SupabaseClient; org: string }) {
  const { data } = await sb.from("retention_certificates").select("*").eq("org_id", org).order("received_at", { ascending: false }).limit(60);
  const certs = (data ?? []) as Cert[];
  return (
    <Card className="mt-5 overflow-hidden">
      <CardHeader title="Certificados de retención recibidos" description="Los adjuntos de retenciones (IIBB, Ganancias, IVA, SUSS, SIRCREB) que te mandaron por mail. Se suman a la planilla mensual del contador." />
      {!certs.length ? <p className="px-5 pb-5 text-sm text-fg-muted">Todavía no llegó ningún certificado por mail.</p> : (
        <ul className="divide-y divide-border">
          {certs.map((c, i) => (
            <li key={`${c.id}-${i}`} className="flex items-center gap-3 px-5 py-2.5 text-sm">
              <FileCheck2 className="size-4 shrink-0 text-accent" />
              <div className="min-w-0 flex-1"><p className="truncate font-medium">{c.file ?? c.subject}</p><p className="truncate text-xs text-fg-subtle">{c.from_name || c.from_email} · {formatDate(c.received_at)}</p></div>
              <a href={gmail(c)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline">Abrir <ExternalLink className="size-3" /></a>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
