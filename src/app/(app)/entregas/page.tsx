import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, CalendarClock, FileWarning, CheckCircle2, ChevronRight, ClipboardCheck, ListTodo, ScanLine, Truck } from "lucide-react";
import { requireOrg } from "@/lib/session";
import { Button } from "@/components/ui/button";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui/primitives";
import { Stat } from "@/components/ui/stat";
import { DELIVERY_STATUS_LABEL, DELIVERY_TONE, deliveryNumber, type DeliveryStatus } from "@/lib/delivery";
import { formatDate, todayISO } from "@/lib/format";
import { cn } from "@/lib/utils";
import { CopyButton } from "@/components/copy-button";

export const metadata: Metadata = { title: "Entregas" };

const daysAgo = (n: number) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
type BoardRow = { oc_refs: string[]; status: string; delivered_on: string | null; note: string | null };
type Filter = "todas" | "atrasadas" | "para-llevar" | "registrar" | "sin-lista" | "sin-doc";
type Missing = { id: string; place: string; note: string | null; status: string; delivered_on: string | null; missing: { number: string; in_bac: boolean }[] };
const FILTERS: [Filter, string][] = [["todas", "Todas"], ["atrasadas", "Atrasadas"], ["para-llevar", "En Entregas pendientes"], ["registrar", "Llevadas, falta registrar"], ["sin-lista", "Sin cargar en la lista"], ["sin-doc", "Falta el documento de la OC"]];

function Section({ title, description, action, children, className }: { title: string; description?: string; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <Card className={cn("overflow-hidden", className)}>
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border px-5 py-4 sm:px-6">
        <div className="min-w-0">
          <h2 className="text-base font-semibold">{title}</h2>
          {description && <p className="mt-0.5 text-sm text-fg-subtle">{description}</p>}
        </div>
        {action}
      </div>
      {children}
    </Card>
  );
}

export default async function DeliveriesPage({ searchParams }: { searchParams: Promise<{ f?: string }> }) {
  const sp = await searchParams;
  const f: Filter = FILTERS.some(([k]) => k === sp.f) ? (sp.f as Filter) : "todas";
  const s = await requireOrg();
  const org = s.org.org_id;
  const today = todayISO();
  const [{ data: deliveries }, { data: summary }, { data: orders }, { data: board }, { data: miss }] = await Promise.all([
    s.supabase.from("deliveries").select("id, internal_number, status, planned_date, actual_date, remito_number, purchase_order_id")
      .eq("org_id", org).order("created_at", { ascending: false }).limit(200),
    s.supabase.from("po_delivery_summary").select("purchase_order_id, due_date, delivered_pct, next_planned_date, is_late").eq("org_id", org),
    s.supabase.from("purchase_orders_overview").select("id, bac_number, display_number, customer_name, dependencia, status").eq("org_id", org).not("status", "in", "(anulada,cerrada,borrador)"),
    s.supabase.from("delivery_board").select("oc_refs, status, delivered_on, note").eq("org_id", org).order("delivered_on", { ascending: false, nullsFirst: true }).limit(3000),
    s.supabase.from("delivery_board_overview").select("id, place, note, status, delivered_on, missing").eq("org_id", org).neq("missing", "[]").order("status", { ascending: false }).order("delivered_on", { ascending: false }).limit(500),
  ]);
  const missingRows = ((miss ?? []) as Missing[]).filter((m) => m.missing.length);
  const missingPending = missingRows.filter((m) => m.status === "pendiente");

  const boardRows = (board ?? []) as BoardRow[];
  const boardOf = new Map<string, BoardRow[]>();
  for (const b of boardRows) for (const r of b.oc_refs) boardOf.set(r, [...(boardOf.get(r) ?? []), b]);
  const po = new Map((orders ?? []).map((o) => [o.id, o]));
  const sum = new Map((summary ?? []).map((x) => [x.purchase_order_id, x]));
  const label = (id: string) => { const o = po.get(id); return o ? (o.bac_number ?? o.display_number) : "Orden"; };

  const open = (orders ?? []).filter((o) => Number(sum.get(o.id)?.delivered_pct ?? 0) < 100).map((o) => {
    const x = sum.get(o.id);
    const bs = boardOf.get((o.bac_number ?? "").toUpperCase()) ?? [];
    const pend = bs.find((b) => b.status === "pendiente"), done = bs.find((b) => b.status === "entregado");
    const state: Filter = pend ? "para-llevar" : done ? "registrar" : "sin-lista";
    return { o, pct: Number(x?.delivered_pct ?? 0), due: x?.due_date as string | null, late: Boolean(x?.is_late), state, pend, done };
  }).sort((a, b) => Number(b.late) - Number(a.late) || String(a.due ?? "9").localeCompare(String(b.due ?? "9")));
  const count = (k: Filter) => (k === "todas" ? open.length + missingPending.length : k === "sin-doc" ? missingRows.length : k === "atrasadas" ? open.filter((r) => r.late).length : open.filter((r) => r.state === k).length);
  const shown = f === "todas" ? open : f === "atrasadas" ? open.filter((r) => r.late) : open.filter((r) => r.state === f);

  const upcoming = (deliveries ?? []).filter((d) => ["programada", "en_preparacion", "despachada"].includes(d.status));
  const recent = (deliveries ?? []).filter((d) => !["programada", "en_preparacion", "despachada"].includes(d.status)).slice(0, 12);
  const toCarry = boardRows.filter((b) => b.status === "pendiente").length;
  const week = daysAgo(7);
  const carriedWeek = boardRows.filter((b) => b.status === "entregado" && b.delivered_on && b.delivered_on > week).length;

  return (
    <>
      <PageHeader title="Entregas" description="Qué falta llevar, qué está atrasado y qué ya se entregó, con cada orden de compra."
        actions={<>
          <Button asChild><Link href="/entregas/pendientes"><ListTodo /> Entregas pendientes</Link></Button>
          <Button asChild variant="secondary"><Link href="/entregas/remito"><ScanLine /> Leer remito</Link></Button>
        </>} />

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
        <Stat icon={ListTodo} label="Para llevar" value={String(toCarry)} sub="en Entregas pendientes" href="/entregas/pendientes" />
        <Stat icon={AlertTriangle} label="OC atrasadas" value={String(count("atrasadas"))} tone={count("atrasadas") ? "danger" : undefined} sub="fecha límite vencida" href="/entregas?f=atrasadas" />
        <Stat icon={ClipboardCheck} label="Llevadas, falta registrar" value={String(count("registrar"))} tone={count("registrar") ? "warn" : undefined} sub="entregadas, pero la OC no lo sabe" href="/entregas?f=registrar" />
        <Stat icon={FileWarning} label="Falta el documento de la OC" value={String(missingRows.reduce((a, m) => a + m.missing.length, 0))} tone={missingRows.length ? "danger" : undefined} sub={`${missingPending.length} todavía para llevar`} href="/entregas?f=sin-doc" />
        <Stat icon={CheckCircle2} label="Llevadas esta semana" value={String(carriedWeek)} tone="accent" sub="últimos 7 días" href="/entregas/pendientes" />
      </div>

      <Section className="mt-6" title={`Órdenes con entregas pendientes (${open.length})`}
        description="Cada OC con lo que dice tu lista de Entregas pendientes. Tocá una para registrar la entrega en la orden.">
        <div className="flex gap-2 overflow-x-auto border-b border-border px-5 py-3 sm:px-6">
          {FILTERS.map(([k, l]) => (
            <Link key={k} href={k === "todas" ? "/entregas" : `/entregas?f=${k}`}
              className={cn("shrink-0 rounded-full px-3 py-1.5 text-xs font-medium", f === k ? "bg-primary text-primary-fg" : "bg-field text-fg-muted hover:text-fg")}>
              {l} · {count(k)}
            </Link>
          ))}
        </div>
        {(f === "todas" || f === "sin-doc") && (f === "sin-doc" ? missingRows : missingPending).length > 0 && (
          <ul className="divide-y divide-border border-b border-border">
            {(f === "sin-doc" ? missingRows : missingPending).map((m) => (
              <li key={m.id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:gap-6 sm:px-6">
                <div className="min-w-0 flex-1 space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    {m.missing.map((x) => <span key={x.number} className="inline-flex items-center gap-1.5"><span className="font-semibold tabular">{x.number}</span><CopyButton text={x.number} /></span>)}
                    <Badge tone="danger">Falta el documento de la OC</Badge>
                    {m.status === "pendiente" ? <Badge tone="warn">Para llevar</Badge> : <Badge tone="accent">Llevada el {formatDate(m.delivered_on)}</Badge>}
                  </div>
                  <p className="truncate text-sm text-fg-muted">{m.place}</p>
                  {m.note && <p className="line-clamp-2 text-sm">{m.note}</p>}
                </div>
                <div className="flex shrink-0 gap-2">
                  {m.missing.some((x) => x.in_bac) && <Button asChild size="sm" variant="secondary"><Link href={`/bac?f=todas&q=${encodeURIComponent(m.missing[0].number)}`}>Ver en Órdenes BAC</Link></Button>}
                  <Button asChild size="sm"><Link href="/ordenes/importar">Subir la OC</Link></Button>
                </div>
              </li>
            ))}
          </ul>
        )}
        {f === "sin-doc" ? null : !shown.length && !(f === "todas" && missingPending.length) ? <EmptyState icon={<Truck />} title={f === "todas" ? "Todo entregado" : "Nada en este filtro"} /> : (
          <ul className="divide-y divide-border">
            {shown.map(({ o, pct, due, late, state, pend, done }) => (
              <li key={o.id}>
                <Link href={`/ordenes/${o.id}?tab=entregas`} className="group flex flex-col gap-3 px-5 py-4 hover:bg-surface-2/50 sm:flex-row sm:items-center sm:gap-6 sm:px-6">
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold tabular">{o.bac_number ?? o.display_number}</span>
                      <CopyButton text={String(o.bac_number ?? o.display_number)} />
                      {late && <Badge tone="danger">Atrasada</Badge>}
                      {state === "para-llevar" && <Badge tone="warn">Para llevar</Badge>}
                      {state === "registrar" && <Badge tone="accent">Llevada el {formatDate(done!.delivered_on)}</Badge>}
                      {state === "sin-lista" && <Badge>Sin cargar en la lista</Badge>}
                    </div>
                    <p className="truncate text-sm text-fg-muted">{o.dependencia || o.customer_name}</p>
                    {(pend?.note || done?.note) && <p className="line-clamp-2 text-sm">{(pend ?? done)!.note}</p>}
                    {state === "registrar" && <p className="text-xs text-warn">Registrá la entrega en la OC para que el % se actualice.</p>}
                  </div>
                  <div className="flex items-center gap-4 sm:w-64 sm:justify-end">
                    <div className="flex-1 sm:w-40 sm:flex-none">
                      <div className="flex justify-between text-xs text-fg-subtle"><span>{due ? `límite ${formatDate(due)}` : "sin fecha límite"}</span><span className="tabular">{pct.toFixed(0)}%</span></div>
                      <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-surface-2"><div className={cn("h-full rounded-full", late ? "bg-danger" : "bg-accent")} style={{ width: `${Math.max(pct, 2)}%` }} /></div>
                    </div>
                    <ChevronRight className="size-4 text-fg-subtle group-hover:text-fg" />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Section title={`Entregas programadas (${upcoming.length})`} description="Registradas en una OC, todavía sin entregar">
          {!upcoming.length ? <p className="px-6 py-8 text-sm text-fg-subtle">No hay entregas programadas.</p> : (
            <ul className="divide-y divide-border">{upcoming.map((d) => (
              <li key={d.id}><Link href={`/ordenes/${d.purchase_order_id}?tab=entregas`} className="flex items-center justify-between gap-4 px-5 py-3.5 text-sm hover:bg-surface-2/50 sm:px-6">
                <span className="min-w-0"><span className="block font-medium">{label(d.purchase_order_id)}</span><span className="text-xs text-fg-subtle">{deliveryNumber(d.internal_number)}</span></span>
                <span className="flex shrink-0 items-center gap-3 text-xs">
                  <span className={cn("inline-flex items-center gap-1", d.planned_date && d.planned_date < today ? "text-danger" : "text-fg-subtle")}><CalendarClock className="size-3.5" />{formatDate(d.planned_date)}</span>
                  <Badge tone={DELIVERY_TONE[d.status as DeliveryStatus]}>{DELIVERY_STATUS_LABEL[d.status as DeliveryStatus]}</Badge>
                </span>
              </Link></li>
            ))}</ul>
          )}
        </Section>
        <Section title="Últimas entregas registradas" description="Entregas cargadas dentro de las OC (con remito)">
          {!recent.length ? <p className="px-6 py-8 text-sm text-fg-subtle">Todavía no hay entregas registradas en las OC.</p> : (
            <ul className="divide-y divide-border">{recent.map((d) => (
              <li key={d.id}><Link href={`/ordenes/${d.purchase_order_id}?tab=entregas`} className="flex items-center justify-between gap-4 px-5 py-3.5 text-sm hover:bg-surface-2/50 sm:px-6">
                <span className="min-w-0"><span className="block font-medium">{label(d.purchase_order_id)}</span><span className="text-xs text-fg-subtle">{deliveryNumber(d.internal_number)}{d.remito_number ? ` · remito ${d.remito_number}` : ""}</span></span>
                <span className="flex shrink-0 items-center gap-3 text-xs text-fg-subtle">{formatDate(d.actual_date ?? d.planned_date)}<Badge tone={DELIVERY_TONE[d.status as DeliveryStatus]}>{DELIVERY_STATUS_LABEL[d.status as DeliveryStatus]}</Badge></span>
              </Link></li>
            ))}</ul>
          )}
        </Section>
      </div>
    </>
  );
}
