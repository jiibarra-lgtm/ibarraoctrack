import type { Metadata } from "next";
import Link from "next/link";
import { Calculator, Landmark, Percent, Receipt } from "lucide-react";
import { requireOrg } from "@/lib/session";
import { canBill } from "@/lib/billing";
import { Badge, Card, CardHeader, PageHeader } from "@/components/ui/primitives";
import { Stat } from "@/components/ui/stat";
import { formatMoney } from "@/lib/format";
import { businessDay } from "@/lib/taxes";
import { defaultDeductions, type IibbDeductions, type IibbJur } from "@/lib/iibb";
import { cn } from "@/lib/utils";
import { IibbWorksheet, JurisdictionsForm } from "./ui";

export const metadata: Metadata = { title: "Liquidación de Ingresos Brutos" };

const nowAr = () => new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);
const shift = (ym: string, n: number) => new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1 + n, 1)).toISOString().slice(0, 7);
const monthLabel = (ym: string) => new Date(`${ym}-15T12:00:00Z`).toLocaleDateString("es-AR", { month: "long", year: "numeric", timeZone: "UTC" });
const N = (v: unknown) => Number(v ?? 0) || 0;

export default async function IibbPage({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  const sp = await searchParams;
  const today = nowAr();
  // por defecto se liquida el mes anterior (el que vence este mes)
  const m = /^\d{4}-\d{2}$/.test(sp.m ?? "") ? sp.m! : shift(today.slice(0, 7), -1);
  const s = await requireOrg();
  const sb = s.supabase, org = s.org.org_id;
  const edit = canBill(s.org.role);
  const [{ data: js }, { data: em }, { data: wh }, { data: filing }, { data: prev }, { data: history }, { data: tax }] = await Promise.all([
    sb.from("iibb_jurisdictions").select("code, coefficient, rate, active").eq("org_id", org).order("code"),
    sb.from("arca_vouchers").select("net_taxed, net_untaxed, exempt, exchange_rate, credit_note").eq("org_id", org).eq("direction", "emitido").gte("issue_date", `${m}-01`).lt("issue_date", `${shift(m, 1)}-01`).limit(5000),
    sb.from("tax_withholdings_monthly").select("ret_iibb, sircreb").eq("org_id", org).eq("month", m).maybeSingle(),
    sb.from("iibb_filings").select("base, detail, status, paid_at, total_due").eq("org_id", org).eq("month", m).maybeSingle(),
    sb.from("iibb_filings").select("detail").eq("org_id", org).eq("month", shift(m, -1)).maybeSingle(),
    sb.from("iibb_filings").select("month, total_tax, total_due, status, presented_at, paid_at").eq("org_id", org).order("month", { ascending: false }).limit(24),
    sb.from("tax_settings").select("iibb_day").eq("org_id", org).maybeSingle(),
  ]);
  const allJ = ((js ?? []) as { code: number; coefficient: string; rate: string; active: boolean }[]).map((j) => ({ code: Number(j.code), coefficient: N(j.coefficient), rate: N(j.rate), active: j.active }));
  const current: IibbJur[] = allJ.filter((j) => j.active).map(({ code, coefficient, rate }) => ({ code, coefficient, rate }));
  const sales = ((em ?? []) as { net_taxed: string; net_untaxed: string; exempt: string; exchange_rate: string | null; credit_note: boolean }[])
    .reduce((a, v) => a + (N(v.net_taxed) + N(v.net_untaxed) + N(v.exempt)) * (N(v.exchange_rate) || 1) * (v.credit_note ? -1 : 1), 0);
  const retIibb = N(wh?.ret_iibb), sircreb = N(wh?.sircreb);
  type Det = { code: number; coefficient: number; rate: number; retenciones: number; percepciones: number; sircreb: number; favor_next: number };
  const saved = (filing?.detail ?? []) as Det[];
  // Un mes ya guardado conserva los coeficientes y alícuotas con que se liquidó (si después cambia la alícuota, no se reescribe)
  const active: IibbJur[] = saved.length ? saved.map((d) => ({ code: Number(d.code), coefficient: N(d.coefficient), rate: N(d.rate) })) : current;
  const defaults: Record<number, IibbDeductions> = saved.length
    ? Object.fromEntries(saved.map((d) => [d.code, { retenciones: N(d.retenciones), percepciones: N(d.percepciones), sircreb: N(d.sircreb) }]))
    : defaultDeductions(active, retIibb, sircreb);
  for (const j of active) defaults[j.code] ??= { retenciones: 0, percepciones: 0, sircreb: 0 };
  const favorPrev: Record<number, number> = Object.fromEntries(((prev?.detail ?? []) as Det[]).map((d) => [d.code, N(d.favor_next)]));
  const base = filing ? N(filing.base) : Math.round(sales * 100) / 100;
  const [y, mm] = shift(m, 1).split("-").map(Number);
  const due = businessDay(y, mm, Number(tax?.iibb_day ?? 15));

  return (
    <>
      <PageHeader breadcrumb={<Link href="/impuestos" className="hover:text-fg">Impuestos</Link>} title="Liquidación de Ingresos Brutos"
        description="Convenio Multilateral, mes por mes: la base (ventas netas del mes según ARCA) se reparte por coeficiente, se aplica la alícuota de cada jurisdicción y se restan retenciones, percepciones, SIRCREB y el saldo a favor que viene del mes anterior. Es el borrador del CM03: confirmalo con el contador antes de presentar."
        actions={<div className="flex gap-2 text-sm">
          <Link href={`/impuestos/iibb?m=${shift(m, -1)}`} className="rounded-full border border-card-border bg-field px-3 py-1.5 text-fg-muted hover:text-fg">← {monthLabel(shift(m, -1))}</Link>
          {m < today.slice(0, 7) && <Link href={`/impuestos/iibb?m=${shift(m, 1)}`} className="rounded-full border border-card-border bg-field px-3 py-1.5 text-fg-muted hover:text-fg">{monthLabel(shift(m, 1))} →</Link>}
        </div>} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat icon={Receipt} label={`Ventas netas ${monthLabel(m)}`} value={formatMoney(sales)} sub="facturas emitidas menos notas de crédito" />
        <Stat icon={Landmark} label="Retenciones IIBB + SIRCREB" value={formatMoney(retIibb + sircreb)} sub={`retenciones ${formatMoney(retIibb)} · SIRCREB ${formatMoney(sircreb)}`} />
        <Stat icon={Calculator} label="A pagar" value={formatMoney(filing?.total_due ?? null)} sub={filing ? (filing.status === "presentada" ? (filing.paid_at ? "presentada y pagada" : "presentada, falta pagar") : "borrador guardado") : "guardá la liquidación para fijarla"} tone={filing?.status === "presentada" && !filing.paid_at ? "warn" : undefined} />
        <Stat icon={Percent} label="Vence" value={due.split("-").reverse().join("/")} sub="según el día cargado en Impuestos (estimado)" />
      </div>

      <Card className="mt-5 overflow-hidden">
        <CardHeader title={`Liquidación · ${monthLabel(m)}`} description={`Las retenciones IIBB del mes se proponen en CABA (las retiene el GCBA) y el SIRCREB se reparte por coeficiente. Todo se puede corregir.${Math.abs(base - sales) > 1 ? ` La base guardada (${formatMoney(base)}) es distinta de las ventas de ARCA (${formatMoney(sales)}).` : ""}`}
          action={filing ? <Badge tone={filing.status === "presentada" ? "accent" : "warn"}>{filing.status === "presentada" ? "Presentada" : "Borrador"}</Badge> : undefined} />
        {active.length ? (
          <IibbWorksheet key={`${m}-${filing?.status ?? "n"}-${saved.length}`} month={m} base={base} jurisdictions={active} defaults={defaults} favorPrev={favorPrev}
            status={(filing?.status as "borrador" | "presentada" | undefined) ?? null} paidAt={filing?.paid_at ?? null} canEdit={edit} />
        ) : <p className="px-5 pb-5 text-sm text-fg-subtle">Activá al menos una jurisdicción abajo.</p>}
      </Card>

      <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card className="self-start">
          <CardHeader title="Jurisdicciones y coeficientes" description="Coeficiente unificado de cada provincia (CM05 del año) y su alícuota. Si vendés sólo en CABA, CABA con 1." />
          <JurisdictionsForm initial={allJ} canEdit={edit} />
        </Card>
        <Card className="self-start overflow-hidden">
          <CardHeader title="Liquidaciones anteriores" />
          {!(history ?? []).length ? <p className="px-5 pb-5 text-sm text-fg-subtle">Todavía no guardaste ninguna.</p> : (
            <table className="w-full text-sm tabular">
              <tbody className="divide-y divide-border">
                {((history ?? []) as { month: string; total_tax: string; total_due: string; status: string; paid_at: string | null }[]).map((h) => (
                  <tr key={h.month} className={cn(h.month === m && "bg-field")}>
                    <td className="px-5 py-2"><Link href={`/impuestos/iibb?m=${h.month}`} className="capitalize hover:underline">{monthLabel(h.month)}</Link></td>
                    <td className="px-2 text-right text-fg-muted">imp. {formatMoney(h.total_tax)}</td>
                    <td className="px-2 text-right font-medium">{formatMoney(h.total_due)}</td>
                    <td className="px-5 text-right"><Badge tone={h.status !== "presentada" ? "warn" : h.paid_at ? "accent" : "danger"}>{h.status !== "presentada" ? "Borrador" : h.paid_at ? "Pagada" : "Sin pagar"}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>
    </>
  );
}
