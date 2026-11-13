import type { SupabaseClient } from "@supabase/supabase-js";
import { AlarmClock, Banknote, CalendarClock, Landmark } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/primitives";
import { Stat } from "@/components/ui/stat";
import { formatDate, formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ManualMatch } from "./gcba-ui";

type IC = { id: string; issue_date: string; voucher_type: number; point_of_sale: number; number: number; name: string; doc_number: string; total: string;
  bank_movement_id: string | null; paid_on: string | null; deposit_amount: string | null; ret_iibb: string | null; ret_ganancias: string | null; method: string | null; days_to_pay: number | null; sigaf_notified: string | null };
type Mov = { id: string; mov_date: string; amount: string; detail: string };

const num = (r: { voucher_type: number; point_of_sale: number; number: number }) => `${r.voucher_type === 1 ? "A" : "B"} ${String(r.point_of_sale).padStart(5, "0")}-${String(r.number).padStart(8, "0")}`;
const todayAr = () => new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);
const daysAgo = (n: number) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);

/** Cobros del GCBA detectados en el Banco Ciudad y cruzados solos con cada factura (aviso de SIGAF + retenciones). */
export async function GcbaCollections({ sb, org, canEdit }: { sb: SupabaseClient; org: string; canEdit: boolean }) {
  const since = daysAgo(400);
  const [{ data: icData }, { data: movData }, { data: matchData }, { data: orgData }] = await Promise.all([
    sb.from("invoice_collections").select("*").eq("org_id", org).gte("issue_date", since).order("issue_date", { ascending: false }).limit(3000),
    sb.from("bank_movements").select("id, mov_date, amount, detail").eq("org_id", org).eq("kind", "gcba").order("mov_date", { ascending: false }).limit(500),
    sb.from("bank_matches").select("bank_movement_id").eq("org_id", org).limit(5000),
    sb.from("organizations").select("ops_start_date").eq("id", org).maybeSingle(),
  ]);
  // La conciliación arranca en la fecha de inicio (lo anterior no se muestra como pendiente)
  const start = (orgData as { ops_start_date: string | null } | null)?.ops_start_date ?? "2000-01-01";
  const ic = (icData ?? []) as IC[];
  const movs = (movData ?? []) as Mov[];
  if (!movs.length) return null;
  const matched = new Set(((matchData ?? []) as { bank_movement_id: string }[]).map((m) => m.bank_movement_id));
  const unmatched = movs.filter((m) => !matched.has(m.id) && m.mov_date >= start);
  const paid = ic.filter((x) => x.paid_on).sort((a, b) => b.paid_on!.localeCompare(a.paid_on!));
  const today = todayAr();
  const month = today.slice(0, 7);
  const paidMonth = paid.filter((x) => x.paid_on!.startsWith(month));
  // pendientes: facturas a organismos (CUIT 30/33/34) sin cobro, que el GCBA suele pagar
  const gcbaCuits = new Set(paid.map((x) => x.doc_number));
  const pending = ic.filter((x) => !x.paid_on && x.issue_date >= start && (gcbaCuits.has(x.doc_number) || x.sigaf_notified)).sort((a, b) => a.issue_date.localeCompare(b.issue_date));
  const avgDays = paid.length ? Math.round(paid.reduce((a, x) => a + (x.days_to_pay ?? 0), 0) / paid.length) : null;
  const ageOf = (d: string) => Math.round((Date.parse(today) - Date.parse(d)) / 864e5);
  const late = avgDays !== null ? pending.filter((x) => ageOf(x.issue_date) > avgDays * 1.5) : [];
  const sumN = (xs: IC[], k: keyof IC) => xs.reduce((a, x) => a + Number(x[k] ?? 0), 0);
  // candidatas para depósitos que no cerraron solos
  const open = ic.filter((x) => !x.paid_on && x.issue_date >= start).slice(0, 400).map((x) => ({ id: x.id, label: `${num(x)} · ${formatDate(x.issue_date)} · ${x.name.slice(0, 28)} · ${formatMoney(x.total)}`, total: Number(x.total) }));

  return (
    <div className="mb-6 space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat icon={Banknote} label="Cobrado del GCBA este mes" value={formatMoney(paidMonth.reduce((a, x) => a + Number(x.deposit_amount ?? 0), 0))} sub={`${paidMonth.length} facturas · cruzado solo con el banco`} />
        <Stat icon={Landmark} label="Retenciones del mes" value={formatMoney(sumN(paidMonth, "ret_iibb") + sumN(paidMonth, "ret_ganancias"))} sub={`IIBB ${formatMoney(sumN(paidMonth, "ret_iibb"))} · Ganancias ${formatMoney(sumN(paidMonth, "ret_ganancias"))}`} />
        <Stat icon={CalendarClock} label="Por cobrar del GCBA" value={formatMoney(sumN(pending, "total"))} sub={`${pending.length} facturas`} tone={late.length ? "warn" : undefined} />
        <Stat icon={AlarmClock} label="Tardan en pagar" value={avgDays !== null ? `${avgDays} días` : "—"} sub={late.length ? `${late.length} facturas pasadas de lo normal` : "promedio desde la factura"} tone={late.length ? "warn" : undefined} />
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <Card className="overflow-hidden">
          <CardHeader title="Últimos cobros" description="Depósito del Banco Ciudad → factura que paga, con las retenciones que se descontaron" />
          <ul className="max-h-[420px] divide-y divide-border overflow-y-auto">
            {paid.slice(0, 60).map((x) => (
              <li key={x.id} className="flex items-start justify-between gap-3 px-5 py-2.5 text-sm">
                <div className="min-w-0">
                  <p className="truncate font-medium">{x.name || x.doc_number}</p>
                  <p className="text-xs text-fg-subtle tabular">Factura {num(x)} del {formatDate(x.issue_date)} · {formatMoney(x.total)} · cobrada en {x.days_to_pay} días{x.method === "sigaf" ? " · aviso SIGAF" : ""}</p>
                </div>
                <div className="shrink-0 text-right tabular">
                  <p className="font-semibold text-accent">{formatMoney(x.deposit_amount)}</p>
                  <p className="text-[11px] text-fg-subtle">{formatDate(x.paid_on)} · ret. {formatMoney(Number(x.ret_iibb ?? 0) + Number(x.ret_ganancias ?? 0))}</p>
                </div>
              </li>
            ))}
          </ul>
        </Card>
        <Card className="overflow-hidden">
          <CardHeader title="Facturas por cobrar" description={avgDays !== null ? `El GCBA tarda en promedio ${avgDays} días; en naranja las que pasaron 1,5 veces eso` : "Facturas a organismos todavía sin depósito"} />
          <ul className="max-h-[420px] divide-y divide-border overflow-y-auto">
            {pending.map((x) => {
              const age = ageOf(x.issue_date);
              const isLate = avgDays !== null && age > avgDays * 1.5;
              return (
                <li key={x.id} className="flex items-start justify-between gap-3 px-5 py-2.5 text-sm">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{x.name || x.doc_number}</p>
                    <p className="text-xs text-fg-subtle tabular">Factura {num(x)} del {formatDate(x.issue_date)}{x.sigaf_notified ? ` · SIGAF avisó el pago el ${formatDate(x.sigaf_notified)}` : ""}</p>
                  </div>
                  <div className="shrink-0 text-right tabular">
                    <p className="font-semibold">{formatMoney(x.total)}</p>
                    <p className={cn("text-[11px]", isLate ? "font-medium text-warn" : "text-fg-subtle")}>hace {age} días</p>
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
      </div>

      {unmatched.length > 0 && (
        <Card className="overflow-hidden">
          <CardHeader title="Depósitos sin factura" description="No cierran con ninguna factura sola (pueden pagar varias juntas o tener otra retención). Elegí cuáles paga." />
          <ul className="divide-y divide-border">
            {unmatched.map((m) => (
              <li key={m.id} className="flex flex-col gap-2 px-5 py-3 text-sm lg:flex-row lg:items-center lg:justify-between">
                <div><p className="font-semibold tabular">{formatMoney(m.amount)}</p><p className="text-xs text-fg-subtle">{formatDate(m.mov_date)} · {m.detail}</p></div>
                {canEdit && <ManualMatch movementId={m.id} amount={Number(m.amount)} options={open} />}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
