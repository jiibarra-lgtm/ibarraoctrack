import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/primitives";
import { mlPage, nowAr } from "@/lib/ml/page";
import { addDays, daysBetween, loadStats, ordersBetween, usdRate } from "@/lib/ml/stats";
import { NotConnected } from "../pro-shared";
import { StatsBoard } from "./stats-board";
import { StatsExtra, type TopRow } from "./stats-extra";

export const metadata: Metadata = { title: "Mercado Libre · Stats" };
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ISO = /^\d{4}-\d{2}-\d{2}$/;

export default async function MlStats({ searchParams }: { searchParams: Promise<{ start?: string; end?: string; cur?: string }> }) {
  const sp = await searchParams;
  const { sb, org, ml } = await mlPage();
  if (!ml) return (<><PageHeader title="Stats" /><NotConnected /></>);

  const today = nowAr();
  let end = sp.end && ISO.test(sp.end) && sp.end <= today ? sp.end : today;
  let start = sp.start && ISO.test(sp.start) ? sp.start : addDays(end, -6);
  if (start > end) [start, end] = [end, start];
  if (daysBetween(start, end) > 180) start = addDays(end, -179);
  const len = daysBetween(start, end);
  const prevEnd = addDays(start, -1), prevStart = addDays(prevEnd, -(len - 1));

  const [itemsQ, dailyQ] = await Promise.all([
    sb.from("ml_items").select("item_id, cost_unit, title, thumbnail, permalink, available, status, sold_30d").eq("org_id", org),
    sb.from("ml_item_daily").select("item_id, visits").eq("org_id", org).gte("day", start).lte("day", end).limit(20000),
  ]);
  const itemRows = itemsQ.data ?? [];
  const cost = new Map(itemRows.map((i) => [i.item_id as string, i.cost_unit as number | null]));

  // Mes en curso (para la proyección): si el rango elegido no es este mes, se leen sus ventas aparte
  const monthStart = `${today.slice(0, 7)}-01`;
  const sameMonth = start === monthStart && end === today;
  const [curR, prev, rate, monthOrders] = await Promise.all([
    loadStats(ml, start, end, cost).then((r) => ({ r, e: null }), (e: Error) => ({ r: null, e: e.message })),
    loadStats(ml, prevStart, prevEnd, cost).catch(() => null),
    usdRate(),
    sameMonth ? Promise.resolve(null) : ordersBetween(ml, monthStart, today).catch(() => null),
  ]);
  const cur = curR.r, error = curR.e;

  const visits = new Map<string, number>();
  for (const d of dailyQ.data ?? []) visits.set(d.item_id as string, (visits.get(d.item_id as string) ?? 0) + Number(d.visits ?? 0));
  const info = new Map(itemRows.map((i) => [i.item_id as string, i]));
  const top: TopRow[] = (cur?.items ?? []).map((a) => {
    const i = info.get(a.item_id);
    return { ...a, title: (i?.title as string) ?? a.title, thumbnail: (i?.thumbnail as string) ?? null, permalink: (i?.permalink as string) ?? null,
      available: (i?.available as number) ?? null, visits: visits.get(a.item_id) ?? null, hasCost: i?.cost_unit !== null && i?.cost_unit !== undefined };
  });
  const mtd = sameMonth ? (cur?.days ?? []).reduce((x, d) => x + d.sales, 0)
    : (monthOrders ?? []).filter((o) => o.status !== "cancelled").reduce((x, o) => x + Number(o.total_amount), 0);
  const dayOfMonth = Number(today.slice(8, 10));
  const daysInMonth = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)), 0)).getUTCDate();
  const len7 = (cur?.days ?? []).length || 1;
  const stock = itemRows.filter((i) => i.status === "active").map((i) => {
    const sold = top.find((t) => t.item_id === i.item_id)?.units ?? 0;
    const perDay = sold / len7 || Number(i.sold_30d ?? 0) / 30;
    return { item_id: i.item_id as string, title: i.title as string, available: Number(i.available ?? 0), daysLeft: perDay > 0 ? Number(i.available ?? 0) / perDay : null, noCost: i.cost_unit === null };
  });

  return (
    <>
    <StatsBoard
      start={start} end={end} today={today} prevLabel={`${prevStart} a ${prevEnd}`}
      days={cur?.days ?? []} prevDays={prev?.days ?? []}
      adsError={cur?.adsError ?? null} visitsOk={cur?.visitsOk ?? false} error={error}
      currency={sp.cur === "USD" && rate ? "USD" : "ARS"} rate={rate}
    />
    {cur && (
      <StatsExtra
        top={top} heat={cur.heat} stock={stock}
        month={{ mtd, projected: dayOfMonth ? (mtd / dayOfMonth) * daysInMonth : mtd, day: dayOfMonth, days: daysInMonth, label: today.slice(0, 7) }}
        currency={sp.cur === "USD" && rate ? "USD" : "ARS"} rate={rate}
      />
    )}
    </>
  );
}
