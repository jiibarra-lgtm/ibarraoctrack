import type { Metadata } from "next";
import Link from "next/link";
import { ArrowDownLeft, ArrowUpRight, CalendarClock, Wallet } from "lucide-react";
import { requireOrg } from "@/lib/session";
import { canBill } from "@/lib/billing";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui/primitives";
import { Stat } from "@/components/ui/stat";
import { formatDate, formatMoney } from "@/lib/format";
import { CHEQUE_STATUS, chequeOpen } from "@/lib/treasury";
import { cn } from "@/lib/utils";
import { ChequeEditor, ChequeStatusButtons, type ChequeRow } from "../ui";

export const metadata: Metadata = { title: "Cheques" };

const VIEWS = [["cartera", "En cartera"], ["emitidos", "Emitidos pendientes"], ["recibidos", "Todos los recibidos"], ["propios", "Todos los emitidos"]] as const;
const nowAr = () => new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);
const plus = (iso: string, d: number) => new Date(Date.parse(iso) + d * 864e5).toISOString().slice(0, 10);

export default async function ChequesPage({ searchParams }: { searchParams: Promise<{ v?: string }> }) {
  const sp = await searchParams;
  const v = VIEWS.some(([k]) => k === sp.v) ? sp.v! : "cartera";
  const s = await requireOrg();
  const org = s.org.org_id;
  const edit = canBill(s.org.role);
  const today = nowAr();
  const [{ data }, { data: orders }] = await Promise.all([
    s.supabase.from("cheques").select("id, direction, kind, bank, number, counterpart_name, counterpart_cuit, amount, issue_date, pay_date, status, status_date, endorsed_to, purchase_order_id, notes")
      .eq("org_id", org).order("pay_date").limit(2000),
    s.supabase.from("purchase_orders_overview").select("id, bac_number, display_number").eq("org_id", org).neq("status", "anulada").order("issue_date", { ascending: false }).limit(300),
  ]);
  const rows = (data ?? []) as ChequeRow[];
  const opts = ((orders ?? []) as { id: string; bac_number: string | null; display_number: string }[]).map((o) => ({ id: o.id, label: o.bac_number ?? o.display_number }));
  const poLabel = new Map(opts.map((o) => [o.id, o.label]));
  const sumOf = (xs: ChequeRow[]) => xs.reduce((a, c) => a + Number(c.amount), 0);
  const cartera = rows.filter((c) => c.direction === "recibido" && chequeOpen(c));
  const emitidos = rows.filter((c) => c.direction === "emitido" && chequeOpen(c));
  const week = plus(today, 7);
  const shown = v === "cartera" ? cartera : v === "emitidos" ? emitidos : v === "recibidos" ? rows.filter((c) => c.direction === "recibido") : rows.filter((c) => c.direction === "emitido");

  return (
    <>
      <PageHeader title="Cheques" description="Cheques de terceros en cartera (para depositar o endosar) y cheques propios emitidos (para tener la plata cuando se debitan). E-cheqs y físicos."
        actions={edit && <div className="flex flex-wrap gap-2"><ChequeEditor direction="emitido" orders={opts} /><ChequeEditor direction="recibido" orders={opts} /></div>} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat icon={Wallet} label="En cartera" value={formatMoney(sumOf(cartera))} sub={`${cartera.length} cheques de terceros`} />
        <Stat icon={ArrowDownLeft} label="Se cobran esta semana" value={formatMoney(sumOf(cartera.filter((c) => c.pay_date <= week)))} sub="vencidos o hasta 7 días" />
        <Stat icon={ArrowUpRight} label="Emitidos sin debitar" value={formatMoney(sumOf(emitidos))} sub={`${emitidos.length} cheques propios`} />
        <Stat icon={CalendarClock} label="Se debitan esta semana" value={formatMoney(sumOf(emitidos.filter((c) => c.pay_date <= week)))} tone={emitidos.some((c) => c.pay_date <= week) ? "warn" : undefined} sub="tené la plata en el banco" />
      </div>

      <div className="mb-4 mt-5 inline-flex flex-wrap rounded-full border border-card-border bg-field p-1">
        {VIEWS.map(([k, l]) => (
          <Link key={k} href={`/tesoreria/cheques?v=${k}`} className={cn("rounded-full px-4 py-1.5 text-sm font-medium", v === k ? "bg-surface-solid text-brand shadow-sm" : "text-fg-muted hover:text-fg")}>{l}</Link>
        ))}
      </div>

      <Card className="overflow-hidden">
        {!shown.length ? <EmptyState icon={<Wallet />} title="Sin cheques acá" description="Cargá los cheques que recibís de clientes y los que das a proveedores: el sistema te avisa cuándo depositarlos y cuándo se debitan." /> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-sm">
              <thead className="text-xs text-fg-subtle"><tr className="border-b border-border">
                <th className="px-5 py-2.5 text-left font-medium">Pago</th><th className="px-2 text-left font-medium">{v === "emitidos" || v === "propios" ? "A la orden de" : "Librador"}</th>
                <th className="px-2 text-left font-medium">Cheque</th><th className="px-2 text-right font-medium">Importe</th><th className="px-2 text-left font-medium">Estado</th><th className="px-5" />
              </tr></thead>
              <tbody>
                {shown.map((c) => {
                  const st = CHEQUE_STATUS[c.status];
                  const late = chequeOpen(c) && c.pay_date < today;
                  return (
                    <tr key={c.id} className="border-b border-border last:border-0">
                      <td className={cn("px-5 py-2.5 tabular", late && "font-medium text-danger")}>{formatDate(c.pay_date)}<p className="text-[11px] text-fg-subtle">emitido {formatDate(c.issue_date)}</p></td>
                      <td className="px-2"><span className="font-medium">{c.counterpart_name}</span>
                        <p className="text-xs text-fg-subtle">{[c.counterpart_cuit, c.purchase_order_id ? `OC ${poLabel.get(c.purchase_order_id) ?? ""}` : null, c.endorsed_to ? `endosado a ${c.endorsed_to}` : null, c.notes].filter(Boolean).join(" · ")}</p></td>
                      <td className="px-2 text-xs">{c.kind === "echeq" ? "E-cheq" : "Físico"}{c.bank ? ` · ${c.bank}` : ""}{c.number ? <span className="block font-mono">N° {c.number}</span> : null}</td>
                      <td className="px-2 text-right font-medium tabular">{formatMoney(c.amount)}</td>
                      <td className="px-2"><Badge tone={st.tone}>{st.label}</Badge>{c.status_date && !chequeOpen(c) ? <p className="text-[11px] text-fg-subtle">{formatDate(c.status_date)}</p> : null}</td>
                      <td className="px-5 py-2">{edit && <div className="flex items-center justify-end gap-1"><ChequeStatusButtons row={c} /><ChequeEditor row={c} direction={c.direction} orders={opts} /></div>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
