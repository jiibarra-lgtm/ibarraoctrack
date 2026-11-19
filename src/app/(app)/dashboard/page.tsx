import type { Metadata } from "next";
import Link from "next/link";
import { Activity, AlarmClock, ArrowRight, CircleCheck, FileText, TrendingUp, Truck, Upload, Wallet } from "lucide-react";
import { computeAlerts } from "@/lib/alerts";
import { requireOrg, canWrite } from "@/lib/session";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, EmptyState, PageHeader } from "@/components/ui/primitives";
import { StatusBadge } from "@/components/po/status-badge";
import { formatDate, formatMoney, todayISO } from "@/lib/format";
import { sum } from "@/lib/money";
import type { PoStatus } from "@/lib/po/schema";
import { MonthlyChart } from "./monthly-chart";
import { loadMonthStages, MonthStagesCard, monthLabel as mLabel, shiftMonth } from "./month-stages";
import { loadToday, MoneyCard, TodayCard } from "./today";
import { loadBreakEven } from "@/lib/break-even";

export const metadata: Metadata = { title: "Inicio" };

const longDate = () => new Date(Date.now() - 3 * 3600e3).toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });

const ACTIVE: PoStatus[] = ["recibida", "perfeccionada", "en_ejecucion"];

function monthsBack(n: number) {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - (n - 1), 1)).toISOString().slice(0, 10);
}

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ mes?: string; iva?: string }> }) {
  const sp = await searchParams;
  const s = await requireOrg();
  const org = s.org.org_id;
  const from = monthsBack(12);
  const current = todayISO().slice(0, 7);
  const ym = /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.mes ?? "") && sp.mes! <= current ? sp.mes! : current;
  const iva = sp.iva === "sin" ? "sin" : "con";
  const stagesP = loadMonthStages(s.supabase, org, ym);

  const [totals, monthly, top, recent, profits, delSummary, upcoming] = await Promise.all([
    s.supabase.rpc("po_totals", { p_org: org }),
    s.supabase.rpc("po_monthly", { p_org: org, p_from: from }),
    s.supabase.rpc("top_customers", { p_org: org, p_limit: 6 }),
    s.supabase.from("purchase_orders_overview").select("id, bac_number, display_number, customer_name, issue_date, status, currency, total_amount, net_amount")
      .eq("org_id", org).order("created_at", { ascending: false }).limit(6),
    s.supabase.from("po_profitability").select("currency, status, direct_cost_real, direct_cost_estimated, operating_profit_estimated, operating_margin_estimated, min_margin_pct, operating_profit_realized").eq("org_id", org).not("status", "in", "(anulada,borrador)"),
    s.supabase.from("po_delivery_summary").select("purchase_order_id, is_late").eq("org_id", org).eq("is_late", true),
    s.supabase.from("deliveries").select("id", { count: "exact", head: true }).eq("org_id", org).in("status", ["programada", "en_preparacion", "despachada"]),
  ]);
  type PR = { currency: string; status: string; direct_cost_real: string; direct_cost_estimated: string | null; operating_profit_estimated: string | null; operating_margin_estimated: string | null; min_margin_pct: string; operating_profit_realized: string | null };
  const pr = ((profits.data ?? []) as PR[]);

  type T = { status: PoStatus; currency: string; orders: number; awarded: string };
  const rows = (totals.data ?? []) as T[];
  const currencies = [...new Set(rows.map((r) => r.currency))].sort((a, b) => (a === "ARS" ? -1 : b === "ARS" ? 1 : a.localeCompare(b)));
  const main = currencies[0] ?? "ARS";
  const by = (f: (r: T) => boolean, cur = main) => rows.filter((r) => r.currency === cur && f(r));
  const awarded = sum(by((r) => r.status !== "anulada").map((r) => r.awarded));
  const activeAmt = sum(by((r) => ACTIVE.includes(r.status)).map((r) => r.awarded));
  const count = (f: (r: T) => boolean) => rows.filter(f).reduce((a, r) => a + Number(r.orders), 0);
  const nActive = count((r) => ACTIVE.includes(r.status));
  const nDone = count((r) => r.status === "completada" || r.status === "cerrada");
  const nTotal = count((r) => r.status !== "anulada");
  const prMain = pr.filter((p) => p.currency === main);
  const profitEst = sum(prMain.filter((p) => ACTIVE.includes(p.status as PoStatus)).map((p) => p.operating_profit_estimated).filter((v): v is string => v !== null));
  const profitReal = sum(prMain.map((p) => p.operating_profit_realized).filter((v): v is string => v !== null));
  const costsCommitted = sum(prMain.filter((p) => ACTIVE.includes(p.status as PoStatus)).map((p) => p.direct_cost_estimated).filter((v): v is string => v !== null));
  const costsReal = sum(prMain.map((p) => p.direct_cost_real));
  const lowMargin = pr.filter((p) => p.operating_margin_estimated !== null && Number(p.operating_margin_estimated) < Number(p.min_margin_pct)).length;
  const withoutCost = pr.filter((p) => p.direct_cost_estimated === null && ACTIVE.includes(p.status as PoStatus)).length;
  const late = delSummary.data?.length ?? 0;

  const series = (() => {
    const map = new Map<string, Record<string, number | string>>();
    for (let i = 11; i >= 0; i--) {
      const d = new Date();
      const k = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1)).toISOString().slice(0, 7);
      map.set(k, { month: k, orders: 0, awarded: 0 });
    }
    ((monthly.data ?? []) as { month: string; currency: string; orders: number; awarded: string }[])
      .filter((m) => m.currency === main)
      .forEach((m) => {
        const k = m.month.slice(0, 7);
        const row = map.get(k);
        if (row) { row.orders = Number(m.orders); row.awarded = Number(m.awarded); }
      });
    return [...map.values()];
  })();

  const writable = canWrite(s.org.role);
  const [openInv, alerts] = await Promise.all([
    s.supabase.from("invoice_balances").select("balance, collection_status, currency").eq("org_id", s.org.org_id).eq("status", "emitida").gt("balance", 0).then((r) => r.data ?? []),
    computeAlerts(s.supabase, s.org.org_id),
  ]);
  const receivable = sum(openInv.filter((i) => i.currency === main).map((i) => String(i.balance)));
  const overdueAmt = sum(openInv.filter((i) => i.currency === main && i.collection_status === "vencida").map((i) => String(i.balance)));
  const [stages, today, be] = await Promise.all([stagesP, loadToday(s.supabase, org, alerts, ym), loadBreakEven(s.supabase, org, ym)]);
  const empty = nTotal === 0 && rows.length === 0;

  return (
    <>
      <PageHeader
        title={`Hola${s.fullName ? `, ${s.fullName.split(" ")[0]}` : ""}`}
        description={<span className="capitalize">{longDate()}</span>}
        actions={writable && (
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="secondary"><Link href="/recordatorios"><AlarmClock /> Recordatorio</Link></Button>
            <Button asChild variant="secondary"><Link href="/entregas/pendientes"><Truck /> Entregas</Link></Button>
            <Button asChild><Link href="/ordenes/importar"><Upload /> Importar OC</Link></Button>
          </div>
        )}
      />

      {empty ? (
        <Card>
          <EmptyState
            icon={<FileText />}
            title="Empecemos por la primera orden"
            description="Subí la captura de “Ver documento contractual” de BAC. Los indicadores se arman solos a partir de tus órdenes reales."
            action={writable && <Button asChild><Link href="/ordenes/importar"><Upload /> Importar desde BAC</Link></Button>}
          />
        </Card>
      ) : (
        <div className="flex flex-col gap-6">
          {/* Mes a mes: por defecto el actual; lo viejo queda en su mes */}
          <nav className="-mt-2 flex gap-1.5 overflow-x-auto pb-1" aria-label="Mes">
            {Array.from({ length: 6 }, (_, i) => shiftMonth(current, -i)).map((mm) => (
              <Link key={mm} href={`/dashboard?mes=${mm}${iva === "sin" ? "&iva=sin" : ""}`}
                className={`whitespace-nowrap rounded-full px-3.5 py-1.5 text-sm font-medium capitalize ${mm === ym ? "bg-primary text-primary-fg" : "bg-field text-fg-muted hover:text-fg"}`}>
                {mm === current ? `${mLabel(mm)} (este mes)` : mLabel(mm)}
              </Link>
            ))}
          </nav>

          {/* 1 · Lo que hay que hacer y la plata */}
          <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
            <TodayCard tasks={today.tasks} title={ym === current ? "Qué hacer hoy" : `Lo que quedó pendiente de ${mLabel(ym)}`} monthLabel={mLabel(ym)} />
            <MoneyCard m={today.money} be={be} receivable={Number(receivable)} overdue={Number(overdueAmt)} />
          </div>

          {/* 2 · Cómo viene el mes */}
          <Section title="Cómo viene el mes" sub="Adjudicado → entregado → facturado → cobrado, y lo que te queda de ganancia.">
            {stages && <MonthStagesCard data={stages} ym={ym} current={current} iva={iva} />}
          </Section>

          {/* 3 · Los números grandes */}
          <Section title="Tus órdenes" sub={`Importes en ${main}${currencies.length > 1 ? ` · también hay en ${currencies.slice(1).join(", ")} (no se suman)` : ""}.`}>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi icon={Activity} label="En curso" value={formatMoney(activeAmt, main)} sub={`${nActive} órdenes activas`} href="/ordenes?estado=en_ejecucion" />
            <Kpi icon={TrendingUp} label="Ganancia estimada en curso" value={formatMoney(profitEst, main)} sub={`ya ganado ${formatMoney(profitReal, main)}`} href="/analitica/ranking" />
            <Kpi icon={Wallet} label="Total adjudicado" value={formatMoney(awarded, main)} sub={`${nTotal} órdenes vigentes`} href="/ordenes" />
            <Kpi icon={CircleCheck} label="Completadas" value={String(nDone)} sub={nTotal ? `${Math.round((nDone / nTotal) * 100)}% del total` : "—"} href="/ordenes?estado=completada" />
          </div>
          </Section>

          {/* 4 · Ventas */}
          <Section title="Ventas" sub="Cuánto te adjudican por mes y quién te compra más.">
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
            <Card>
              <CardHeader title="Adjudicado por mes" description={`Últimos 12 meses · por fecha de autorización · ${main}`} />
              <CardBody className="pt-2"><MonthlyChart data={series} currency={main} /></CardBody>
            </Card>
            <Card>
              <CardHeader title="Organismos" description="Por importe adjudicado" />
              {(top.data ?? []).length === 0 ? <EmptyState title="Sin datos" /> : (
                <ul className="divide-y divide-border">
                  {((top.data ?? []) as { customer_id: string; name: string; currency: string; orders: number; awarded: string }[]).map((c) => {
                    const max = Number((top.data as { awarded: string }[])[0].awarded) || 1;
                    return (
                      <li key={`${c.customer_id}-${c.currency}`} className="px-4 py-3 sm:px-5">
                        <Link href={`/ordenes?organismo=${c.customer_id}`} className="group block">
                          <div className="flex items-baseline justify-between gap-3">
                            <span className="truncate text-sm group-hover:text-primary">{c.name}</span>
                            <span className="shrink-0 text-sm font-medium tabular">{formatMoney(c.awarded, c.currency)}</span>
                          </div>
                          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-2">
                            <div className="h-full rounded-full bg-brand" style={{ width: `${Math.max(4, (Number(c.awarded) / max) * 100)}%` }} />
                          </div>
                          <p className="mt-1 text-xs text-fg-subtle">{c.orders} orden{Number(c.orders) === 1 ? "" : "es"}</p>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>
          </div>

          </Section>

          {/* 5 · Lo último */}
          <Section title="Lo último">
          <div className="grid gap-5 lg:grid-cols-2">
            <Card>
              <CardHeader title="Últimas órdenes" action={<Button asChild variant="ghost" size="sm"><Link href="/ordenes">Ver todas <ArrowRight /></Link></Button>} />
              <ul className="divide-y divide-border">
                {(recent.data ?? []).map((o) => (
                  <li key={o.id}>
                    <Link href={`/ordenes/${o.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-surface-2/60 sm:px-5">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{o.bac_number ?? o.display_number}</p>
                        <p className="truncate text-xs text-fg-subtle">{o.customer_name ?? "—"} · {formatDate(o.issue_date)}</p>
                      </div>
                      <StatusBadge status={o.status as PoStatus} />
                      <span className="hidden w-32 text-right text-sm tabular sm:block">{formatMoney(o.total_amount ?? o.net_amount, o.currency)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
            <div className="flex flex-col gap-5">
              <Card>
                <CardHeader title="Ganancias y entregas" description="Ganancia contable: no es dinero cobrado" action={<Button asChild variant="ghost" size="sm"><Link href="/analitica/ranking">Ranking <ArrowRight /></Link></Button>} />
                <CardBody className="grid grid-cols-2 gap-x-6 gap-y-4">
                  <Mini label="Ganancia estimada (órdenes en curso)" value={formatMoney(profitEst, main)} />
                  <Mini label="Ganancia realizada (entregado)" value={formatMoney(profitReal, main)} />
                  <Mini label="Costos comprometidos" value={formatMoney(costsCommitted, main)} sub={`Comprado ${formatMoney(costsReal, main)}`} />
                  <Mini label="Margen bajo el mínimo" value={String(lowMargin)} href="/analitica/ranking?vista=menor" warn={lowMargin > 0} />
                  <Mini label="Entregas atrasadas" value={String(late)} href="/entregas" warn={late > 0} />
                  <Mini label="Entregas programadas" value={String(upcoming.count ?? 0)} href="/entregas" />
                  {withoutCost > 0 && <p className="col-span-2 text-xs text-fg-subtle">{withoutCost} órdenes en curso sin costo cargado: cargá compras o el costo estimado por renglón.</p>}
                </CardBody>
              </Card>
            </div>
          </div>
          </Section>
        </div>
      )}
    </>
  );
}

function Section({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-baseline gap-3 border-b border-border pb-2">
        <h2 className="text-base font-semibold tracking-tight">{title}</h2>
        {sub && <p className="truncate text-xs text-fg-subtle">{sub}</p>}
      </div>
      {children}
    </section>
  );
}

function Mini({ label, value, sub, href, warn }: { label: string; value: string; sub?: string; href?: string; warn?: boolean }) {
  const inner = (
    <>
      <p className="text-xs text-fg-subtle">{label}</p>
      <p className={`mt-0.5 text-base font-semibold tabular ${warn ? "text-warn" : ""}`}>{value}</p>
      {sub && <p className="text-xs text-fg-subtle">{sub}</p>}
    </>
  );
  return href ? <Link href={href} className="block hover:opacity-80">{inner}</Link> : <div>{inner}</div>;
}

function Kpi({ label, value, sub, href, icon: Icon }: { label: string; value: string; sub?: string; href: string; icon: React.ElementType }) {
  return (
    <Link href={href} className="glass group rounded-2xl px-4 py-4 transition-transform hover:-translate-y-0.5">
      <span className="grid size-8 place-items-center rounded-full border border-card-border bg-field text-fg-muted shadow-xs group-hover:text-brand"><Icon className="size-4" /></span>
      <p className="mt-3 truncate text-xl font-semibold tracking-tight tabular sm:text-2xl">{value}</p>
      <p className="mt-0.5 truncate text-sm font-medium text-fg">{label}</p>
      {sub && <p className="truncate text-xs text-fg-subtle">{sub}</p>}
    </Link>
  );
}
