import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/primitives";
import { mlPage, nowAr } from "@/lib/ml/page";
import { addDays, daysBetween, loadStats, usdRate } from "@/lib/ml/stats";
import { NotConnected } from "../pro-shared";
import { StatsBoard } from "./stats-board";

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

  const itemsQ = await sb.from("ml_items").select("item_id, cost_unit").eq("org_id", org);
  const cost = new Map((itemsQ.data ?? []).map((i) => [i.item_id as string, i.cost_unit as number | null]));

  const [curR, prev, rate] = await Promise.all([
    loadStats(ml, start, end, cost).then((r) => ({ r, e: null }), (e: Error) => ({ r: null, e: e.message })),
    loadStats(ml, prevStart, prevEnd, cost).catch(() => null),
    usdRate(),
  ]);
  const cur = curR.r, error = curR.e;

  return (
    <StatsBoard
      start={start} end={end} today={today} prevLabel={`${prevStart} a ${prevEnd}`}
      days={cur?.days ?? []} prevDays={prev?.days ?? []}
      adsError={cur?.adsError ?? null} visitsOk={cur?.visitsOk ?? false} error={error}
      currency={sp.cur === "USD" && rate ? "USD" : "ARS"} rate={rate}
    />
  );
}
