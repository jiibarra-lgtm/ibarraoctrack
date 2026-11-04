import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowUpRight, Bell, Check, FileText, HandCoins, Mail, Receipt, Truck, Upload, Zap } from "lucide-react";
import { requireOrg } from "@/lib/session";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, PageHeader } from "@/components/ui/primitives";
import { CopyButton } from "@/components/ui/copy-button";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import { loadTrack, type TrackEvent } from "@/lib/bac-track";
import { cn } from "@/lib/utils";

export async function generateMetadata({ params }: { params: Promise<{ oc: string }> }): Promise<Metadata> {
  return { title: decodeURIComponent((await params).oc) };
}

const ICON: Record<TrackEvent["kind"], React.ElementType> = { aviso: Bell, mail: Mail, sistema: Zap, entrega: Truck, factura: Receipt, cobro: HandCoins };

export default async function BacTrackPage({ params }: { params: Promise<{ oc: string }> }) {
  const oc = decodeURIComponent((await params).oc).toUpperCase();
  if (!/^\d{2,5}-\d{3,7}-OC\d{2}$/.test(oc)) notFound();
  const s = await requireOrg();
  const t = await loadTrack(s.supabase, s.org.org_id, oc);
  if (!t) notFound();
  const { inbox, po, steps, timeline, billing } = t;
  const cur = (po?.currency as string) ?? "ARS";
  const doneCount = steps.filter((x) => x.done).length;
  const daysSince = t.daysSince;

  const details: [string, React.ReactNode][] = [
    ["Organismo", po?.customer_name ?? inbox?.unit_name ?? `Unidad ${inbox?.unit_code ?? oc.split("-")[0]}`],
    ["Convenio / proceso", inbox?.convenio_name ?? inbox?.process_name ?? po?.process_number ?? "—"],
    ["N° convenio / proceso", inbox?.convenio_number ?? inbox?.process_number ?? po?.process_number ?? "—"],
    ["Avisada", inbox?.notified_at ? formatDateTime(inbox.notified_at) : "—"],
    ["Perfeccionada", inbox?.perfected_at ? formatDateTime(inbox.perfected_at) : po?.perfected_date ? formatDate(po.perfected_date) : "—"],
    ["PRD", inbox?.prd_number ? `N° ${inbox.prd_number}` : "—"],
    ["Total", po ? formatMoney(po.total_amount ?? po.items_total, cur) : "Sin cargar"],
  ];

  return (
    <>
      <PageHeader
        breadcrumb={<><Link href="/bac" className="hover:text-fg">Órdenes BAC</Link> / {oc}</>}
        title={
          <span className="flex flex-wrap items-center gap-2">
            <span className="grid size-8 place-items-center rounded-lg bg-brand text-brand-fg"><FileText className="size-4" /></span>
            <span className="font-mono">{oc}</span><CopyButton value={oc} />
            {po ? <span className="rounded-full bg-accent-soft px-2.5 py-0.5 text-xs font-medium text-accent">● Cargada</span>
              : <span className="rounded-full bg-warn-soft px-2.5 py-0.5 text-xs font-medium text-warn">● No cargada</span>}
          </span>
        }
        description={`${doneCount} de ${steps.length} pasos completos`}
        actions={po
          ? <Button asChild variant="secondary"><Link href={`/ordenes/${po.id}`}>Ver orden <ArrowUpRight /></Link></Button>
          : <Button asChild><Link href="/ordenes/importar"><Upload /> Cargar esta orden</Link></Button>}
      />

      {/* Barra de pasos */}
      <Card className="mb-5 overflow-x-auto">
        <CardBody>
          <ol className="flex min-w-[680px] items-start">
            {steps.map((st, i) => (
              <li key={st.key} className="flex flex-1 items-start">
                <div className="flex flex-col items-center gap-1.5 text-center">
                  <span className={cn("grid size-7 place-items-center rounded-full border-2", st.done ? "border-brand bg-brand text-brand-fg" : st.note ? "border-brand bg-field text-brand" : "border-border bg-field text-fg-subtle")}>
                    {st.done ? <Check className="size-4" /> : <span className="text-[10px] font-semibold">{st.note ?? i + 1}</span>}
                  </span>
                  <span className={cn("text-xs font-medium", !st.done && "text-fg-muted")}>{st.label}</span>
                  <span className="text-[11px] tabular text-fg-subtle">{st.at ? formatDate(st.at) : "—"}</span>
                </div>
                {i < steps.length - 1 && <span className={cn("mx-1 mt-3.5 h-0.5 flex-1 rounded-full", steps[i + 1].done || st.done ? "bg-brand" : "bg-border")} />}
              </li>
            ))}
          </ol>
        </CardBody>
      </Card>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Card className="min-w-0">
          <CardHeader title="Qué pasó" description="Cada aviso, mail y movimiento del sistema, en orden" />
          <CardBody>
            {!timeline.length ? <p className="text-sm text-fg-subtle">Sin movimientos todavía.</p> : (
              <ol className="relative flex flex-col gap-5 before:absolute before:bottom-2 before:left-[15px] before:top-2 before:w-px before:bg-border">
                {timeline.map((e, i) => {
                  const Icon = ICON[e.kind];
                  const inner = (
                    <>
                      <span className={cn("relative z-10 grid size-8 shrink-0 place-items-center rounded-lg", e.kind === "mail" ? "bg-field text-fg-muted border border-card-border" : "bg-brand text-brand-fg")}><Icon className="size-4" /></span>
                      <div className="min-w-0 pt-0.5">
                        <p className="text-sm font-medium">{e.title} <span className="ml-1 text-xs font-normal text-fg-subtle tabular">{formatDateTime(e.at)}</span></p>
                        {e.detail && <p className="mt-0.5 line-clamp-2 text-xs text-fg-muted">{e.detail}</p>}
                        {!!e.tags?.length && (
                          <div className="mt-1.5 flex flex-wrap gap-1.5">
                            {e.tags.map((tg) => <span key={tg} className="rounded-md border border-card-border bg-field px-1.5 py-0.5 text-[11px] text-fg-muted">{tg}</span>)}
                          </div>
                        )}
                      </div>
                    </>
                  );
                  return <li key={i}>{e.href ? <Link href={e.href} className="flex gap-3 rounded-lg hover:bg-surface-2/50">{inner}</Link> : <div className="flex gap-3">{inner}</div>}</li>;
                })}
              </ol>
            )}
          </CardBody>
        </Card>

        <div className="flex flex-col gap-5">
          <Card>
            <CardHeader title="Detalles" />
            <dl className="divide-y divide-border">
              {details.map(([k, v]) => (
                <div key={k} className="flex items-start justify-between gap-3 px-4 py-2.5 text-sm sm:px-5">
                  <dt className="shrink-0 text-xs text-fg-subtle">{k}</dt><dd className="text-right">{v}</dd>
                </div>
              ))}
            </dl>
          </Card>
          <Card>
            <CardHeader title="Vinculado" />
            <ul className="divide-y divide-border text-sm">
              <li className="flex items-center justify-between px-4 py-2.5 sm:px-5"><span className="text-fg-muted">Orden en el sistema</span>
                {po ? <Link href={`/ordenes/${po.id}`} className="font-medium text-brand hover:underline">{po.display_number}</Link> : <Link href="/ordenes/importar" className="font-medium text-warn hover:underline">Cargar</Link>}</li>
              <li className="flex items-center justify-between px-4 py-2.5 sm:px-5"><span className="text-fg-muted">Correos</span>
                <Link href={`/correos?q=${oc}`} className="font-medium hover:underline">{t.mails.length}</Link></li>
              <li className="flex items-center justify-between px-4 py-2.5 sm:px-5"><span className="text-fg-muted">Entregado</span><span className="tabular">{t.deliveredPct.toFixed(0)}%</span></li>
            </ul>
          </Card>
          <Card>
            <CardHeader title="Resultado" />
            <CardBody className="grid grid-cols-2 gap-4">
              <div><p className="text-xl font-semibold tabular">{formatMoney(billing?.collected_amount ?? 0, cur)}</p><p className="text-xs text-fg-subtle">Cobrado</p></div>
              <div><p className="text-xl font-semibold tabular">{formatMoney(billing?.to_collect ?? 0, cur)}</p><p className="text-xs text-fg-subtle">Por cobrar</p></div>
              <div><p className="text-xl font-semibold tabular">{Number(billing?.invoiced_pct ?? 0).toFixed(0)}%</p><p className="text-xs text-fg-subtle">Facturado</p></div>
              <div><p className="text-xl font-semibold tabular">{daysSince ?? "—"}</p><p className="text-xs text-fg-subtle">Días desde el aviso</p></div>
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}
