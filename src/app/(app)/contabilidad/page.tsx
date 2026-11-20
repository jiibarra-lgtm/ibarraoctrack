import type { Metadata } from "next";
import Link from "next/link";
import { BookOpen, Download, Scale, TrendingUp, Wallet } from "lucide-react";
import { requireOrg } from "@/lib/session";
import { canBill } from "@/lib/billing";
import { Badge, Card, CardHeader, EmptyState, PageHeader } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { Stat } from "@/components/ui/stat";
import { formatDate, formatMoney } from "@/lib/format";
import { ACC_TYPE, ledger, statements, trialBalance, type Account, type TrialRow } from "@/lib/accounting";
import { cn } from "@/lib/utils";
import { AccountForm, DeleteEntryButton, GenerateButton, ManualEntryDialog } from "./ui";

export const metadata: Metadata = { title: "Contabilidad" };

const VIEWS = [["diario", "Libro diario"], ["mayor", "Mayor"], ["balance", "Sumas y saldos"], ["estados", "Resultados y patrimonio"], ["plan", "Plan de cuentas"]] as const;
const nowAr = () => new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);
const ymd = /^\d{4}-\d{2}-\d{2}$/;
const SOURCE: Record<string, string> = { venta: "Venta", compra: "Compra", banco: "Banco", caja: "Caja", cheque: "Cheque", cheque_estado: "Cheque", iibb: "IIBB", apertura: "Apertura", manual: "Manual" };

export default async function ContabilidadPage({ searchParams }: { searchParams: Promise<{ v?: string; from?: string; to?: string; a?: string }> }) {
  const sp = await searchParams;
  const v = VIEWS.some(([k]) => k === sp.v) ? sp.v! : "diario";
  const today = nowAr();
  const yearly = v === "balance" || v === "estados";
  const from = ymd.test(sp.from ?? "") ? sp.from! : yearly ? `${today.slice(0, 4)}-01-01` : `${today.slice(0, 7)}-01`;
  const to = ymd.test(sp.to ?? "") && sp.to! >= from ? sp.to! : today;
  const acc = sp.a ?? "1.1.02";
  const s = await requireOrg();
  const sb = s.supabase, org = s.org.org_id;
  const edit = canBill(s.org.role);
  const q = (extra: Record<string, string>) => `/contabilidad?${new URLSearchParams({ v, from, to, ...(v === "mayor" ? { a: acc } : {}), ...extra })}`;

  const [{ data: accData }, { count: autoCount }, { data: tbData }, { data: bal }] = await Promise.all([
    sb.from("acc_accounts").select("code, name, type, imputable, active").eq("org_id", org).order("code"),
    sb.from("acc_entries").select("id", { count: "exact", head: true }).eq("org_id", org).eq("auto", true).gte("entry_date", from).lte("entry_date", to),
    sb.rpc("acc_trial_balance", { p_org: org, p_from: from, p_to: to }),
    sb.from("bank_balances").select("balance, as_of").eq("org_id", org).lt("as_of", `${to}T23:59:59-03:00`).order("as_of", { ascending: false }).limit(1),
  ]);
  const accounts = ((accData ?? []) as Account[]).sort((a, b) => a.code.localeCompare(b.code, "en", { numeric: true }));
  const name = new Map(accounts.map((a) => [a.code, a.name]));
  const rows = ((tbData ?? []) as TrialRow[]).map((r) => ({ account_code: r.account_code, debit: Number(r.debit), credit: Number(r.credit), opening: Number(r.opening) }));
  const st = statements(accounts, rows);
  const bankBook = rows.filter((r) => r.account_code === "1.1.02").reduce((a, r) => a + r.opening + r.debit - r.credit, 0);
  const bankReal = bal?.[0] ? Number(bal[0].balance) : null;
  const review = rows.filter((r) => r.account_code === "9.9.01" || r.account_code === "1.1.04").reduce((a, r) => a + r.opening + r.debit - r.credit, 0);
  const imputables = accounts.filter((a) => a.imputable && a.active);

  return (
    <>
      <PageHeader title="Contabilidad" description="Partida doble como en Tango: los asientos se arman solos con las facturas de ARCA (ventas y compras), el banco, la caja, los cheques y la liquidación de IIBB; los ajustes van como asientos manuales. Libro diario, mayor, sumas y saldos y estados."
        actions={edit && <div className="flex flex-wrap gap-2"><GenerateButton from={from} to={to} auto={!autoCount} /><ManualEntryDialog accounts={imputables} /></div>} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat icon={TrendingUp} label="Resultado del período" value={formatMoney(st.resultado)} tone={st.resultado < 0 ? "danger" : "accent"} sub={`ingresos ${formatMoney(st.ingresos)} · egresos ${formatMoney(st.egresos)}`} />
        <Stat icon={Wallet} label="Banco según libros" value={formatMoney(bankBook)} tone={bankReal !== null && Math.abs(bankReal - bankBook) > 1 ? "warn" : undefined}
          sub={bankReal !== null ? `banco real ${formatMoney(bankReal)} · dif. ${formatMoney(bankReal - bankBook)}` : "sin aviso de saldo"} href="/tesoreria/conciliacion" />
        <Stat icon={Scale} label="Sumas" value={st.cuadra ? "Cuadra" : "No cuadra"} tone={st.cuadra ? "accent" : "danger"} sub={`activo ${formatMoney(st.activo)}`} />
        <Stat icon={BookOpen} label="A revisar / en tránsito" value={formatMoney(review)} tone={Math.abs(review) > 1 ? "warn" : undefined} sub="extracciones sin pasar a caja, partidas sin clasificar" />
      </div>

      <div className="mb-4 mt-5 flex flex-wrap items-center gap-3">
        <div className="inline-flex flex-wrap rounded-full border border-card-border bg-field p-1">
          {VIEWS.map(([k, l]) => <Link key={k} href={`/contabilidad?v=${k}`} className={cn("rounded-full px-4 py-1.5 text-sm font-medium", v === k ? "bg-surface-solid text-brand shadow-sm" : "text-fg-muted hover:text-fg")}>{l}</Link>)}
        </div>
        {v !== "plan" && (
          <form className="flex flex-wrap items-center gap-2 text-sm">
            <input type="hidden" name="v" value={v} />
            {v === "mayor" && <input type="hidden" name="a" value={acc} />}
            <input type="date" name="from" defaultValue={from} className="h-9 rounded-lg border border-card-border bg-field px-2" />
            <span className="text-fg-subtle">a</span>
            <input type="date" name="to" defaultValue={to} className="h-9 rounded-lg border border-card-border bg-field px-2" />
            <Button size="sm" variant="secondary" type="submit">Ver</Button>
            <a href={`/api/contabilidad/export?from=${from}&to=${to}`} className="inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline"><Download className="size-3.5" /> Excel para el contador</a>
          </form>
        )}
      </div>

      {v === "diario" && <Diario org={org} sb={sb} from={from} to={to} name={name} edit={edit} />}
      {v === "mayor" && <Mayor org={org} sb={sb} from={from} to={to} acc={acc} accounts={imputables} rows={rows} q={q} />}
      {v === "balance" && <Balance accounts={accounts} rows={rows} from={from} to={to} q={q} />}
      {v === "estados" && <Estados st={st} accounts={accounts} rows={rows} from={from} to={to} />}
      {v === "plan" && (
        <Card className="overflow-hidden">
          <CardHeader title="Plan de cuentas" description="Las cuentas con código de tres niveles reciben asientos. Podés agregar las que necesites." />
          {edit && <AccountForm />}
          <table className="w-full text-sm">
            <tbody className="divide-y divide-border">
              {accounts.map((a) => (
                <tr key={a.code}><td className="w-28 px-5 py-1.5 font-mono text-xs">{a.code}</td>
                  <td className={cn("py-1.5", !a.imputable && "font-semibold")} style={{ paddingLeft: `${(a.code.split(".").length - 1) * 16}px` }}>{a.name}</td>
                  <td className="px-5 text-right text-xs text-fg-subtle">{ACC_TYPE[a.type]}{a.imputable ? "" : " · título"}</td></tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </>
  );
}

type SB = Awaited<ReturnType<typeof requireOrg>>["supabase"];

async function Diario({ sb, org, from, to, name, edit }: { sb: SB; org: string; from: string; to: string; name: Map<string, string>; edit: boolean }) {
  const [{ data }, { count }] = await Promise.all([
    sb.from("acc_entries").select("id, entry_date, description, source, auto, created_at, acc_lines(account_code, debit, credit)").eq("org_id", org)
      .gte("entry_date", from).lte("entry_date", to).order("entry_date").order("created_at").limit(3000),
    sb.from("acc_entries").select("id", { count: "exact", head: true }).eq("org_id", org).gte("entry_date", `${from.slice(0, 4)}-01-01`).lt("entry_date", from),
  ]);
  type E = { id: string; entry_date: string; description: string; source: string; auto: boolean; acc_lines: { account_code: string; debit: string; credit: string }[] };
  const entries = (data ?? []) as E[];
  if (!entries.length) return <Card><EmptyState icon={<BookOpen />} title="Sin asientos en el período" description="Tocá “Actualizar asientos” para armarlos con las facturas, el banco, la caja y los cheques." /></Card>;
  const base = count ?? 0;
  const totD = entries.reduce((a, e) => a + e.acc_lines.reduce((s, l) => s + Number(l.debit), 0), 0);
  return (
    <Card className="overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="text-xs text-fg-subtle"><tr className="border-b border-border">
            <th className="w-16 px-5 py-2.5 text-left font-medium">N°</th><th className="w-24 px-2 text-left font-medium">Fecha</th><th className="px-2 text-left font-medium">Cuenta / concepto</th>
            <th className="w-36 px-2 text-right font-medium">Debe</th><th className="w-36 px-5 text-right font-medium">Haber</th>
          </tr></thead>
          {entries.map((e, i) => (
            <tbody key={e.id} className="border-b border-border">
              <tr className="bg-field/40">
                <td className="px-5 py-1.5 font-mono text-xs">{base + i + 1}</td>
                <td className="px-2 tabular text-xs">{formatDate(e.entry_date)}</td>
                <td className="px-2 text-xs font-medium" colSpan={2}>{e.description} <Badge>{SOURCE[e.source] ?? e.source}</Badge></td>
                <td className="px-5 text-right">{!e.auto && edit && <DeleteEntryButton id={e.id} />}</td>
              </tr>
              {[...e.acc_lines].sort((a, b) => Number(b.debit) - Number(a.debit)).map((l, j) => (
                <tr key={j}>
                  <td /><td />
                  <td className={cn("px-2 py-1", Number(l.credit) > 0 && "pl-10")}><span className="font-mono text-xs text-fg-subtle">{l.account_code}</span> {name.get(l.account_code)}</td>
                  <td className="px-2 text-right tabular">{Number(l.debit) ? formatMoney(l.debit) : ""}</td>
                  <td className="px-5 text-right tabular">{Number(l.credit) ? formatMoney(l.credit) : ""}</td>
                </tr>
              ))}
            </tbody>
          ))}
          <tfoot><tr className="font-semibold"><td colSpan={3} className="px-5 py-2.5">Totales · {entries.length} asientos</td><td className="px-2 text-right tabular">{formatMoney(totD)}</td><td className="px-5 text-right tabular">{formatMoney(totD)}</td></tr></tfoot>
        </table>
      </div>
    </Card>
  );
}

async function Mayor({ sb, org, from, to, acc, accounts, rows, q }: { sb: SB; org: string; from: string; to: string; acc: string; accounts: Account[]; rows: TrialRow[]; q: (x: Record<string, string>) => string }) {
  const { data } = await sb.from("acc_lines").select("debit, credit, acc_entries!inner(id, entry_date, description, created_at)").eq("org_id", org).eq("account_code", acc)
    .gte("acc_entries.entry_date", from).lte("acc_entries.entry_date", to).limit(10000);
  type Row = { debit: string; credit: string; acc_entries: { id: string; entry_date: string; description: string; created_at: string } };
  const lines = ((data ?? []) as unknown as Row[]).map((r) => ({ date: r.acc_entries.entry_date, at: r.acc_entries.created_at, description: r.acc_entries.description, debit: Number(r.debit), credit: Number(r.credit) }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.at.localeCompare(b.at));
  const opening = rows.find((r) => r.account_code === acc)?.opening ?? 0;
  const led = ledger(opening, lines);
  const a = accounts.find((x) => x.code === acc);
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap gap-1.5 border-b border-border px-5 py-3">
        {accounts.filter((x) => rows.some((r) => r.account_code === x.code)).map((x) => (
          <Link key={x.code} href={q({ a: x.code })} className={cn("rounded-full px-3 py-1 text-xs font-medium", x.code === acc ? "bg-primary text-primary-fg" : "bg-field text-fg-muted hover:text-fg")}>{x.code} {x.name}</Link>
        ))}
      </div>
      <CardHeader title={`${acc} · ${a?.name ?? ""}`} description={`Saldo inicial al ${formatDate(from)}: ${formatMoney(opening)} · saldo final: ${formatMoney(led.at(-1)?.balance ?? opening)}`} />
      {!led.length ? <p className="px-5 pb-5 text-sm text-fg-subtle">Sin movimientos en el período.</p> : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="text-xs text-fg-subtle"><tr className="border-y border-border">
              <th className="w-24 px-5 py-2 text-left font-medium">Fecha</th><th className="px-2 text-left font-medium">Concepto</th>
              <th className="w-32 px-2 text-right font-medium">Debe</th><th className="w-32 px-2 text-right font-medium">Haber</th><th className="w-36 px-5 text-right font-medium">Saldo</th>
            </tr></thead>
            <tbody className="divide-y divide-border">
              {led.map((l, i) => (
                <tr key={i}><td className="px-5 py-1.5 tabular text-xs">{formatDate(l.date)}</td><td className="px-2">{l.description}</td>
                  <td className="px-2 text-right tabular">{l.debit ? formatMoney(l.debit) : ""}</td><td className="px-2 text-right tabular">{l.credit ? formatMoney(l.credit) : ""}</td>
                  <td className={cn("px-5 text-right font-medium tabular", l.balance < 0 && "text-danger")}>{formatMoney(l.balance)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function Balance({ accounts, rows, from, to, q }: { accounts: Account[]; rows: TrialRow[]; from: string; to: string; q: (x: Record<string, string>) => string }) {
  const tb = trialBalance(accounts, rows);
  if (!tb.lines.length) return <Card><EmptyState icon={<Scale />} title="Sin saldos" description="Actualizá los asientos del período." /></Card>;
  return (
    <Card className="overflow-hidden">
      <CardHeader title="Balance de sumas y saldos" description={`Del ${formatDate(from)} al ${formatDate(to)}. Saldo positivo = deudor, negativo = acreedor.`} />
      <div className="overflow-x-auto">
        <table className="w-full min-w-[820px] text-sm tabular">
          <thead className="text-xs text-fg-subtle"><tr className="border-y border-border">
            <th className="px-5 py-2 text-left font-medium">Cuenta</th><th className="px-2 text-right font-medium">Saldo inicial</th><th className="px-2 text-right font-medium">Debe</th>
            <th className="px-2 text-right font-medium">Haber</th><th className="px-5 text-right font-medium">Saldo final</th>
          </tr></thead>
          <tbody className="divide-y divide-border">
            {tb.lines.map((l) => (
              <tr key={l.code} className={cn(!l.imputable && "bg-field/40 font-semibold")}>
                <td className="px-5 py-1.5" style={{ paddingLeft: `${20 + (l.level - 1) * 14}px` }}>
                  {l.imputable ? <Link href={q({ v: "mayor", a: l.code })} className="hover:underline"><span className="font-mono text-xs text-fg-subtle">{l.code}</span> {l.name}</Link> : <><span className="font-mono text-xs">{l.code}</span> {l.name}</>}
                </td>
                <td className="px-2 text-right">{formatMoney(l.opening)}</td><td className="px-2 text-right">{formatMoney(l.debit)}</td>
                <td className="px-2 text-right">{formatMoney(l.credit)}</td><td className={cn("px-5 text-right", l.closing < 0 && "text-fg-muted")}>{formatMoney(l.closing)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot><tr className="border-t border-border font-semibold"><td className="px-5 py-2.5">Totales</td><td /><td className="px-2 text-right">{formatMoney(tb.totals.debit)}</td><td className="px-2 text-right">{formatMoney(tb.totals.credit)}</td>
            <td className={cn("px-5 text-right", Math.abs(tb.totals.closing) > 0.05 && "text-danger")}>{formatMoney(tb.totals.closing)}</td></tr></tfoot>
        </table>
      </div>
    </Card>
  );
}

function Estados({ st, accounts, rows, from, to }: { st: ReturnType<typeof statements>; accounts: Account[]; rows: TrialRow[]; from: string; to: string }) {
  const tb = trialBalance(accounts, rows);
  const group = (t: Account["type"], sign: 1 | -1, field: "period" | "closing") => tb.lines.filter((l) => l.imputable && l.type === t)
    .map((l) => ({ code: l.code, name: l.name, v: sign * (field === "period" ? l.debit - l.credit : l.closing) })).filter((x) => Math.abs(x.v) > 0.004);
  return (
    <div className="grid gap-5 xl:grid-cols-2">
      <Card>
        <CardHeader title="Estado de resultados" description={`Del ${formatDate(from)} al ${formatDate(to)}`} />
        <div className="px-5 pb-5">
          <Sec title="Ingresos" items={group("ingreso", -1, "period")} total={st.ingresos} />
          <Sec title="Egresos" items={group("egreso", 1, "period")} total={st.egresos} />
          <p className={cn("flex justify-between rounded-lg bg-field px-3 py-2 font-semibold", st.resultado < 0 && "text-danger")}><span>{st.resultado < 0 ? "Pérdida" : "Ganancia"} del período</span><span className="tabular">{formatMoney(st.resultado)}</span></p>
          <p className="mt-2 text-xs text-fg-subtle">Compras se toman como gasto del período (no hay inventario permanente valuado). Faltan sueldos, amortizaciones y lo que no tiene factura: cargalo como asiento manual.</p>
        </div>
      </Card>
      <Card>
        <CardHeader title="Situación patrimonial" description={`Al ${formatDate(to)}`} />
        <div className="px-5 pb-5">
          <Sec title="Activo" items={group("activo", 1, "closing")} total={st.activo} />
          <Sec title="Pasivo" items={group("pasivo", -1, "closing")} total={st.pasivo} />
          <Sec title="Patrimonio neto" items={[...group("patrimonio", -1, "closing"), { code: "res", name: "Resultados acumulados", v: st.resultadoAcum }]} total={st.pn + st.resultadoAcum} />
          <p className={cn("text-xs", st.cuadra ? "text-accent" : "text-danger")}>{st.cuadra ? "Activo = Pasivo + Patrimonio neto ✓" : "No cuadra: revisá los asientos manuales"}</p>
        </div>
      </Card>
    </div>
  );
}

function Sec({ title, items, total }: { title: string; items: { code: string; name: string; v: number }[]; total: number }) {
  return (
    <div className="mb-4">
      <p className="mb-1 text-sm font-semibold">{title}</p>
      {items.map((i) => <p key={i.code} className="flex justify-between gap-3 py-0.5 text-sm"><span className="text-fg-muted">{i.name}</span><span className="tabular">{formatMoney(i.v)}</span></p>)}
      <p className="mt-1 flex justify-between border-t border-border pt-1 text-sm font-semibold"><span>Total</span><span className="tabular">{formatMoney(total)}</span></p>
    </div>
  );
}
