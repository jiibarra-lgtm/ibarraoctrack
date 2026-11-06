import type { Metadata } from "next";
import Link from "next/link";
import { ArrowDownLeft, ArrowUpRight, FileArchive, Percent, Receipt, Scale, ShoppingCart, TrendingUp } from "lucide-react";
import { requireOrg } from "@/lib/session";
import { Badge, Card, CardHeader, EmptyState, PageHeader } from "@/components/ui/primitives";
import { Stat } from "@/components/ui/stat";
import { formatDate, formatMoney } from "@/lib/format";
import { monthLabel } from "@/lib/months";
import { cn } from "@/lib/utils";
import { ComprobantesUploader } from "./uploader";
import { ProfitCalc } from "./profit-calc";

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

export default async function ImpuestosPage({ searchParams }: { searchParams: Promise<{ m?: string; t?: string; q?: string }> }) {
  const sp = await searchParams;
  const s = await requireOrg();
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

  return (
    <>
      <PageHeader title="Impuestos" description="IVA del mes armado con tus comprobantes de ARCA (Mis Comprobantes Emitidos y Recibidos). Las notas de crédito restan." />

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
    </>
  );
}
