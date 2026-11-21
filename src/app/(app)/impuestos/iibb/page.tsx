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
import { Cm03Upload, IibbWorksheet, JurisdictionsForm, MarkPaidButton } from "./ui";
import { JURISDICTIONS } from "@/lib/iibb";
import { loadIibbYear } from "@/lib/iibb-load";

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
    sb.from("iibb_filings").select("base, detail, status, paid_at, total_due, total_tax, source, verifier, vep, paid_amount, presented_at").eq("org_id", org).eq("month", m).maybeSingle(),
    sb.from("iibb_filings").select("detail").eq("org_id", org).eq("month", shift(m, -1)).maybeSingle(),
    sb.from("iibb_filings").select("month, total_tax, total_due, status, presented_at, paid_at, source").eq("org_id", org).order("month", { ascending: false }).limit(24),
    sb.from("tax_settings").select("iibb_day").eq("org_id", org).maybeSingle(),
  ]);
  // Control del año: el sistema calcula cada mes solo y lo compara con el CM03 presentado
  const yy = m.slice(0, 4);
  const year = await loadIibbYear(sb, org, yy, yy === today.slice(0, 4) ? shift(today.slice(0, 7), 1) : `${Number(yy) + 1}-01`);
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
  const prevCheck = year.checks.find((c) => c.month === shift(m, -1));
  const favorPrev: Record<number, number> = prevCheck
    ? Object.fromEntries((prevCheck.presented?.rows ?? prevCheck.calc.rows).map((d) => [d.code, N(d.favor_next)]))
    : Object.fromEntries(((prev?.detail ?? []) as Det[]).map((d) => [d.code, N(d.favor_next)]));
  const base = filing ? N(filing.base) : Math.round(sales * 100) / 100;
  const fromArca = filing?.source === "arca";
  const [y, mm] = shift(m, 1).split("-").map(Number);
  const due = businessDay(y, mm, Number(tax?.iibb_day ?? 15));

  return (
    <>
      <PageHeader breadcrumb={<Link href="/impuestos" className="hover:text-fg">Impuestos</Link>} title="Liquidación de Ingresos Brutos"
        description="Lo presentado sale del CM03 de SIFERE (ARCA), tal cual: se carga solo cuando te mandás el PDF por mail, o lo subís acá. Los meses que todavía no se presentaron muestran una estimación con tus alícuotas, marcada como tal."
        actions={<div className="flex flex-wrap items-center gap-2 text-sm">
          {edit && <Cm03Upload />}
          <Link href={`/impuestos/iibb?m=${shift(m, -1)}`} className="rounded-full border border-card-border bg-field px-3 py-1.5 text-fg-muted hover:text-fg">← {monthLabel(shift(m, -1))}</Link>
          {m < today.slice(0, 7) && <Link href={`/impuestos/iibb?m=${shift(m, 1)}`} className="rounded-full border border-card-border bg-field px-3 py-1.5 text-fg-muted hover:text-fg">{monthLabel(shift(m, 1))} →</Link>}
        </div>} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat icon={Receipt} label={`Ventas netas ${monthLabel(m)}`} value={formatMoney(sales)} sub="facturas emitidas menos notas de crédito" />
        <Stat icon={Landmark} label="Retenciones IIBB + SIRCREB" value={formatMoney(retIibb + sircreb)} sub={`retenciones ${formatMoney(retIibb)} · SIRCREB ${formatMoney(sircreb)}`} />
        <Stat icon={Calculator} label="A pagar" value={formatMoney(filing?.total_due ?? null)} sub={fromArca ? (filing!.paid_at ? `según el CM03 · pagado el ${filing!.paid_at.split("-").reverse().join("/")}` : Number(filing!.total_due) > 0 ? "según el CM03 · sin pago registrado" : "según el CM03 · nada que pagar") : filing ? (filing.status === "presentada" ? (filing.paid_at ? "presentada y pagada" : "presentada, falta pagar") : "borrador guardado") : "estimado: todavía no hay CM03 de este mes"} tone={filing?.status === "presentada" && !filing.paid_at && Number(filing.total_due) > 0 ? "warn" : undefined} />
        <Stat icon={Percent} label="Vence" value={due.split("-").reverse().join("/")} sub="según el día cargado en Impuestos (estimado)" />
      </div>

      <YearControl checks={year.checks} current={m} />

      {fromArca ? (
        <ArcaFiling filing={filing as unknown as ArcaF} sales={sales} current={current} month={m} canEdit={edit} />
      ) : (
      <Card className="mt-5 overflow-hidden">
        <CardHeader title={`Estimación · ${monthLabel(m)}`} description={`Las retenciones IIBB del mes se proponen en CABA (las retiene el GCBA) y el SIRCREB se reparte por coeficiente. Todo se puede corregir.${Math.abs(base - sales) > 1 ? ` La base guardada (${formatMoney(base)}) es distinta de las ventas de ARCA (${formatMoney(sales)}).` : ""}`}
          action={filing ? <Badge tone={filing.status === "presentada" ? "accent" : "warn"}>{filing.status === "presentada" ? "Presentada" : "Borrador"}</Badge> : undefined} />
        {active.length ? (
          <IibbWorksheet key={`${m}-${filing?.status ?? "n"}-${saved.length}`} month={m} base={base} jurisdictions={active} defaults={defaults} favorPrev={favorPrev}
            status={(filing?.status as "borrador" | "presentada" | undefined) ?? null} paidAt={filing?.paid_at ?? null} canEdit={edit} />
        ) : <p className="px-5 pb-5 text-sm text-fg-subtle">Activá al menos una jurisdicción abajo.</p>}
      </Card>
      )}

      <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card className="self-start">
          <CardHeader title="Jurisdicciones y coeficientes" description="Coeficiente unificado de cada provincia (CM05 del año) y su alícuota. Si vendés sólo en CABA, CABA con 1." />
          <JurisdictionsForm initial={allJ} canEdit={edit} />
        </Card>
        <Card className="self-start overflow-hidden">
          <CardHeader title="DDJJ por mes" description="ARCA = cargada del CM03 presentado." />
          {!(history ?? []).length ? <p className="px-5 pb-5 text-sm text-fg-subtle">Todavía no guardaste ninguna.</p> : (
            <table className="w-full text-sm tabular">
              <tbody className="divide-y divide-border">
                {((history ?? []) as { month: string; total_tax: string; total_due: string; status: string; paid_at: string | null; source: string }[]).map((h) => (
                  <tr key={h.month} className={cn(h.month === m && "bg-field")}>
                    <td className="px-5 py-2"><Link href={`/impuestos/iibb?m=${h.month}`} className="capitalize hover:underline">{monthLabel(h.month)}</Link></td>
                    <td className="px-2 text-right text-fg-muted">imp. {formatMoney(h.total_tax)}</td>
                    <td className="px-2 text-right font-medium">{formatMoney(h.total_due)}</td>
                    <td className="px-5 text-right">{h.source === "arca" && <Badge tone="info">ARCA</Badge>} <Badge tone={h.status !== "presentada" ? "warn" : h.paid_at || Number(h.total_due) === 0 ? "accent" : "danger"}>{h.status !== "presentada" ? "Borrador" : Number(h.total_due) === 0 ? "Sin saldo" : h.paid_at ? "Pagada" : "Sin pago registrado"}</Badge></td>
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

type ArcaRow = { code: number; coefficient: number | null; tax: number; restan: number; favor_next: number; due: number };
type ArcaF = { detail: ArcaRow[]; total_tax: string; total_due: string; verifier: string | null; vep: string | null; paid_at: string | null; paid_amount: string | null; presented_at: string | null };

/** Mes presentado: los números del CM03, sin recalcular. Al lado, contra qué ventas de ARCA se compara (alícuota efectiva). */
function ArcaFiling({ filing, sales, current, month, canEdit }: { filing: ArcaF; sales: number; current: IibbJur[]; month: string; canEdit: boolean }) {
  const rows = filing.detail ?? [];
  const rateOf = new Map(current.map((j) => [j.code, j]));
  return (
    <Card className="mt-5 overflow-hidden">
      <CardHeader title={`CM03 presentado · ${monthLabel(month)}`}
        description={`Datos tal cual la DDJJ de SIFERE${filing.verifier ? ` (N° verificador ${filing.verifier})` : ""}${filing.presented_at ? `, presentada el ${filing.presented_at.split("-").reverse().join("/")}` : ""}.${filing.vep ? ` VEP ${filing.vep} pagado el ${filing.paid_at?.split("-").reverse().join("/")} por ${formatMoney(filing.paid_amount)}.` : ""}`}
        action={<Badge tone="info">ARCA</Badge>} />
      <div className="overflow-x-auto">
        <table className="w-full min-w-[860px] text-sm tabular">
          <thead className="text-xs text-fg-subtle"><tr className="border-y border-border">
            <th className="px-5 py-2 text-left font-medium">Jurisdicción</th><th className="px-2 text-right font-medium">Impuesto determinado</th>
            <th className="px-2 text-right font-medium">Valores restan</th><th className="px-2 text-right font-medium">A favor contribuyente</th><th className="px-2 text-right font-medium">A pagar</th>
            <th className="px-2 text-right font-medium">Alícuota efectiva*</th><th className="px-5 text-right font-medium">Con tu alícuota cargada</th>
          </tr></thead>
          <tbody className="divide-y divide-border">
            {rows.map((r) => {
              const j = rateOf.get(Number(r.code));
              const coef = r.coefficient ?? j?.coefficient ?? null;
              const base = coef ? sales * Number(coef) : null;
              const eff = base ? (Number(r.tax) / base) * 100 : null;
              const withRate = base && j ? base * j.rate / 100 : null;
              return (
                <tr key={r.code}>
                  <td className="px-5 py-2">{r.code} · {JURISDICTIONS[Number(r.code)]}</td>
                  <td className="px-2 text-right font-medium">{formatMoney(r.tax)}</td>
                  <td className="px-2 text-right">{formatMoney(r.restan)}</td>
                  <td className="px-2 text-right text-accent">{Number(r.favor_next) ? formatMoney(r.favor_next) : "—"}</td>
                  <td className="px-2 text-right font-semibold">{formatMoney(r.due)}</td>
                  <td className="px-2 text-right">{eff !== null ? `${eff.toFixed(2).replace(".", ",")}%` : "—"}</td>
                  <td className={cn("px-5 text-right", withRate !== null && Math.abs(withRate - Number(r.tax)) > Math.max(100, Number(r.tax) * 0.02) && "text-danger")}>
                    {withRate !== null ? `${formatMoney(withRate)} (${String(j!.rate).replace(".", ",")}%)` : "—"}
                  </td>
                </tr>
              );
            })}
            <tr className="font-semibold"><td className="px-5 py-2">Total</td><td className="px-2 text-right">{formatMoney(filing.total_tax)}</td><td /><td /><td className="px-2 text-right">{formatMoney(filing.total_due)}</td><td /><td /></tr>
          </tbody>
        </table>
      </div>
      <p className="px-5 py-3 text-xs text-fg-subtle">* Impuesto del CM03 ÷ (ventas netas de ARCA del mes {formatMoney(sales)} × coeficiente). Si da distinto de la alícuota que te dijeron, la DDJJ se liquidó con otra alícuota o con otra base: consultalo con el contador.</p>
      {canEdit && Number(filing.total_due) > 0 && !filing.paid_at && <div className="flex justify-end px-5 pb-4"><MarkPaidButton month={month} /></div>}
    </Card>
  );
}

const STATUS = { ok: ["accent", "Coincide"], diferencia: ["danger", "Diferencia"], sin_presentar: ["warn", "Falta el CM03"], sin_ventas: ["neutral", "Sin ventas"] } as const;

/** Mes por mes: lo que calcula el sistema solo contra lo presentado en ARCA. */
function YearControl({ checks, current }: { checks: Awaited<ReturnType<typeof loadIibbYear>>["checks"]; current: string }) {
  if (!checks.length) return null;
  const bad = checks.filter((c) => c.status === "diferencia");
  return (
    <Card className="mt-5 overflow-hidden">
      <CardHeader title={`Control ${current.slice(0, 4)}: cálculo del sistema vs. DDJJ presentada`}
        description="El sistema calcula solo cada mes con tus ventas de ARCA, coeficientes, alícuotas, retenciones y SIRCREB, y lo compara con el CM03 que presentaste. Si algo no cierra, lo marca."
        action={bad.length ? <Badge tone="danger">{bad.length} {bad.length === 1 ? "mes con diferencia" : "meses con diferencia"}</Badge> : <Badge tone="accent">Sin diferencias</Badge>} />
      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] text-sm tabular">
          <thead className="text-xs text-fg-subtle"><tr className="border-y border-border">
            <th className="px-5 py-2 text-left font-medium">Mes</th><th className="px-2 text-right font-medium">Ventas netas (ARCA)</th>
            <th className="px-2 text-right font-medium">Impuesto calculado</th><th className="px-2 text-right font-medium">Impuesto en la DDJJ</th><th className="px-2 text-right font-medium">Diferencia</th>
            <th className="px-2 text-right font-medium">A pagar calculado</th><th className="px-2 text-right font-medium">A pagar DDJJ</th><th className="px-5 text-right font-medium">Estado</th>
          </tr></thead>
          <tbody className="divide-y divide-border">
            {checks.map((c) => {
              const [tone, label] = STATUS[c.status];
              return (
                <tr key={c.month} className={cn(c.month === current && "bg-field")}>
                  <td className="px-5 py-2"><Link href={`/impuestos/iibb?m=${c.month}`} className="capitalize hover:underline">{monthLabel(c.month)}</Link></td>
                  <td className="px-2 text-right">{formatMoney(c.sales)}</td>
                  <td className="px-2 text-right">{formatMoney(c.calc.totalTax)}</td>
                  <td className="px-2 text-right">{c.presented ? formatMoney(c.presented.total_tax) : "—"}</td>
                  <td className={cn("px-2 text-right", c.status === "diferencia" && "font-semibold text-danger")}>{c.taxDiff !== null ? formatMoney(c.taxDiff) : "—"}</td>
                  <td className="px-2 text-right">{formatMoney(c.calc.totalDue)}</td>
                  <td className="px-2 text-right">{c.presented ? formatMoney(c.presented.total_due) : "—"}</td>
                  <td className="px-5 text-right"><Badge tone={tone}>{label}</Badge></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {bad.length > 0 && (
        <ul className="space-y-1 border-t border-border px-5 py-3 text-sm">
          {bad.map((c) => c.issues.map((i, n) => <li key={`${c.month}-${n}`} className="text-danger"><b className="capitalize">{monthLabel(c.month)}:</b> {i}. {(c.taxDiff ?? 0) < 0 ? `Se declararon ${formatMoney(-(c.taxDiff ?? 0))} de impuesto de menos.` : `Se declararon ${formatMoney(c.taxDiff)} de más.`}</li>))}
          <li className="text-xs text-fg-subtle">“A pagar” puede diferir además por percepciones de IIBB y saldos a favor que no llegan al sistema; la alícuota y la base se controlan exacto.</li>
        </ul>
      )}
    </Card>
  );
}
