import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { checkYear, type IibbJur, type MonthInput, type Presented } from "@/lib/iibb";

const N = (v: unknown) => Number(v ?? 0) || 0;

/** Ventas de ARCA, retenciones y SIRCREB de cada mes del año y los CM03 presentados, con el control mes a mes. */
export async function loadIibbYear(sb: SupabaseClient, org: string, year: string, upTo: string) {
  const [{ data: js }, { data: em }, { data: wh }, { data: fil }] = await Promise.all([
    sb.from("iibb_jurisdictions").select("code, coefficient, rate").eq("org_id", org).eq("active", true),
    sb.from("arca_vouchers").select("issue_date, net_taxed, net_untaxed, exempt, exchange_rate, credit_note").eq("org_id", org).eq("direction", "emitido")
      .gte("issue_date", `${year}-01-01`).lt("issue_date", `${upTo}-01`).limit(20000),
    sb.from("tax_withholdings_monthly").select("month, ret_iibb, sircreb").eq("org_id", org).gte("month", `${year}-01`).lt("month", upTo),
    sb.from("iibb_filings").select("month, detail, total_tax, total_due, paid_at, source").eq("org_id", org).eq("source", "arca").gte("month", `${year}-01`).lt("month", upTo),
  ]);
  const jur: IibbJur[] = (js ?? []).map((j) => ({ code: Number(j.code), coefficient: N(j.coefficient), rate: N(j.rate) }));
  const months = new Map<string, MonthInput>();
  for (let i = 1; ; i++) {
    const m = `${year}-${String(i).padStart(2, "0")}`;
    if (m >= upTo || i > 12) break;
    months.set(m, { month: m, sales: 0, retIibb: 0, sircreb: 0 });
  }
  for (const v of (em ?? []) as { issue_date: string; net_taxed: string; net_untaxed: string; exempt: string; exchange_rate: string | null; credit_note: boolean }[]) {
    const x = months.get(v.issue_date.slice(0, 7));
    if (x) x.sales += (N(v.net_taxed) + N(v.net_untaxed) + N(v.exempt)) * (N(v.exchange_rate) || 1) * (v.credit_note ? -1 : 1);
  }
  for (const w of (wh ?? []) as { month: string; ret_iibb: string; sircreb: string }[]) {
    const x = months.get(w.month);
    if (x) { x.retIibb = N(w.ret_iibb); x.sircreb = N(w.sircreb); }
  }
  const presented: Presented[] = ((fil ?? []) as { month: string; detail: { code: number; tax: number; restan: number; due: number; favor_next: number }[]; total_tax: string; total_due: string; paid_at: string | null }[])
    .map((f) => ({ month: f.month, total_tax: N(f.total_tax), total_due: N(f.total_due), paid_at: f.paid_at,
      rows: (f.detail ?? []).map((r) => ({ code: Number(r.code), tax: N(r.tax), restan: N(r.restan), due: N(r.due), favor_next: N(r.favor_next) })) }));
  return { jur, checks: jur.length ? checkYear([...months.values()], jur, presented) : [] };
}
