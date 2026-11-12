import Link from "next/link";
import { AlertTriangle, ArrowDownLeft, ArrowUpRight, Banknote, CalendarClock, Download, ExternalLink, Landmark, Percent, Receipt, ShoppingCart, TrendingUp } from "lucide-react";
import { Badge, Card, CardHeader } from "@/components/ui/primitives";
import { Stat } from "@/components/ui/stat";
import { formatDate, formatMoney } from "@/lib/format";
import { monthLabel } from "@/lib/months";
import { cn } from "@/lib/utils";
import { gananciasTax, iibbBalances, ivaBalances, upcomingDues, type MonthTax } from "@/lib/taxes";
import { IVA_CONDITIONS } from "@/lib/einvoice";
import { PadronButton, PrintButton, TaxSettingsForm } from "./tax-ui";

export type Monthly = { month: string; direction: "emitido" | "recibido"; vouchers: number; total: string; vat: string; net: string; other_taxes: string };
export type Withholding = { month: string; ret_iibb: string; ret_ganancias: string; ret_iva: string; ret_suss: string; ret_otras: string; sircreb: string; percepciones: string; imp_cheque?: string; imp_cheque_cred?: string; creditos?: string };
export type TaxSettings = {
  iibb_rate: number; iibb_day: number; autonomos: boolean; autonomos_day: number; gni: number; special_deduction: number; other_deductions: number; ganancias_paid: number;
  padron: Persona | null; padron_previous: Persona | null; padron_checked_at: string | null; padron_error: string | null;
};
type Persona = { cuit: string; name: string; address: string | null; status: string | null; ivaCondition: number; taxes: string[]; monotributo: string | null; activity: string | null };

const N = (x: string | number | null | undefined) => Number(x ?? 0);
const nowAr = () => new Date(Date.now() - 3 * 3600e3).toISOString();

export function monthRows(monthly: Monthly[], wh: Withholding[]): MonthTax[] {
  const ms = [...new Set([...monthly.map((x) => x.month), ...wh.map((x) => x.month)])];
  return ms.map((month) => {
    const e = monthly.find((x) => x.month === month && x.direction === "emitido");
    const r = monthly.find((x) => x.month === month && x.direction === "recibido");
    const w = wh.find((x) => x.month === month);
    return { month, debito: N(e?.vat), credito: N(r?.vat), retIva: N(w?.ret_iva), netSales: N(e?.net), retIibb: N(w?.ret_iibb), sircreb: N(w?.sircreb) };
  });
}

export function LibroTab({ m, monthly }: { m: string; monthly: Monthly[] }) {
  const e = monthly.find((x) => x.month === m && x.direction === "emitido");
  const r = monthly.find((x) => x.month === m && x.direction === "recibido");
  return (
    <Card className="mt-5">
      <CardHeader title={`Libro IVA Digital · ${monthLabel(m)}`} description="Los 4 archivos que pide ARCA, armados con tus comprobantes emitidos y recibidos del mes." />
      <div className="space-y-4 px-5 pb-5 text-sm">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat icon={Receipt} label="Ventas" value={String(e?.vouchers ?? 0)} sub={formatMoney(e?.total)} />
          <Stat icon={ArrowUpRight} label="IVA débito" value={formatMoney(e?.vat)} />
          <Stat icon={ShoppingCart} label="Compras" value={String(r?.vouchers ?? 0)} sub={formatMoney(r?.total)} />
          <Stat icon={ArrowDownLeft} label="IVA crédito" value={formatMoney(r?.vat)} />
        </div>
        <a href={`/api/libro-iva?m=${m}`} className="inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 font-medium text-primary-fg"><Download className="size-4" /> Descargar ZIP del Libro IVA de {monthLabel(m)}</a>
        <ol className="list-decimal space-y-1 pl-5 text-fg-muted">
          <li>Entrá a ARCA → <b>Portal IVA</b> → Libro IVA Digital → período {monthLabel(m)}.</li>
          <li>En <b>Ventas</b> → Importación de comprobantes: subí los archivos VENTAS_CBTE y VENTAS_ALICUOTAS.</li>
          <li>En <b>Compras</b>: subí COMPRAS_CBTE y COMPRAS_ALICUOTAS.</li>
          <li>ARCA valida cada línea y te muestra si algo no cierra. Revisalo con tu contador antes de presentar.</li>
        </ol>
        {(!e || !r) && <p className="flex items-center gap-2 text-xs text-warn"><AlertTriangle className="size-4" /> Faltan comprobantes {!e ? "emitidos" : "recibidos"} de este mes: subí Mis Comprobantes primero.</p>}
      </div>
    </Card>
  );
}

export function RetencionesTab({ monthly, wh, settings }: { monthly: Monthly[]; wh: Withholding[]; settings: TaxSettings }) {
  const rows = monthRows(monthly, wh);
  const iva = ivaBalances(rows).reverse().slice(0, 12);
  const iibb = iibbBalances(rows, settings.iibb_rate).reverse().slice(0, 12);
  const whBy = new Map(wh.map((w) => [w.month, w]));
  const year = nowAr().slice(0, 4);
  const ytd = wh.filter((w) => w.month.startsWith(year));
  const s = (k: keyof Withholding) => ytd.reduce((a, w) => a + N(w[k]), 0);
  return (
    <>
      <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat icon={Percent} label={`Percepciones ${year}`} value={formatMoney(s("percepciones"))} sub="en facturas recibidas" />
        <Stat icon={Landmark} label="Retenciones de IVA" value={formatMoney(s("ret_iva"))} sub="en cobros" />
        <Stat icon={Landmark} label="Retenciones de IIBB" value={formatMoney(s("ret_iibb"))} sub="en cobros" />
        <Stat icon={Banknote} label="SIRCREB" value={formatMoney(s("sircreb"))} sub="Banco Ciudad" />
        <Stat icon={Landmark} label="Retenciones de Ganancias" value={formatMoney(s("ret_ganancias"))} sub="en cobros" />
      </div>
      <div className="mt-5 grid gap-5 xl:grid-cols-2">
        <Card className="overflow-hidden">
          <CardHeader title="IVA: saldo mes a mes" description="Débito − crédito, arrastrando el saldo técnico; las retenciones de IVA se descuentan del pago" />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm tabular">
              <thead className="text-xs text-fg-subtle"><tr className="border-b border-border"><th className="px-5 py-2 text-left font-medium">Mes</th><th className="px-2 text-right font-medium">Débito</th><th className="px-2 text-right font-medium">Crédito</th><th className="px-2 text-right font-medium">Retenciones</th><th className="px-2 text-right font-medium">A pagar</th><th className="px-5 text-right font-medium">Saldo a favor</th></tr></thead>
              <tbody className="divide-y divide-border">
                {iva.map((r) => (
                  <tr key={r.month}><td className="px-5 py-2">{monthLabel(r.month)}</td><td className="px-2 text-right">{formatMoney(r.debito)}</td><td className="px-2 text-right">{formatMoney(r.credito)}</td>
                    <td className="px-2 text-right">{formatMoney(r.retIva)}</td><td className={cn("px-2 text-right font-medium", r.aPagar > 0 && "text-warn")}>{formatMoney(r.aPagar)}</td>
                    <td className="px-5 text-right text-accent">{r.saldoTecnico + r.libreDisponibilidad > 0 ? formatMoney(r.saldoTecnico + r.libreDisponibilidad) : "—"}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
        <Card className="overflow-hidden">
          <CardHeader title={`Ingresos Brutos: saldo mes a mes (${String(settings.iibb_rate).replace(".", ",")}%)`} description="Alícuota sobre ventas netas, menos retenciones y SIRCREB; el excedente queda a favor" />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm tabular">
              <thead className="text-xs text-fg-subtle"><tr className="border-b border-border"><th className="px-5 py-2 text-left font-medium">Mes</th><th className="px-2 text-right font-medium">Impuesto</th><th className="px-2 text-right font-medium">Retenciones</th><th className="px-2 text-right font-medium">SIRCREB</th><th className="px-2 text-right font-medium">A pagar</th><th className="px-5 text-right font-medium">A favor</th></tr></thead>
              <tbody className="divide-y divide-border">
                {iibb.map((r) => (
                  <tr key={r.month}><td className="px-5 py-2">{monthLabel(r.month)}</td><td className="px-2 text-right">{formatMoney(r.impuesto)}</td><td className="px-2 text-right">{formatMoney(r.retIibb)}</td>
                    <td className="px-2 text-right">{formatMoney(r.sircreb)}</td><td className={cn("px-2 text-right font-medium", r.aPagar > 0 && "text-warn")}>{formatMoney(r.aPagar)}</td>
                    <td className="px-5 text-right text-accent">{r.saldoFavor > 0 ? formatMoney(r.saldoFavor) : "—"}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
      <Card className="mt-5 overflow-hidden">
        <CardHeader title="Detalle por mes" description="Percepciones en compras, retenciones en cobros y SIRCREB del banco" />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm tabular">
            <thead className="text-xs text-fg-subtle"><tr className="border-b border-border"><th className="px-5 py-2 text-left font-medium">Mes</th><th className="px-2 text-right font-medium">Percepciones</th><th className="px-2 text-right font-medium">Ret. IVA</th><th className="px-2 text-right font-medium">Ret. IIBB</th><th className="px-2 text-right font-medium">Ret. Ganancias</th><th className="px-2 text-right font-medium">SUSS</th><th className="px-5 text-right font-medium">SIRCREB</th></tr></thead>
            <tbody className="divide-y divide-border">
              {[...whBy.values()].sort((a, b) => b.month.localeCompare(a.month)).slice(0, 12).map((w) => (
                <tr key={w.month}><td className="px-5 py-2">{monthLabel(w.month)}</td><td className="px-2 text-right">{formatMoney(w.percepciones)}</td><td className="px-2 text-right">{formatMoney(w.ret_iva)}</td>
                  <td className="px-2 text-right">{formatMoney(w.ret_iibb)}</td><td className="px-2 text-right">{formatMoney(w.ret_ganancias)}</td><td className="px-2 text-right">{formatMoney(w.ret_suss)}</td><td className="px-5 text-right">{formatMoney(w.sircreb)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <p className="mt-3 text-xs text-fg-subtle">Estimación para planificar: el saldo real depende de la DDJJ presentada (y de saldos de períodos anteriores a los cargados). Las retenciones salen de los cobros registrados y el SIRCREB del aviso del Banco Ciudad.</p>
    </>
  );
}

export function GananciasTab({ monthly, wh, settings, fixedYear, canEdit }: { monthly: Monthly[]; wh: Withholding[]; settings: TaxSettings; fixedYear: number; canEdit: boolean }) {
  const now = nowAr().slice(0, 7);
  const year = now.slice(0, 4);
  const elapsed = Number(now.slice(5, 7));
  const ms = monthly.filter((x) => x.month.startsWith(year));
  const ventas = ms.filter((x) => x.direction === "emitido").reduce((a, x) => a + N(x.net), 0);
  const compras = ms.filter((x) => x.direction === "recibido").reduce((a, x) => a + N(x.net), 0);
  const ytd = ventas - compras;
  const annual = (ytd / Math.max(1, elapsed)) * 12;
  const gastosSinFactura = fixedYear;
  const deducciones = N(settings.gni) + N(settings.special_deduction) + N(settings.other_deductions);
  const imponible = annual - gastosSinFactura - deducciones;
  const { tax, bracket } = gananciasTax(imponible);
  const retenciones = wh.filter((w) => w.month.startsWith(year)).reduce((a, w) => a + N(w.ret_ganancias), 0);
  // Ley 25.413: 33% del impuesto sobre créditos se computa a cuenta de Ganancias
  const chequeComputable = wh.filter((w) => w.month.startsWith(year)).reduce((a, w) => a + N(w.imp_cheque_cred), 0) * 0.33;
  const saldo = tax - retenciones - chequeComputable - N(settings.ganancias_paid);
  return (
    <>
      <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat icon={TrendingUp} label={`Resultado ${year} hasta hoy`} value={formatMoney(ytd)} sub={`ventas netas ${formatMoney(ventas)} − compras ${formatMoney(compras)}`} />
        <Stat icon={TrendingUp} label="Proyección al cierre del año" value={formatMoney(annual)} sub={`a ritmo de ${elapsed} meses`} />
        <Stat icon={Landmark} label="Impuesto estimado del año" value={formatMoney(tax)} tone="warn" sub={imponible > 0 ? `tramo ${bracket.rate}% · imponible ${formatMoney(imponible)}` : "por debajo de las deducciones"} />
        <Stat icon={Banknote} label={saldo >= 0 ? "Saldo a pagar estimado" : "Saldo a favor estimado"} value={formatMoney(Math.abs(saldo))} tone={saldo > 0 ? "warn" : "accent"} sub={`menos retenciones ${formatMoney(retenciones)}, imp. al cheque ${formatMoney(chequeComputable)} y anticipos ${formatMoney(settings.ganancias_paid)}`} />
      </div>
      <div className="mt-5 grid gap-5 xl:grid-cols-2">
        <Card>
          <CardHeader title="Cómo se calcula" description="Escala anual del art. 94 (ARCA, período 2026)" />
          <ul className="divide-y divide-border text-sm tabular">
            {[["Proyección anual (ventas − compras, sin IVA)", annual], ["− Gastos sin factura (sueldos, alquiler… de Gastos fijos)", -gastosSinFactura], ["− Ganancia no imponible", -N(settings.gni)], ["− Deducción especial", -N(settings.special_deduction)], ["− Otras deducciones", -N(settings.other_deductions)], ["= Ganancia imponible estimada", imponible], ["Impuesto (escala)", tax]].map(([l, v]) => (
              <li key={String(l)} className="flex justify-between gap-3 px-5 py-2"><span className="text-fg-muted">{l}</span><span className="font-medium">{formatMoney(Number(v))}</span></li>
            ))}
          </ul>
          <p className="px-5 pb-4 pt-2 text-xs text-fg-subtle">Es una proyección para planificar: no incluye amortizaciones, intereses ni otras deducciones que arma tu contador en la DDJJ anual.</p>
        </Card>
        <Card>
          <CardHeader title="Tus datos impositivos" description="Deducciones y datos para calcular saldos y vencimientos" />
          <TaxSettingsForm disabled={!canEdit} initial={{ iibb_rate: N(settings.iibb_rate), iibb_day: N(settings.iibb_day), autonomos: settings.autonomos, autonomos_day: N(settings.autonomos_day), gni: N(settings.gni), special_deduction: N(settings.special_deduction), other_deductions: N(settings.other_deductions), ganancias_paid: N(settings.ganancias_paid) }} />
        </Card>
      </div>
    </>
  );
}

const PADRON_FIELDS: [keyof Persona, string][] = [["name", "Nombre"], ["address", "Domicilio fiscal"], ["status", "Estado de la clave"], ["ivaCondition", "Condición de IVA"], ["monotributo", "Monotributo"], ["activity", "Actividad"]];
const showField = (p: Persona, k: keyof Persona) => k === "ivaCondition" ? IVA_CONDITIONS[p.ivaCondition]?.label ?? String(p.ivaCondition) : String(p[k] ?? "—");

export function VencimientosTab({ cuit, settings, canEdit }: { cuit: string; settings: TaxSettings; canEdit: boolean }) {
  const now = nowAr().slice(0, 10);
  const dues = upcomingDues(cuit, now.slice(0, 7), 3, { iibb_day: N(settings.iibb_day), autonomos: settings.autonomos, autonomos_day: N(settings.autonomos_day) }).filter((d) => d.date >= now);
  const p = settings.padron, prev = settings.padron_previous;
  const changes = p && prev ? PADRON_FIELDS.filter(([k]) => showField(p, k) !== showField(prev, k)) : [];
  const taxChanges = p && prev ? [...p.taxes.filter((t) => !prev.taxes.includes(t)).map((t) => `Alta: ${t.split(":")[1]}`), ...prev.taxes.filter((t) => !p.taxes.includes(t)).map((t) => `Baja: ${t.split(":")[1]}`)] : [];
  return (
    <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
      <Card className="self-start">
        <CardHeader title="Próximos vencimientos" description={`CUIT terminado en ${cuit.slice(-1)} · calculados por regla, ARCA puede mover fechas`} />
        <ul className="divide-y divide-border">
          {dues.map((d) => {
            const days = Math.round((Date.parse(d.date) - Date.parse(now)) / 864e5);
            return (
              <li key={`${d.kind}${d.date}`} className="flex items-center gap-4 px-5 py-3 text-sm">
                <CalendarClock className={cn("size-4 shrink-0", days <= 3 ? "text-danger" : days <= 7 ? "text-warn" : "text-fg-subtle")} />
                <div className="min-w-0 flex-1"><p className="font-medium">{d.title}</p><p className="text-xs text-fg-subtle">{d.detail}</p></div>
                <div className="text-right"><p className="font-medium tabular">{formatDate(d.date)}</p><p className={cn("text-xs", days <= 3 ? "text-danger" : "text-fg-subtle")}>{days === 0 ? "hoy" : `en ${days} días`}</p></div>
              </li>
            );
          })}
        </ul>
        <p className="px-5 pb-4 pt-2 text-xs text-fg-subtle">
          Confirmá en el <a href="https://www.arca.gob.ar/vencimientos/" target="_blank" rel="noreferrer" className="underline">calendario oficial de ARCA</a> y el de AGIP para IIBB. El día de IIBB y autónomos se configura en la pestaña Ganancias.
        </p>
      </Card>
      <Card className="self-start">
        <CardHeader title="Tu situación en el padrón de ARCA" description={settings.padron_checked_at ? `Revisado ${formatDate(settings.padron_checked_at)} · se revisa solo una vez por día` : "Todavía no se revisó"} action={canEdit && <PadronButton />} />
        <div className="px-5 pb-5 text-sm">
          {(changes.length > 0 || taxChanges.length > 0) && (
            <div className="mb-3 rounded-xl border border-warn/40 bg-warn/10 p-3">
              <p className="flex items-center gap-2 font-medium"><AlertTriangle className="size-4 text-warn" /> Cambió tu situación en el padrón</p>
              <ul className="mt-1 list-disc pl-5 text-xs">
                {changes.map(([k, l]) => <li key={k}>{l}: {showField(prev!, k)} → <b>{showField(p!, k)}</b></li>)}
                {taxChanges.map((t) => <li key={t}>{t}</li>)}
              </ul>
            </div>
          )}
          {p ? (
            <dl className="space-y-1.5">
              {PADRON_FIELDS.map(([k, l]) => <div key={k} className="flex justify-between gap-3"><dt className="text-fg-subtle">{l}</dt><dd className="text-right">{showField(p, k)}</dd></div>)}
              <div className="pt-1"><dt className="text-fg-subtle">Impuestos inscriptos</dt><dd className="mt-1 flex flex-wrap gap-1">{p.taxes.map((t) => <Badge key={t}>{t.split(":")[1]}</Badge>)}</dd></div>
            </dl>
          ) : settings.padron_error ? <p className="text-xs text-warn">{settings.padron_error}</p> : <p className="text-xs text-fg-subtle">Tocá “Revisar padrón ahora”.</p>}
          <a href={`https://seti.afip.gob.ar/padron-puc-constancia-internet/ConsultaConstanciaAction.do`} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1 text-xs text-fg-subtle hover:text-fg">Descargar la constancia oficial de inscripción <ExternalLink className="size-3" /></a>
        </div>
      </Card>
    </div>
  );
}

export function CierreTab({ m, monthly, wh, fixedMonth, variablesMonth }: { m: string; monthly: Monthly[]; wh: Withholding[]; fixedMonth: number; variablesMonth: number }) {
  const e = monthly.find((x) => x.month === m && x.direction === "emitido");
  const r = monthly.find((x) => x.month === m && x.direction === "recibido");
  const w = wh.find((x) => x.month === m);
  const ventasNet = N(e?.net), comprasNet = N(r?.net);
  const resultado = ventasNet - comprasNet - fixedMonth - variablesMonth;
  const rows: [string, number, boolean?][] = [
    ["Facturación total (con IVA)", N(e?.total)], ["Ventas netas (sin IVA)", ventasNet], ["Compras totales (con IVA)", N(r?.total)], ["Compras netas (sin IVA)", comprasNet],
    ["IVA débito", N(e?.vat)], ["IVA crédito", N(r?.vat)], ["IVA del mes (débito − crédito)", N(e?.vat) - N(r?.vat), true],
    ["Percepciones sufridas", N(w?.percepciones)], ["Retenciones de IVA", N(w?.ret_iva)], ["Retenciones de IIBB", N(w?.ret_iibb)], ["Retenciones de Ganancias", N(w?.ret_ganancias)], ["SIRCREB", N(w?.sircreb)],
    ["Gastos fijos sin factura del mes", fixedMonth], ["Gastos variables del mes", variablesMonth],
    ["Resultado estimado (ventas − compras − gastos, sin IVA)", resultado, true],
  ];
  return (
    <Card className="mt-5">
      <CardHeader title={`Cierre de ${monthLabel(m)}`} description={`${e?.vouchers ?? 0} comprobantes emitidos · ${r?.vouchers ?? 0} recibidos`} action={<div className="no-print flex gap-2"><a href={`/api/libro-iva?m=${m}`} className="inline-flex h-8 items-center gap-1.5 rounded-full border border-card-border bg-field px-3 text-[13px]"><Download className="size-4" /> Libro IVA</a><PrintButton /></div>} />
      <ul className="divide-y divide-border text-sm tabular">
        {rows.map(([l, v, strong]) => <li key={l} className={cn("flex justify-between gap-3 px-5 py-2", strong && "bg-surface-2/50 font-semibold")}><span className={strong ? "" : "text-fg-muted"}>{l}</span><span>{formatMoney(v)}</span></li>)}
      </ul>
      <p className="px-5 pb-4 pt-2 text-xs text-fg-subtle">Para mandarle al contador: imprimí o guardá en PDF esta hoja junto con el ZIP del Libro IVA. <Link href={`/impuestos?m=${m}&v=retenciones`} className="underline">Ver retenciones y saldos</Link>.</p>
    </Card>
  );
}
