import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, BellOff, ChevronRight, CircleAlert, Info } from "lucide-react";
import { requireOrg } from "@/lib/session";
import { Card, EmptyState, PageHeader } from "@/components/ui/primitives";
import { formatMoney } from "@/lib/format";
import { computeAlerts, KIND_LABEL, type AlertKind } from "@/lib/alerts";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Alertas" };

const ICON = { danger: CircleAlert, warn: AlertTriangle, info: Info } as const;
const TONE = { danger: "text-danger", warn: "text-warn", info: "text-brand" } as const;

export default async function AlertsPage({ searchParams }: { searchParams: Promise<{ tipo?: string }> }) {
  const { tipo } = await searchParams;
  const s = await requireOrg();
  const all = await computeAlerts(s.supabase, s.org.org_id);
  const counts = new Map<AlertKind, number>();
  all.forEach((a) => counts.set(a.kind, (counts.get(a.kind) ?? 0) + 1));
  const shown = tipo ? all.filter((a) => a.kind === tipo) : all;
  const nDanger = all.filter((a) => a.level === "danger").length;

  return (
    <>
      <PageHeader title="Alertas" description={all.length ? `${all.length} avisos · ${nDanger} urgentes. Se calculan solos con tus datos.` : "Se calculan solas con tus datos."} />
      <div className="mb-4 flex flex-wrap gap-1.5">
        <Link href="/alertas" className={cn("rounded-full px-3 py-1 text-xs font-medium", !tipo ? "bg-primary text-primary-fg" : "bg-field text-fg-muted hover:text-fg")}>Todas · {all.length}</Link>
        {[...counts.entries()].map(([k, n]) => (
          <Link key={k} href={`/alertas?tipo=${k}`} className={cn("rounded-full px-3 py-1 text-xs font-medium", tipo === k ? "bg-primary text-primary-fg" : "bg-field text-fg-muted hover:text-fg")}>{KIND_LABEL[k]} · {n}</Link>
        ))}
      </div>
      <Card className="overflow-hidden">
        {!shown.length ? <EmptyState icon={<BellOff />} title="Todo en orden" description="No hay entregas atrasadas, facturas vencidas ni documentación faltante." /> : (
          <ul className="divide-y divide-border">
            {shown.map((a) => {
              const Icon = ICON[a.level];
              return (
                <li key={a.id}>
                  <Link href={a.href} className="flex items-center gap-3 px-4 py-3 hover:bg-surface-2/60 sm:px-5">
                    <Icon className={cn("size-5 shrink-0", TONE[a.level])} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{a.title}</p>
                      <p className="truncate text-xs text-fg-subtle">{KIND_LABEL[a.kind]} · {a.detail}</p>
                    </div>
                    {a.amount && <span className="hidden text-sm font-medium tabular sm:block">{formatMoney(a.amount)}</span>}
                    <ChevronRight className="size-4 shrink-0 text-fg-subtle" />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </>
  );
}
