import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, ArrowDownLeft, ArrowUpRight, FileArchive, Percent, Receipt, Scale, ShoppingCart, TrendingUp } from "lucide-react";
import { requireOrg } from "@/lib/session";
import { Badge, Card, CardHeader, EmptyState, PageHeader } from "@/components/ui/primitives";
import { Stat } from "@/components/ui/stat";
import { formatDate, formatMoney } from "@/lib/format";
import { monthLabel } from "@/lib/months";
import { cn } from "@/lib/utils";
import { ComprobantesUploader } from "./uploader";
import { ProfitCalc } from "./profit-calc";
import { after } from "next/server";
import { canBill } from "@/lib/billing";
import { refreshPadron, syncEmitted } from "@/lib/tax-sync";
import { SyncEmittedButton } from "./tax-ui";
import { CierreTab, GananciasTab, LibroTab, RetencionesTab, VencimientosTab, type TaxSettings, type Withholding } from "./tax-tabs";

const VIEWS = [["iva", "IVA del mes"], ["libro", "Libro IVA Digital"], ["retenciones", "Retenciones y saldos"], ["ganancias", "Ganancias"], ["vencimientos", "Vencimientos y padrón"], ["cierre", "Cierre de mes"]] as const;
const DEFAULT_SETTINGS = { iibb_rate: 3, iibb_day: 15, autonomos: false, autonomos_day: 5, gni: 5151802.5, special_deduction: 5151802.5, other_deductions: 0, ganancias_paid: 0, padron: null, padron_previous: null, padron_checked_at: null, padron_error: null, emitted_synced_at: null, emitted_sync_error: null };
const ageMin = (iso: string | null) => (iso ? (Date.now() - Date.parse(iso)) / 60000 : Infinity);
const nowArIso = () => new Date(Date.now() - 3 * 3600e3).toISOString();

export const metadata: Metadata = { title: "Impuestos" };

type V = {
  id: string; direction: "emitido" | "recibido"; issue_date: string; voucher_type: number; point_of_sale: number; number: number;
  doc_number: string | null; name: string; currency: string; exchange_rate: number; net_taxed: number; net_untaxed: number; exempt: number;
  other_taxes: number; vat: number; total: number; credit_note: boolean; letter: string | null; sign: number;
  purchase_order_id: string | null; po_number: string | null; supplier_id: string | null; supplier_name: string | null; purchase_id: string | null;
};

const TYPE: Record<number, string> = {
  1: "Factura A", 2: "N. Débito A", 3: "N. Crédito A", 6: "Factura B", 7: "N. Débito B", 8: "N. Crédito B",
  11: "Factura C", 12: "N. Débito C", 13: "N. Crédito C", 51: "Factura M", 52: "N. Débito M", 53: "N. Crédito M",
  201: "FCE A", 202: "ND FCE A", 203: "NC FCE A", 206: "FCE B", 207: "ND FCE B", 208: "NC FCE B", 211: "FCE C", 212: "ND FCE C", 213: "NC FCE C",
};
const label = (v: V) => `${TYPE[v.voucher_type] ?? `Tipo ${v.voucher_type}`} ${String(v.point_of_sale).padStart(5, "0")}-${String(v.number).padStart(8, "0")}`;
/** Importe en pesos y con signo (las notas de crédito restan) */
const ars = (v: V, k: "vat" | "total" | "net_taxed" | "other_taxes") => Number(v[k]) * Number(v.exchange_rate || 1) * Number(v.sign);
const sum = (xs: V[], k: Parameters<typeof ars>[1]) => xs.reduce((a, v) => a + ars(v, k), 0);
const neto = (xs: V[]) => xs.reduce((a, v) => a + (Number(v.net_taxed) + Number(v.net_untaxed) + Number(v.exempt)) * Number(v.exchange_rate || 1) * Number(v.sign), 0);

export default async function ImpuestosPage({ searchParams }: { searchParams: Promise<{ m?: string; t?: string; q?: string; v?: string }> }) {
  const sp = await searchParams;
  const s = await requireOrg();
  const org = s.org.org_id;
  const view = (VIEWS.find(([k]) => k === sp.v)?.[0] ?? "iva") as (typeof VIEWS)[number][0];
  const billing = canBill(s.org.role);
  const [{ data: tsData }, { data: whData }, { data: issuer }, { data: arcaSt }] = await Promise.all([
    s.supabase.from("tax_settings").select("*").eq("org_id", org).maybeSingle(),
    s.supabase.from("tax_withholdings_monthly").select("*").eq("org_id", org).order("month", { ascending: false }).limit(36),
    s.supabase.from("remito_settings").select("cuit").eq("org_id", org).maybeSingle(),
    s.supabase.rpc("arca_conn", { p_action: "status", p_org: org }),
  ]);
  const settings = { ...DEFAULT_SETTINGS, ...(tsData ?? {}) } as TaxSettings & { emitted_synced_at: string | null; emitted_sync_error: string | null };
  const wh = (whData ?? []) as Withholding[];
  const st = (arcaSt ?? {}) as { has_cert?: boolean; cuit?: string };
  const ownCuit = String(st.cuit ?? issuer?.cuit ?? "").replace(/\D/g, "");
  // Automático: trae los emitidos de ARCA cada 30 minutos y revisa el padrón una vez por día (al abrir la pantalla)
  if (billing && st.has_cert) {
    const sb = s.supabase;
    if (ageMin(settings.emitted_synced_at) > 30) after(() => syncEmitted(sb, org).catch(() => null));
    if (ageMin(settings.padron_checked_at) > 24 * 60) after(() => refreshPadron(sb, org).catch(() => null));
  }
  // Resumen por mes desde la base (no hay límite de filas) y sólo los comprobantes del mes elegido
  const { data: mon } = await s.supabase.from("arca_monthly").select("*").eq("org_id", s.org.org_id).order("month", { ascending: false }).limit(500);
  const monthly = (mon ?? []) as { month: string; direction: "emitido" | "recibido"; vouchers: number; total: string; vat: string; net: string; other_taxes: string }[];
  const writable = ["admin", "finanzas", "compras"].includes(s.org.role);

  const months = [...new Set(monthly.map((x) => x.month))].sort().reverse();
  const m = sp.m && /^\d{4}-\d{2}$/.test(sp.m) ? sp.m : months[0] ?? new Date().toISOString().slice(0, 7);
  const t = sp.t === "recibido" ? "recibido" : "emitido";
  const q = (sp.q ?? "").trim().toLowerCase();

  const [y, mm] = m.split("-").map(Number);
  const next = new Date(Date.UTC(y, mm, 1)).toISOString().slice(0, 10);
  const ofMonth: V[] = [];
  for (let from = 0; from < 20000; from += 1000) {
    const { data } = await s.supabase.from("arca_vouchers_overview").select("*").eq("org_id", s.org.org_id)
      .gte("issue_date", `${m}-01`).lt("issue_date", next).order("issue_date", { ascending: false }).order("id").range(from, from + 999);
    ofMonth.push(...((data ?? []) as V[]));
    if (!data || data.length < 1000) break;
  }
  const all = monthly;
  const em = ofMonth.filter((v) => v.direction === "emitido");
  const re = ofMonth.filter((v) => v.direction === "recibido");
  const debito = sum(em, "vat"), credito = sum(re, "vat"), saldo = debito - credito;
  const percep = sum(re, "other_taxes");
  const facturado = sum(em, "total"), comprado = sum(re, "total");

  const rows = (t === "emitido" ? em : re)
    .filter((v) => !q || [v.name, v.doc_number, String(v.number), v.po_number, v.supplier_name].some((x) => x?.toLowerCase().includes(q)))
    .sort((a, b) => b.issue_date.localeCompare(a.issue_date) || b.number - a.number);

  // Por alícuota del mes (solo si el archivo trae el detalle)
  const rates = new Map<string, { debito: number; credito: number }>();
  for (const v of ofMonth) {
    const d = (v as V & { vat_detail?: Record<string, { iva: number }> }).vat_detail ?? {};
    for (const [k, x] of Object.entries(d)) {
      const e = rates.get(k) ?? { debito: 0, credito: 0 };
      const val = Number(x.iva) * Number(v.exchange_rate || 1) * Number(v.sign);
      if (v.direction === "emitido") e.debito += val; else e.credito += val;
      rates.set(k, e);
    }
  }

  const yearNet = monthly.filter((x) => x.direction === "emitido" && x.month.startsWith(m.slice(0, 4)) && x.month <= m).reduce((a, x) => a + Number(x.net), 0);
  const history = months.slice(0, 24).map((k) => {
    const e = monthly.find((x) => x.month === k && x.direction === "emitido");
    const r = monthly.find((x) => x.month === k && x.direction === "recibido");
    const d = Number(e?.vat ?? 0), c = Number(r?.vat ?? 0);
    return { k, d, c, s: d - c, ventas: Number(e?.total ?? 0), compras: Number(r?.total ?? 0) };
  });

  const href = (p: Record<string, string>) => `/impuestos?${new URLSearchParams({ m, t, ...(q ? { q } : {}), ...p })}`;

  // Gastos sin factura (sueldos, alquiler, honorarios cargados a mano o detectados del banco) y variables del mes
  const [{ data: fcData }, { data: payData }, { data: siData }] = await Promise.all([
    s.supabase.from("fixed_costs").select("amount, frequency, source, active").eq("org_id", org).eq("active", true),
    s.supabase.from("payments_out_overview").select("amount, kind, cost_id, ignored, final_category").eq("org_id", org).gte("paid_at", `${m}-01`).lt("paid_at", next).limit(2000),
    s.supabase.from("supplier_invoices").select("id, issue_date, supplier_name, letter, total, net, items_net, arca_voucher_id, point_of_sale, number, mail_id").eq("org_id", org).eq("hidden", false).gte("issue_date", `${m}-01`).lt("issue_date", next).limit(2000),
  ]);
  const fixedMonthly = ((fcData ?? []) as { amount: string; frequency: number; source: string }[]).filter((c) => !["arca", "mail"].includes(c.source)).reduce((a, c) => a + Number(c.amount) / Math.max(1, Number(c.frequency) || 1), 0);
  const variablesMonth = ((payData ?? []) as { amount: string; kind: string; cost_id: string | null; ignored: boolean; final_category: string }[])
    .filter((p) => !p.cost_id && !p.ignored && p.kind !== "resumen_tarjeta" && !["proveedores", "compras"].includes(p.final_category)).reduce((a, p) => a + Number(p.amount), 0);
  // Recordatorio: los recibidos del mes anterior todavía no se subieron
  const nowIso = nowArIso();
  const curMonth = nowIso.slice(0, 7);
  const prevMonth = new Date(Date.UTC(Number(curMonth.slice(0, 4)), Number(curMonth.slice(5, 7)) - 2, 1)).toISOString().slice(0, 7);
  const reminder = Number(nowIso.slice(8, 10)) <= 20 && monthly.length > 0 && !monthly.some((x) => x.month === prevMonth && x.direction === "recibido") ? prevMonth : null;
  // Control: comprobantes de ARCA sin PDF y PDFs del mail que ARCA todavía no tiene
  type SI = { id: string; issue_date: string | null; supplier_name: string; letter: string | null; total: string | null; net: string | null; items_net: string | null; arca_voucher_id: string | null; point_of_sale: number | null; number: number | null; mail_id: string | null };
  const sis = (siData ?? []) as SI[];
  const withPdf = new Set(sis.map((x) => x.arca_voucher_id).filter(Boolean));
  const sinPdf = re.filter((v) => !withPdf.has(v.id) && Number(v.total) > 0);
  const noArca = sis.filter((x) => !x.arca_voucher_id);
  const extraCredit = noArca.filter((x) => x.letter === "A").reduce((a, x) => a + Math.max(0, Number(x.total ?? 0) - Number(x.net ?? x.items_net ?? x.total ?? 0)), 0);

  return (
    <>
      <PageHeader title="Impuestos" description="IVA, Libro IVA Digital, retenciones, Ganancias y vencimientos, armados con tus comprobantes de ARCA. Las notas de crédito restan."
        actions={billing && st.has_cert ? <SyncEmittedButton /> : undefined} />

      <div className="mb-4 flex flex-wrap gap-1.5">
        {VIEWS.map(([k, l]) => (
          <Link key={k} href={`/impuestos?${new URLSearchParams({ m, v: k })}`} className={cn("rounded-full px-3 py-1.5 text-xs font-semibold", view === k ? "bg-primary text-primary-fg" : "bg-field text-fg-muted hover:text-fg")}>{l}</Link>
        ))}
      </div>
      {settings.emitted_sync_error && view === "iva" && <p className="mb-3 text-xs text-warn">No se pudieron traer los emitidos de ARCA: {settings.emitted_sync_error}</p>}

      {view === "libro" ? <LibroTab m={m} monthly={monthly} />
        : view === "retenciones" ? <RetencionesTab monthly={monthly} wh={wh} settings={settings} />
        : view === "ganancias" ? <GananciasTab monthly={monthly} wh={wh} settings={settings} fixedYear={fixedMonthly * 12} canEdit={billing} />
        : view === "vencimientos" ? <VencimientosTab cuit={ownCuit} settings={settings} canEdit={billing} />
        : view === "cierre" ? <CierreTab m={m} monthly={monthly} wh={wh} fixedMonth={fixedMonthly} variablesMonth={variablesMonth} />
        : <>
      {reminder && <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-warn/40 bg-warn/10 px-4 py-3 text-sm"><AlertTriangle className="size-4 text-warn" /> Todavía no cargaste los comprobantes <b>recibidos</b> de {monthLabel(reminder)}: bajá Mis Comprobantes → Recibidos de ese mes y subilo acá abajo.</div>}
      <ComprobantesUploader disabled={!writable} />

      {!all.length ? (
        <Card className="mt-5">
          <EmptyState icon={<FileArchive />} title="Todavía no cargaste comprobantes"
            description="En ARCA entrá a Mis Comprobantes → Emitidos (y después Recibidos), elegí el período, tocá Buscar y descargá el CSV. Subí los ZIP acá arriba." />
        </Card>
      ) : (
        <>
          <div className="mt-5 flex flex-wrap gap-1.5">
            {months.slice(0, 24).map((k) => (
              <Link key={k} href={href({ m: k })} className={cn("rounded-full px-3 py-1 text-xs font-medium", k === m ? "bg-primary text-primary-fg" : "bg-field text-fg-muted hover:text-fg")}>{monthLabel(k)}</Link>
            ))}
          </div>

          <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-3">
            <Stat icon={Receipt} label="Facturación total (ventas)" value={formatMoney(facturado)} sub={`${em.length} comprobantes · neto ${formatMoney(neto(em))}`} href={href({ t: "emitido" })} tone="accent" />
            <Stat icon={ShoppingCart} label="Compras totales" value={formatMoney(comprado)} sub={`${re.length} comprobantes · neto ${formatMoney(neto(re))}`} href={href({ t: "recibido" })} />
            <Stat icon={TrendingUp} label="Ventas − compras (neto)" value={formatMoney(neto(em) - neto(re))} tone={neto(em) - neto(re) < 0 ? "warn" : undefined} sub={`${monthLabel(m)} · sin IVA`} />
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat icon={ArrowUpRight} label="IVA débito (ventas)" value={formatMoney(debito)} sub={`${em.length} emitidos · neto ${formatMoney(neto(em))}`} href={href({ t: "emitido" })} />
            <Stat icon={ArrowDownLeft} label="IVA crédito (compras)" value={formatMoney(credito)} sub={`${re.length} recibidos · neto ${formatMoney(neto(re))}`} href={href({ t: "recibido" })} />
            <Stat icon={Scale} label={saldo >= 0 ? "IVA a pagar" : "Saldo a favor"} value={formatMoney(Math.abs(saldo))} tone={saldo > 0 ? "warn" : "accent"} sub={`${monthLabel(m)} · antes de retenciones y saldos anteriores`} />
            <Stat icon={Percent} label="Percepciones y otros tributos" value={formatMoney(percep)} sub="en comprobantes recibidos" />
          </div>

          <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
            <Card className="min-w-0 overflow-hidden">
              <div className="flex flex-wrap items-center gap-1.5 border-b border-border px-4 py-3 sm:px-5">
                {([["emitido", `Emitidos (${em.length})`], ["recibido", `Recibidos (${re.length})`]] as const).map(([k, l]) => (
                  <Link key={k} href={href({ t: k })} className={cn("rounded-full px-3 py-1 text-xs font-medium", t === k ? "bg-primary text-primary-fg" : "bg-field text-fg-muted hover:text-fg")}>{l}</Link>
                ))}
                <form className="ml-auto" action="/impuestos">
                  <input type="hidden" name="m" value={m} /><input type="hidden" name="t" value={t} />
                  <input name="q" defaultValue={sp.q ?? ""} placeholder="Buscar nombre, CUIT o número" className="h-8 w-56 rounded-full border border-card-border bg-field px-3 text-xs outline-none focus:border-border-strong" />
                </form>
              </div>
              {!rows.length ? <EmptyState title="Sin comprobantes" description={q ? "Nada coincide con la búsqueda." : `No hay ${t === "emitido" ? "emitidos" : "recibidos"} en ${monthLabel(m)}.`} /> : (
                <ul className="divide-y divide-border">
                  {rows.map((v) => (
                    <li key={v.id} className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-center sm:gap-4 sm:px-5">
                      <div className="min-w-0 flex-1">
                        <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                          <span className="tabular">{label(v)}</span>
                          {v.credit_note && <Badge tone="warn">Resta</Badge>}
                          {v.purchase_order_id && <Link href={`/ordenes/${v.purchase_order_id}?tab=facturacion`}><Badge tone="accent">OC {v.po_number}</Badge></Link>}
                          {v.purchase_id && <Link href={`/compras/${v.purchase_id}`}><Badge tone="accent">Compra cargada</Badge></Link>}
                        </p>
                        <p className="truncate text-xs text-fg-subtle">
                          {formatDate(v.issue_date)} · {v.supplier_name ?? (v.name || "—")}
                          {v.doc_number ? ` · CUIT ${v.doc_number}` : ""}{v.currency !== "ARS" ? ` · ${v.currency} a ${v.exchange_rate}` : ""}
                        </p>
                      </div>
                      <div className="text-right text-sm tabular sm:w-44">
                        <p className={cn("font-medium", v.credit_note && "text-warn")}>{formatMoney(ars(v, "total"))}</p>
                        <p className="text-xs text-fg-subtle">IVA {formatMoney(ars(v, "vat"))}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <div className="flex flex-col gap-5 self-start">
              <Card>
                <CardHeader title="Control del mes" description="ARCA contra las facturas en PDF que llegaron al mail" />
                <div className="space-y-2 px-5 pb-4 text-sm">
                  <p className="flex justify-between"><span className="text-fg-muted">Recibidos en ARCA sin PDF</span><b className={sinPdf.length ? "text-warn" : ""}>{sinPdf.length}</b></p>
                  {sinPdf.slice(0, 6).map((v) => <p key={v.id} className="truncate text-xs text-fg-subtle">· {v.name || v.doc_number} · {label(v)} · {formatMoney(v.total)}</p>)}
                  {sinPdf.length > 6 && <p className="text-xs text-fg-subtle">y {sinPdf.length - 6} más (pedíselos al proveedor o subilos en Precios de proveedores)</p>}
                  <p className="flex justify-between pt-1"><span className="text-fg-muted">PDFs del mail que ARCA no tiene</span><b className={noArca.length ? "text-warn" : ""}>{noArca.length}</b></p>
                  {noArca.slice(0, 6).map((x) => <p key={x.id} className="truncate text-xs text-fg-subtle">· {x.supplier_name} · {x.point_of_sale ? `${String(x.point_of_sale).padStart(5, "0")}-${String(x.number ?? 0).padStart(8, "0")}` : "sin número"} · {formatMoney(x.total)}</p>)}
                  {m === curMonth && extraCredit > 0 && <p className="border-t border-border pt-2 text-xs">IVA estimado del mes con las facturas del mail: <b className="tabular">{formatMoney(saldo - extraCredit)}</b> (crédito extra {formatMoney(extraCredit)} que ARCA todavía no muestra)</p>}
                </div>
              </Card>
              <ProfitCalc monthNet={neto(em)} yearNet={yearNet} monthLabel={monthLabel(m)} yearLabel={`ene–${monthLabel(m).split(" ")[0]} ${m.slice(0, 4)}`} />
              {rates.size > 0 && (
                <Card>
                  <CardHeader title="Por alícuota" description={monthLabel(m)} />
                  <table className="w-full text-sm tabular">
                    <thead><tr className="text-xs text-fg-subtle"><th className="px-4 py-2 text-left font-medium sm:px-5">Alícuota</th><th className="px-2 py-2 text-right font-medium">Débito</th><th className="px-4 py-2 text-right font-medium sm:px-5">Crédito</th></tr></thead>
                    <tbody className="divide-y divide-border">
                      {[...rates].sort((a, b) => Number(b[0]) - Number(a[0])).map(([k, x]) => (
                        <tr key={k}><td className="px-4 py-2 sm:px-5">{k.replace(".", ",")}%</td><td className="px-2 py-2 text-right">{formatMoney(x.debito)}</td><td className="px-4 py-2 text-right sm:px-5">{formatMoney(x.credito)}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </Card>
              )}
              <Card>
                <CardHeader title="Mes a mes" description="Facturado · IVA débito − crédito" />
                <ul className="divide-y divide-border">
                  {history.map((h) => (
                    <li key={h.k}>
                      <Link href={href({ m: h.k })} className={cn("flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-surface-2/60 sm:px-5", h.k === m && "bg-surface-2/60")}>
                        <span className="w-14 font-medium">{monthLabel(h.k)}</span>
                        <span className="flex-1 truncate text-xs text-fg-subtle tabular">Fact. {formatMoney(h.ventas)}</span>
                        <span className={cn("tabular font-medium", h.s > 0 ? "text-warn" : "text-accent")}>{formatMoney(h.s)}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </Card>
            </div>
          </div>
        </>
      )}
      </>}
    </>
  );
}
