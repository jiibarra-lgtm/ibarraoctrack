import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, CalendarDays, MessageCircleQuestion, Package, ShieldAlert, ShoppingCart, TrendingUp, Wallet } from "lucide-react";
import { Badge, Card, CardBody, CardHeader, PageHeader } from "@/components/ui/primitives";
import { Stat } from "@/components/ui/stat";
import { formatMoney } from "@/lib/format";
import { mlPage, ITEM_COLS, LEVEL, nowAr, nowMs, type ItemRow } from "@/lib/ml/page";
import { recentSales } from "@/lib/ml/sync";
import { accountScore, daysOfStock, nextEvents } from "@/lib/ml/logic";
import { MarkSeenButton, MlSyncNowButton } from "../pro-ui";
import { Bar, NotConnected, ago, int, pct } from "../pro-shared";
import { LabelsCard } from "../labels-card";
import { labelPrefs } from "@/lib/ml/prefs";

export const metadata: Metadata = { title: "Mercado Libre · Resumen" };
export const dynamic = "force-dynamic";

type Rep = { level_id: string | null; power_seller_status: string | null; transactions?: { total: number; completed: number; canceled: number; ratings?: { positive: number; negative: number; neutral: number } };
  metrics?: { claims?: { rate: number }; delayed_handling_time?: { rate: number }; cancellations?: { rate: number }; sales?: { completed: number } } };

export default async function MlPanel() {
  const { sb, org, ml } = await mlPage();
  if (!ml) return (<><PageHeader title="Mercado Libre" /><NotConnected /></>);

  const [itemsQ, eventsQ, questionsQ, claimsQ, settingsQ, me, sales] = await Promise.all([
    sb.from("ml_items").select(ITEM_COLS).eq("org_id", org),
    sb.from("ml_events").select("id, at, kind, title, detail, url, seen").eq("org_id", org).order("at", { ascending: false }).limit(25),
    sb.from("ml_questions").select("id, status, date_created, answered_at").eq("org_id", org).gte("date_created", new Date(nowMs() - 30 * 864e5).toISOString()),
    sb.from("ml_claims").select("id, status").eq("org_id", org).eq("status", "opened"),
    sb.from("ml_settings").select("goal_sales, goal_units, goal_profit, vacation, label_prefs").eq("org_id", org).maybeSingle(),
    ml.get<{ nickname: string; seller_reputation?: Rep; points?: number }>(`/users/${ml.userId}`),
    recentSales(ml, 31),
  ]);
  const items = (itemsQ.data ?? []) as unknown as ItemRow[];
  const events = eventsQ.data ?? [];
  const questions = questionsQ.data ?? [];
  const settings = settingsQ.data;
  const rep = me.ok ? me.data.seller_reputation : undefined;

  const today = nowAr();
  const month = today.slice(0, 7);
  const arDay = (iso: string) => new Date(Date.parse(iso) - 3 * 3600e3).toISOString().slice(0, 10);
  const valid = sales.filter((o) => o.status !== "cancelled");
  const monthSales = valid.filter((o) => arDay(o.date_created).startsWith(month));
  const todaySales = valid.filter((o) => arDay(o.date_created) === today);
  const total = (l: typeof valid) => l.reduce((a, o) => a + Number(o.total_amount ?? 0), 0);
  const units = (l: typeof valid) => l.reduce((a, o) => a + o.order_items.reduce((b, i) => b + i.quantity, 0), 0);
  const feeTotal = monthSales.reduce((a, o) => a + o.order_items.reduce((b, i) => b + Number(i.sale_fee ?? 0) * i.quantity, 0), 0);

  // costo conocido → ganancia aproximada del mes (precio − comisión − costo)
  const costOf = new Map(items.map((i) => [i.item_id, i.cost_unit]));
  let profit = 0, profitKnown = true;
  for (const o of monthSales) for (const it of o.order_items) {
    const c = costOf.get(it.item.id);
    if (c === null || c === undefined) { profitKnown = false; continue; }
    profit += (it.unit_price - Number(it.sale_fee ?? 0) - c) * it.quantity;
  }

  const active = items.filter((i) => i.status === "active");
  const paused = items.filter((i) => i.status === "paused");
  const noStock = items.filter((i) => i.status !== "closed" && (i.available ?? 0) === 0);
  const healths = items.filter((i) => i.health !== null).map((i) => (i.health! <= 1 ? i.health! * 100 : i.health!));
  const avgHealth = healths.length ? healths.reduce((a, b) => a + b, 0) / healths.length : null;
  const answered = questions.filter((q) => q.status === "ANSWERED");
  const unanswered = questions.filter((q) => q.status === "UNANSWERED");
  const avgAnswerH = answered.length ? answered.reduce((a, q) => a + (q.answered_at ? (Date.parse(q.answered_at) - Date.parse(q.date_created)) / 3600e3 : 0), 0) / answered.length : null;
  const catalog = items.filter((i) => i.catalog_listing && i.competition);
  const score = accountScore({
    level: rep?.level_id ?? null, avgHealth,
    answeredPct: questions.length ? (answered.length / questions.length) * 100 : null, avgAnswerHours: avgAnswerH,
    withStockPct: items.length ? ((items.length - noStock.length) / items.length) * 100 : null,
    competitivePct: catalog.length ? (catalog.filter((i) => i.competition === "winning").length / catalog.length) * 100 : null,
  });

  const soon = active.map((i) => ({ i, d: daysOfStock(i.available ?? 0, i.sold_30d ?? 0) })).filter((x) => x.d !== null && x.d <= 10).sort((a, b) => a.d! - b.d!);
  const bad = items.filter((i) => i.health !== null && (i.health <= 1 ? i.health * 100 : i.health) < 70).sort((a, b) => (a.health ?? 0) - (b.health ?? 0));
  const level = rep?.level_id ? LEVEL[rep.level_id] : null;
  const lastSync = items.map((i) => i.seen_at).sort().at(-1);
  const goals = [
    { label: "Ventas", now: total(monthSales), goal: settings?.goal_sales, fmt: (n: number) => formatMoney(n) },
    { label: "Unidades", now: units(monthSales), goal: settings?.goal_units, fmt: (n: number) => int(n) },
    { label: "Ganancia", now: profit, goal: settings?.goal_profit, fmt: (n: number) => formatMoney(n) },
  ].filter((g) => g.goal);
  const dayOfMonth = Number(today.slice(8, 10)), daysInMonth = new Date(Number(today.slice(0, 4)), Number(today.slice(5, 7)), 0).getDate();

  return (
    <>
      <PageHeader title={`Mercado Libre · ${me.ok ? me.data.nickname : ""}`} description={`Actualizado ${ago(lastSync)} · se actualiza solo cada 10 minutos.`} actions={<MlSyncNowButton />} />
      {settings?.vacation && <div className="mb-4 rounded-xl border border-warn bg-warn-soft px-4 py-3 text-sm">Estás en <b>modo vacaciones</b>: las publicaciones están pausadas. <Link className="underline" href="/mercadolibre/automatizaciones">Volver</Link></div>}
      <div className="mb-4 max-w-xl"><LabelsCard prefs={labelPrefs(settings?.label_prefs)} /></div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat icon={ShoppingCart} label="Vendido hoy" value={formatMoney(total(todaySales))} sub={`${todaySales.length} ventas · ${units(todaySales)} u.`} href="/mercadolibre/ventas" />
        <Stat icon={Wallet} label="Vendido en el mes" value={formatMoney(total(monthSales))} sub={`${monthSales.length} ventas · ticket ${formatMoney(monthSales.length ? total(monthSales) / monthSales.length : 0)}`} href="/mercadolibre/reportes" />
        <Stat icon={TrendingUp} label="Ganancia del mes (aprox.)" value={formatMoney(profit)} sub={profitKnown ? `comisiones ${formatMoney(feeTotal)}` : "faltan costos en algunas publicaciones"} tone={profitKnown ? "accent" : "warn"} href="/mercadolibre/precios" />
        <Stat icon={MessageCircleQuestion} label="Preguntas sin responder" value={String(unanswered.length)} sub={avgAnswerH !== null ? `respondés en ${avgAnswerH.toFixed(1)} h promedio` : undefined} tone={unanswered.length ? "warn" : undefined} href="/mercadolibre/preguntas" />
        <Stat icon={ShieldAlert} label="Reclamos abiertos" value={String(claimsQ.data?.length ?? 0)} tone={claimsQ.data?.length ? "danger" : undefined} href="/mercadolibre/preguntas?v=reclamos" />
        <Stat icon={Package} label="Publicaciones activas" value={`${active.length} / ${items.length}`} sub={`${paused.length} pausadas · ${noStock.length} sin stock`} href="/mercadolibre/publicaciones" />
        <Stat icon={AlertTriangle} label="Con problemas de calidad" value={String(bad.length)} sub={avgHealth !== null ? `calidad promedio ${Math.round(avgHealth)}` : "se calcula en la próxima actualización"} tone={bad.length ? "warn" : undefined} href="/mercadolibre/publicaciones?f=problemas" />
        <Stat icon={CalendarDays} label="Se quedan sin stock" value={String(soon.length)} sub="en 10 días o menos al ritmo actual" tone={soon.length ? "warn" : undefined} href="/mercadolibre/publicaciones?f=quiebre" />
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-[1.1fr_1fr]">
        <Card>
          <CardHeader title={`Puntaje de la cuenta: ${score.total}/100`} description={`Lo que más te baja: ${score.worst}.`} />
          <CardBody className="space-y-2.5">
            {score.parts.map((p) => (
              <div key={p.key} className="grid grid-cols-[180px_1fr_40px] items-center gap-3 text-sm">
                <span className="text-fg-muted">{p.key}</span>
                <Bar value={p.v} tone={p.v >= 75 ? "accent" : p.v >= 50 ? "warn" : "danger"} />
                <span className="text-right tabular">{p.v}</span>
              </div>
            ))}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Reputación" description={rep?.power_seller_status ? `MercadoLíder ${rep.power_seller_status}` : "Sin MercadoLíder"} />
          <CardBody className="space-y-3 text-sm">
            <div className="flex items-center gap-3">
              {(["1_red", "2_orange", "3_yellow", "4_light_green", "5_green"] as const).map((k) => (
                <span key={k} className="h-3 flex-1 rounded-full" style={{ background: LEVEL[k].color, opacity: rep?.level_id === k ? 1 : 0.2 }} />
              ))}
            </div>
            <p>Nivel: <b>{level?.label ?? "Sin datos"}</b></p>
            {rep?.metrics && (
              <div className="grid grid-cols-3 gap-2 text-center">
                <Metric label="Reclamos" v={rep.metrics.claims?.rate} max={2} />
                <Metric label="Despachos con demora" v={rep.metrics.delayed_handling_time?.rate} max={15} />
                <Metric label="Canceladas por vos" v={rep.metrics.cancellations?.rate} max={1.5} />
              </div>
            )}
            {rep?.transactions?.ratings && <p className="text-xs text-fg-subtle">Calificaciones: {pct(rep.transactions.ratings.positive * 100, 0)} positivas · {rep.transactions.completed} ventas concretadas en total.</p>}
            <p className="text-xs text-fg-subtle">Los límites de cada métrica son los de MercadoLíder Platinum (reclamos 2 %, demoras 15 %, cancelaciones 1,5 %).</p>
          </CardBody>
        </Card>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        <Card>
          <CardHeader title="Avisos" description="Ventas, bajas, cambios de la competencia, preguntas y reclamos." action={events.some((e) => !e.seen) ? <MarkSeenButton /> : null} />
          {events.length === 0 ? <CardBody className="text-sm text-fg-muted">Todavía no hay avisos.</CardBody> : (
            <ul className="divide-y divide-border">
              {events.map((e) => (
                <li key={e.id} className="flex items-start gap-3 px-5 py-2.5 text-sm">
                  {!e.seen && <span className="mt-1.5 size-2 shrink-0 rounded-full bg-brand" />}
                  <div className="min-w-0 flex-1">
                    {e.url ? <Link href={e.url} className="font-medium hover:underline">{e.title}</Link> : <span className="font-medium">{e.title}</span>}
                    {e.detail && <p className="truncate text-xs text-fg-subtle">{e.detail}</p>}
                  </div>
                  <span className="shrink-0 text-xs text-fg-subtle">{ago(e.at)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <div className="space-y-5">
          {goals.length > 0 ? (
            <Card>
              <CardHeader title="Metas del mes" description={`Día ${dayOfMonth} de ${daysInMonth}`} action={<Link href="/mercadolibre/automatizaciones#metas" className="text-xs text-fg-muted hover:underline">Editar</Link>} />
              <CardBody className="space-y-3 text-sm">
                {goals.map((g) => {
                  const expected = (g.goal! * dayOfMonth) / daysInMonth;
                  return (
                    <div key={g.label}>
                      <div className="flex justify-between"><span>{g.label}</span><span className="tabular">{g.fmt(g.now)} / {g.fmt(g.goal!)}</span></div>
                      <Bar value={g.now} max={g.goal!} tone={g.now >= expected ? "accent" : "warn"} className="mt-1" />
                      <p className="mt-0.5 text-xs text-fg-subtle">{g.now >= expected ? "Vas adelantado" : `Para llegar te faltan ${g.fmt(Math.max(0, g.goal! - g.now))}`}</p>
                    </div>
                  );
                })}
              </CardBody>
            </Card>
          ) : (
            <Card><CardBody className="text-sm text-fg-muted">Poné metas de ventas y ganancia del mes en <Link href="/mercadolibre/automatizaciones#metas" className="underline">Automatizaciones</Link> y acá ves cómo venís.</CardBody></Card>
          )}

          <Card>
            <CardHeader title="Fechas que vienen" description="Prepará stock y promos con tiempo." />
            <ul className="divide-y divide-border">
              {nextEvents(today, 4).map((e) => (
                <li key={e.date} className="flex items-center justify-between px-5 py-2 text-sm">
                  <span>{e.name}</span><Badge tone={e.days <= 14 ? "warn" : "neutral"}>{e.days === 0 ? "hoy" : `en ${e.days} días`}</Badge>
                </li>
              ))}
            </ul>
          </Card>

          {soon.length > 0 && (
            <Card>
              <CardHeader title="Reponé pronto" />
              <ul className="divide-y divide-border">
                {soon.slice(0, 6).map(({ i, d }) => (
                  <li key={i.item_id} className="flex items-center justify-between gap-2 px-5 py-2 text-sm">
                    <Link href={`/mercadolibre/publicaciones/${i.item_id}`} className="truncate hover:underline">{i.title}</Link>
                    <Badge tone={d! <= 3 ? "danger" : "warn"}>{d === 0 ? "hoy" : `${d} días`}</Badge>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}

function Metric({ label, v, max }: { label: string; v: number | undefined; max: number }) {
  const val = (v ?? 0) * 100;
  const ok = val <= max;
  return (
    <div className="rounded-xl border border-border px-2 py-2">
      <p className={ok ? "text-lg font-semibold tabular" : "text-lg font-semibold tabular text-danger"}>{pct(val, 2)}</p>
      <p className="text-xs text-fg-subtle">{label}</p>
    </div>
  );
}
