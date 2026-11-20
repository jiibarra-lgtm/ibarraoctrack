import type { Metadata } from "next";
import Link from "next/link";
import { ArrowDownLeft, ArrowUpRight, Banknote, Scale } from "lucide-react";
import { requireOrg } from "@/lib/session";
import { canBill } from "@/lib/billing";
import { Badge, Card, CardHeader, EmptyState, PageHeader } from "@/components/ui/primitives";
import { Stat } from "@/components/ui/stat";
import { formatDate, formatMoney } from "@/lib/format";
import { CASH_CATEGORIES, cashLedger, type CashMov } from "@/lib/treasury";
import { cn } from "@/lib/utils";
import { CashCountForm, CashForm, DeleteCashButton } from "../ui";

export const metadata: Metadata = { title: "Caja" };
const nowAr = () => new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);
const shift = (ym: string, n: number) => { const d = new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1 + n, 1)); return d.toISOString().slice(0, 7); };
const monthLabel = (ym: string) => new Date(`${ym}-15T12:00:00Z`).toLocaleDateString("es-AR", { month: "long", year: "numeric", timeZone: "UTC" });

export default async function CajaPage({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  const sp = await searchParams;
  const today = nowAr();
  const m = /^\d{4}-\d{2}$/.test(sp.m ?? "") ? sp.m! : today.slice(0, 7);
  const s = await requireOrg();
  const edit = canBill(s.org.role);
  const { data } = await s.supabase.from("cash_movements").select("id, mov_date, direction, amount, category, concept, created_at").eq("org_id", s.org.org_id).order("mov_date").limit(20000);
  const ledger = cashLedger(((data ?? []) as (Omit<CashMov, "amount"> & { amount: string })[]).map((r) => ({ ...r, amount: Number(r.amount) })));
  const balance = ledger.length ? ledger[ledger.length - 1].balance : 0;
  const month = ledger.filter((r) => r.mov_date.startsWith(m));
  const opening = ledger.filter((r) => r.mov_date < `${m}-01`).at(-1)?.balance ?? 0;
  const ins = month.filter((r) => r.direction === "in").reduce((a, r) => a + r.amount, 0);
  const outs = month.filter((r) => r.direction === "out").reduce((a, r) => a + r.amount, 0);
  const byCat = new Map<string, number>();
  for (const r of month) byCat.set(r.category, (byCat.get(r.category) ?? 0) + (r.direction === "in" ? r.amount : -r.amount));

  return (
    <>
      <PageHeader title="Caja" description="El efectivo: lo que entra y sale en mano, con saldo al día y arqueo. Extracciones y depósitos del banco van como “Banco”." />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat icon={Banknote} label="Saldo en caja" value={formatMoney(balance)} tone={balance < 0 ? "danger" : undefined} sub={balance < 0 ? "Negativo: falta cargar alguna entrada" : "según lo cargado"} />
        <Stat icon={Scale} label={`Saldo al 1 de ${monthLabel(m)}`} value={formatMoney(opening)} />
        <Stat icon={ArrowDownLeft} label={`Entró en ${monthLabel(m)}`} value={formatMoney(ins)} />
        <Stat icon={ArrowUpRight} label={`Salió en ${monthLabel(m)}`} value={formatMoney(outs)} />
      </div>

      {edit && (
        <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
          <Card><CardHeader title="Nuevo movimiento" /><CashForm /></Card>
          <Card><CardHeader title="Arqueo" description={`El sistema dice ${formatMoney(balance)}. Si contás otra cosa, queda el ajuste registrado.`} /><CashCountForm balance={balance} /></Card>
        </div>
      )}

      <Card className="mt-5 overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-5 py-3">
          <p className="text-sm font-medium capitalize">{monthLabel(m)}</p>
          <div className="flex gap-2 text-sm">
            <Link href={`/tesoreria/caja?m=${shift(m, -1)}`} className="text-fg-muted hover:text-fg">← Anterior</Link>
            {m < today.slice(0, 7) && <Link href={`/tesoreria/caja?m=${shift(m, 1)}`} className="text-fg-muted hover:text-fg">Siguiente →</Link>}
          </div>
        </div>
        {byCat.size > 0 && (
          <div className="flex flex-wrap gap-2 border-b border-border px-5 py-2.5 text-xs">
            {[...byCat].map(([k, v]) => <span key={k} className="rounded-full bg-field px-2.5 py-1">{CASH_CATEGORIES[k as keyof typeof CASH_CATEGORIES]?.label ?? k}: <b className={cn("tabular", v < 0 && "text-danger")}>{formatMoney(v)}</b></span>)}
          </div>
        )}
        {!month.length ? <EmptyState icon={<Banknote />} title="Sin movimientos este mes" description="Cargá cada entrada y salida de efectivo para tener la caja al día." /> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="text-xs text-fg-subtle"><tr className="border-b border-border">
                <th className="px-5 py-2.5 text-left font-medium">Fecha</th><th className="px-2 text-left font-medium">Concepto</th>
                <th className="px-2 text-right font-medium">Entra</th><th className="px-2 text-right font-medium">Sale</th><th className="px-2 text-right font-medium">Saldo</th><th className="px-5" />
              </tr></thead>
              <tbody>
                {[...month].reverse().map((r) => (
                  <tr key={r.id} className="border-b border-border last:border-0">
                    <td className="px-5 py-2 tabular">{formatDate(r.mov_date)}</td>
                    <td className="px-2">{r.concept} <Badge tone={r.category === "arqueo" ? "warn" : "neutral"}>{CASH_CATEGORIES[r.category]?.label ?? r.category}</Badge></td>
                    <td className="px-2 text-right tabular text-accent">{r.direction === "in" ? formatMoney(r.amount) : ""}</td>
                    <td className="px-2 text-right tabular">{r.direction === "out" ? formatMoney(r.amount) : ""}</td>
                    <td className={cn("px-2 text-right font-medium tabular", r.balance < 0 && "text-danger")}>{formatMoney(r.balance)}</td>
                    <td className="px-5 text-right">{edit && r.mov_date === today && <DeleteCashButton id={r.id} />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
