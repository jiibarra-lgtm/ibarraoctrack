import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  AlarmClock, AlertTriangle, ArrowRight, BadgeDollarSign, Banknote, CalendarClock, CheckCircle2, FileWarning, Inbox, Landmark,
  MailQuestion, MessageSquareWarning, PackageX, Receipt, ScanSearch, TrendingDown, Truck, Wallet,
} from "lucide-react";
import { Card } from "@/components/ui/primitives";
import { formatDate, formatMoney } from "@/lib/format";
import type { Alert } from "@/lib/alerts";
import { cn } from "@/lib/utils";

const GCBA = "34999032089";
const DAY = 864e5;
const arToday = () => new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);
const addDays = (iso: string, n: number) => new Date(Date.parse(iso.slice(0, 10)) + n * DAY).toISOString().slice(0, 10);
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b.slice(0, 10)) - Date.parse(a.slice(0, 10))) / DAY);
const median = (xs: number[]) => { if (!xs.length) return null; const v = [...xs].sort((a, b) => a - b); const m = Math.floor(v.length / 2); return v.length % 2 ? v[m] : Math.round((v[m - 1] + v[m]) / 2); };

type Level = "urgente" | "semana" | "cuando";
export type Task = { id: string; level: Level; icon: React.ElementType; title: string; detail: string; href: string; cta: string; amount?: number; count?: number };

export type TodayData = {
  tasks: Task[];
  money: {
    balance: number | null; balanceDay: string | null;
    inWeek: number; inWeekN: number; late: number; lateN: number; medianDays: number | null;
    fixedDue: number; fixedDueN: number; sigafNoBank: number; sigafNoBankN: number;
  };
};

/** Junta todo lo que hay que hacer hoy, de todas las secciones, ordenado por urgencia. */
export async function loadToday(sb: SupabaseClient, org: string, alerts: Alert[]): Promise<TodayData> {
  const today = arToday();
  const endToday = `${today}T23:59:59-03:00`;
  const month = today.slice(0, 7);
  const [rem, missing, quotes, claims, ic, bills, lines, board, jobs, bal] = await Promise.all([
    sb.from("reminders").select("id, title, due_at, priority, link_path").eq("org_id", org).eq("status", "pendiente").lte("due_at", endToday).order("due_at").limit(50),
    sb.from("oc_missing_docs").select("bac_number, in_bac, sources, unit_name, first_seen").eq("org_id", org).limit(500),
    sb.from("mail_public_insights").select("id, subject, from_name, from_email, received_at").eq("org_id", org).eq("kind", "cotizacion").eq("unanswered", true)
      .gte("received_at", new Date(Date.now() - 15 * DAY).toISOString()).order("received_at").limit(100),
    sb.from("mail_public_insights").select("id, subject, from_name, oc_ref, received_at").eq("org_id", org).eq("kind", "reclamo").eq("unanswered", true)
      .gte("received_at", new Date(Date.now() - 30 * DAY).toISOString()).limit(50),
    sb.from("invoice_collections").select("issue_date, total, paid_on, sigaf_notified").eq("org_id", org).eq("doc_number", GCBA).gte("issue_date", addDays(today, -365)).limit(5000),
    sb.from("fixed_cost_bills").select("amount, due_date, period, paid, fixed_costs!inner(is_variable, active)").eq("org_id", org).eq("paid", false)
      .eq("fixed_costs.is_variable", false).eq("fixed_costs.active", true).lte("period", month).gte("period", addDays(today, -62).slice(0, 7)).limit(500),
    sb.from("convenio_lines").select("my_current_price, best_other_price, my_stock").eq("org_id", org).eq("is_mine", true).limit(2000),
    sb.from("delivery_board").select("id", { count: "exact", head: true }).eq("org_id", org).eq("status", "pendiente"),
    sb.from("import_jobs").select("id, status").eq("org_id", org).in("status", ["revision", "error"]).limit(50),
    sb.from("bank_balances").select("as_of, balance").eq("org_id", org).order("as_of", { ascending: false }).limit(1),
  ]);

  const tasks: Task[] = [];
  const push = (t: Task) => tasks.push(t);

  // Recordatorios
  const rs = (rem.data ?? []) as { id: string; title: string; due_at: string; priority: string; link_path: string | null }[];
  const overdueRem = rs.filter((r) => Date.parse(r.due_at) < Date.now());
  if (rs.length) push({
    id: "rem", level: overdueRem.length ? "urgente" : "semana", icon: AlarmClock, count: rs.length,
    title: rs.length === 1 ? `Recordatorio: ${rs[0].title}` : `${rs.length} recordatorios para hoy${overdueRem.length ? ` (${overdueRem.length} vencidos)` : ""}`,
    detail: rs.slice(0, 3).map((r) => r.title).join(" · "), href: rs.length === 1 && rs[0].link_path ? rs[0].link_path : "/recordatorios", cta: "Ver",
  });

  // OC sin documento
  const ms = (missing.data ?? []) as { bac_number: string; in_bac: boolean; sources: string[]; unit_name: string | null }[];
  const bacMissing = ms.filter((m) => m.in_bac);
  const mailMissing = ms.filter((m) => !m.in_bac && m.sources.includes("mail"));
  if (bacMissing.length) push({
    id: "oc-bac", level: "urgente", icon: FileWarning, count: bacMissing.length,
    title: `${bacMissing.length} OC avisadas por el BAC sin cargar`, detail: bacMissing.slice(0, 3).map((m) => `${m.bac_number}${m.unit_name ? ` (${m.unit_name})` : ""}`).join(" · "),
    href: "/ordenes?faltan=1", cta: "Subirlas",
  });
  if (mailMissing.length) push({
    id: "oc-mail", level: "semana", icon: FileWarning, count: mailMissing.length,
    title: `${mailMissing.length} OC te llegaron en PDF por mail y no están cargadas`, detail: mailMissing.slice(0, 3).map((m) => m.bac_number).join(" · "),
    href: "/correos/seguimiento", cta: "Ver mails",
  });

  // Entregas, facturación, cobranza y margen (de las alertas)
  const by = (k: string, lvl?: string) => alerts.filter((a) => a.kind === k && (!lvl || a.level === lvl));
  const lateDel = by("entrega", "danger"), soonDel = by("entrega", "warn");
  if (lateDel.length) push({ id: "del-late", level: "urgente", icon: Truck, count: lateDel.length, title: `${lateDel.length} entregas atrasadas`, detail: lateDel.slice(0, 2).map((a) => a.title.replace(/^Entrega atrasada · /, "")).join(" · "), href: "/entregas?f=atrasadas", cta: "Ver" });
  if (soonDel.length) push({ id: "del-soon", level: "semana", icon: Truck, count: soonDel.length, title: `${soonDel.length} entregas vencen esta semana`, detail: soonDel.slice(0, 2).map((a) => a.detail).join(" · "), href: "/entregas", cta: "Planificar" });
  const toInvoice = by("facturacion");
  if (toInvoice.length) push({ id: "inv", level: "semana", icon: Receipt, count: toInvoice.length, amount: toInvoice.reduce((a, x) => a + Number(x.amount ?? 0), 0), title: `${toInvoice.length} OC entregadas sin facturar`, detail: "Plata que no vas a cobrar hasta que factures", href: "/facturacion", cta: "Facturar" });
  const dueInv = by("cobranza", "danger");
  if (dueInv.length) push({ id: "due", level: "urgente", icon: BadgeDollarSign, count: dueInv.length, title: `${dueInv.length} facturas vencidas sin cobrar`, detail: dueInv.slice(0, 2).map((a) => a.title.replace(/^Factura vencida · /, "")).join(" · "), href: "/cobranzas", cta: "Reclamar" });
  const loss = by("margen", "danger");
  if (loss.length) push({ id: "loss", level: "urgente", icon: TrendingDown, count: loss.length, title: `${loss.length} OC pierden plata`, detail: loss.slice(0, 2).map((a) => a.detail).join(" · "), href: "/analitica/ranking?vista=menor", cta: "Revisar" });
  const payLate = by("pagos");
  if (payLate.length) push({ id: "pay", level: "urgente", icon: Banknote, count: payLate.length, title: `${payLate.length} pagos a proveedores vencidos`, detail: payLate.slice(0, 2).map((a) => a.title.replace(/^Pago vencido · /, "")).join(" · "), href: "/compras", cta: "Pagar" });

  // Mails
  const qs = (quotes.data ?? []) as { subject: string | null; from_name: string | null; from_email: string; received_at: string }[];
  if (qs.length) {
    const oldest = daysBetween(qs[0].received_at, today);
    push({ id: "quotes", level: oldest >= 2 ? "urgente" : "semana", icon: MailQuestion, count: qs.length, title: `${qs.length} pedidos de cotización sin responder`, detail: `El más viejo espera hace ${oldest} días · ${qs[0].from_name || qs[0].from_email}`, href: "/correos/seguimiento", cta: "Responder" });
  }
  const cl = (claims.data ?? []) as { subject: string | null; from_name: string | null; oc_ref: string | null }[];
  if (cl.length) push({ id: "claims", level: "urgente", icon: MessageSquareWarning, count: cl.length, title: `${cl.length} reclamos sin responder`, detail: cl.slice(0, 2).map((c) => c.oc_ref ? `OC ${c.oc_ref}` : c.subject ?? "").join(" · "), href: "/correos?k=reclamo", cta: "Responder" });

  // Cobros del GCBA
  const inv = (ic.data ?? []) as { issue_date: string; total: string; paid_on: string | null; sigaf_notified: string | null }[];
  const med = median(inv.filter((x) => x.paid_on).map((x) => daysBetween(x.issue_date, x.paid_on!)));
  const pend = inv.filter((x) => !x.paid_on && daysBetween(x.issue_date, today) <= 180).map((x) => ({ x, exp: x.sigaf_notified ? addDays(x.sigaf_notified, 1) : addDays(x.issue_date, med ?? 18) }));
  const inWeek = pend.filter((p) => p.exp >= today && p.exp <= addDays(today, 7));
  const late = pend.filter((p) => p.exp < today && !p.x.sigaf_notified);
  const sigafNoBank = inv.filter((x) => x.sigaf_notified && !x.paid_on && daysBetween(x.sigaf_notified, today) >= 3);
  const sum = (xs: { total: string }[]) => xs.reduce((a, x) => a + Number(x.total), 0);
  if (sigafNoBank.length) push({ id: "sigaf", level: "urgente", icon: Landmark, count: sigafNoBank.length, amount: sum(sigafNoBank), title: `SIGAF avisó ${sigafNoBank.length} pagos que no aparecen en el banco`, detail: "Fijate en el home banking si entraron", href: "/cobranzas", cta: "Ver" });
  if (late.length) push({ id: "late-gcba", level: "semana", icon: CalendarClock, count: late.length, amount: sum(late.map((p) => p.x)), title: `${late.length} facturas del GCBA pasadas de lo normal`, detail: `Normalmente pagan a los ${med ?? 18} días y estas ya lo pasaron`, href: "/cobranzas", cta: "Ver" });

  // Gastos fijos por vencer
  const bs = (bills.data ?? []) as { amount: string | null; due_date: string | null }[];
  const dueSoon = bs.filter((b) => b.due_date && b.due_date <= addDays(today, 7));
  if (dueSoon.length) push({ id: "fixed", level: dueSoon.some((b) => b.due_date! < today) ? "urgente" : "semana", icon: Wallet, count: dueSoon.length, amount: dueSoon.reduce((a, b) => a + Number(b.amount ?? 0), 0), title: `${dueSoon.length} gastos fijos vencen esta semana`, detail: "Luz, teléfono, seguros e impuestos que todavía no se ven pagados en el banco", href: "/gastos-fijos", cta: "Pagar" });

  // Precios y stock
  const ls = (lines.data ?? []) as { my_current_price: string | null; best_other_price: string | null; my_stock: string | null }[];
  const beaten = ls.filter((l) => l.my_current_price && l.best_other_price && Number(l.best_other_price) < Number(l.my_current_price)).length;
  if (beaten) push({ id: "price", level: "cuando", icon: TrendingDown, count: beaten, title: `Te ganan en precio en ${beaten} renglones`, detail: "Bajá lo justo para volver a ser el más barato, o sabé cuánto perdés si no", href: "/precios-stock", cta: "Ver precios" });
  const noStock = ls.filter((l) => l.my_stock != null && Number(l.my_stock) <= 0).length;
  if (noStock) push({ id: "stock", level: "cuando", icon: PackageX, count: noStock, title: `${noStock} renglones sin stock en el convenio`, detail: "Si te compran no vas a poder entregar", href: "/precios-stock", cta: "Revisar" });

  const pendingBoard = board.count ?? 0;
  if (pendingBoard) push({ id: "board", level: "cuando", icon: Truck, count: pendingBoard, title: `${pendingBoard} entregas en la lista para llevar`, detail: "Agrupalas por zona para hacer menos viajes", href: "/entregas/pendientes", cta: "Ver lista" });
  const js = (jobs.data ?? []) as { status: string }[];
  if (js.length) push({ id: "jobs", level: js.some((j) => j.status === "error") ? "semana" : "cuando", icon: ScanSearch, count: js.length, title: `${js.length} documentos importados para revisar`, detail: js.some((j) => j.status === "error") ? "Hay alguno con error de lectura" : "Confirmá los datos leídos", href: "/ordenes/importar", cta: "Revisar" });

  const order: Record<Level, number> = { urgente: 0, semana: 1, cuando: 2 };
  tasks.sort((a, b) => order[a.level] - order[b.level] || (b.amount ?? 0) - (a.amount ?? 0));

  const b0 = (bal.data ?? [])[0] as { as_of: string; balance: string } | undefined;
  let balanceDay: string | null = null;
  if (b0) { const t = Date.parse(b0.as_of) - 3 * 3600e3; balanceDay = new Date(t - (new Date(t).getUTCHours() < 12 ? DAY : 0)).toISOString().slice(0, 10); }
  return {
    tasks,
    money: {
      balance: b0 ? Number(b0.balance) : null, balanceDay,
      inWeek: sum(inWeek.map((p) => p.x)), inWeekN: inWeek.length, late: sum(late.map((p) => p.x)), lateN: late.length, medianDays: med,
      fixedDue: bs.reduce((a, b) => a + Number(b.amount ?? 0), 0), fixedDueN: bs.length,
      sigafNoBank: sum(sigafNoBank), sigafNoBankN: sigafNoBank.length,
    },
  };
}

const LEVEL: Record<Level, { label: string; dot: string; text: string }> = {
  urgente: { label: "Urgente", dot: "bg-danger", text: "text-danger" },
  semana: { label: "Esta semana", dot: "bg-warn", text: "text-warn" },
  cuando: { label: "Cuando puedas", dot: "bg-brand", text: "text-brand" },
};

export function TodayCard({ tasks }: { tasks: Task[] }) {
  const groups = (["urgente", "semana", "cuando"] as Level[]).map((l) => [l, tasks.filter((t) => t.level === l)] as const).filter(([, l]) => l.length);
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border px-5 py-4">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Qué hacer hoy</h2>
          <p className="text-sm text-fg-muted">{tasks.length ? `Todo lo pendiente del sistema, ordenado por urgencia: ${tasks.filter((t) => t.level === "urgente").length} urgentes.` : "No hay nada pendiente."}</p>
        </div>
        <div className="flex gap-3 text-xs">
          {groups.map(([l, list]) => <span key={l} className="flex items-center gap-1.5"><span className={cn("size-2 rounded-full", LEVEL[l].dot)} />{LEVEL[l].label} {list.length}</span>)}
        </div>
      </div>
      {!tasks.length ? (
        <div className="flex items-center gap-3 px-5 py-8 text-sm text-fg-muted"><CheckCircle2 className="size-6 text-accent" /> Estás al día. Disfrutalo.</div>
      ) : groups.map(([l, list]) => (
        <div key={l}>
          <p className={cn("bg-surface-2/50 px-5 py-1.5 text-[11px] font-semibold uppercase tracking-wider", LEVEL[l].text)}>{LEVEL[l].label}</p>
          <ul className="divide-y divide-border">
            {list.map((t) => (
              <li key={t.id}>
                <Link href={t.href} className="group flex items-center gap-3 px-5 py-3 hover:bg-surface-2/60">
                  <span className={cn("grid size-9 shrink-0 place-items-center rounded-xl", l === "urgente" ? "bg-danger/10 text-danger" : l === "semana" ? "bg-warn/10 text-warn" : "bg-brand/10 text-brand")}><t.icon className="size-4" /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{t.title}</span>
                    <span className="block truncate text-xs text-fg-subtle">{t.detail}</span>
                  </span>
                  {t.amount ? <span className="hidden shrink-0 text-sm font-semibold tabular sm:block">{formatMoney(t.amount)}</span> : null}
                  <span className="flex shrink-0 items-center gap-1 text-xs font-medium text-brand opacity-80 group-hover:opacity-100">{t.cta}<ArrowRight className="size-3.5" /></span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </Card>
  );
}

function MoneyRow({ icon: I, label, value, sub, href, tone }: { icon: React.ElementType; label: string; value: string; sub?: string; href: string; tone?: "danger" | "warn" | "accent" }) {
  return (
    <Link href={href} className="flex items-center gap-3 px-5 py-3 hover:bg-surface-2/60">
      <I className={cn("size-4 shrink-0 text-fg-subtle", tone === "danger" && "text-danger", tone === "warn" && "text-warn", tone === "accent" && "text-accent")} />
      <span className="min-w-0 flex-1"><span className="block text-sm">{label}</span>{sub && <span className="block truncate text-xs text-fg-subtle">{sub}</span>}</span>
      <span className={cn("shrink-0 text-sm font-semibold tabular", tone === "danger" && "text-danger", tone === "warn" && "text-warn", tone === "accent" && "text-accent")}>{value}</span>
    </Link>
  );
}

export function MoneyCard({ m, receivable, overdue }: { m: TodayData["money"]; receivable: number; overdue: number }) {
  return (
    <Card className="overflow-hidden">
      <Link href="/banco" className="block bg-gradient-to-br from-brand/15 to-transparent px-5 py-5 hover:from-brand/20">
        <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-fg-muted"><Landmark className="size-3.5" /> Saldo en el banco</p>
        <p className="mt-1 text-3xl font-semibold tracking-tight tabular">{m.balance != null ? formatMoney(m.balance) : "—"}</p>
        <p className="text-xs text-fg-subtle">{m.balanceDay ? `al cierre del ${formatDate(m.balanceDay)}` : "sin aviso de saldo todavía"}</p>
      </Link>
      <div className="divide-y divide-border border-t border-border">
        <MoneyRow icon={CalendarClock} label="Te deberían pagar en 7 días" value={formatMoney(m.inWeek)} sub={`${m.inWeekN} facturas del GCBA · pagan a los ${m.medianDays ?? "—"} días`} href="/cobranzas" tone="accent" />
        <MoneyRow icon={Inbox} label="Por cobrar" value={formatMoney(receivable)} sub={overdue > 0 ? `${formatMoney(overdue)} vencido` : "nada vencido"} href="/cobranzas" tone={overdue > 0 ? "warn" : undefined} />
        {m.lateN > 0 && <MoneyRow icon={AlertTriangle} label="Atrasado del GCBA" value={formatMoney(m.late)} sub={`${m.lateN} facturas pasadas de lo normal`} href="/cobranzas" tone="warn" />}
        {m.sigafNoBankN > 0 && <MoneyRow icon={Landmark} label="SIGAF pagó y no entró" value={formatMoney(m.sigafNoBank)} sub={`${m.sigafNoBankN} facturas`} href="/cobranzas" tone="danger" />}
        <MoneyRow icon={Wallet} label="Gastos fijos sin pagar" value={formatMoney(m.fixedDue)} sub={`${m.fixedDueN} facturas de este mes y el anterior`} href="/gastos-fijos" />
      </div>
    </Card>
  );
}
