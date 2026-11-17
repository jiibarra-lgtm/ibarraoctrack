import type { Metadata } from "next";
import Link from "next/link";
import { AlarmClock, BellRing, CalendarCheck, CheckCircle2 } from "lucide-react";
import { requireOrg } from "@/lib/session";
import { Card, CardHeader, EmptyState, PageHeader } from "@/components/ui/primitives";
import { Stat } from "@/components/ui/stat";
import { cn } from "@/lib/utils";
import { DeviceStatus, NewReminderButton, ReminderRow, type Reminder } from "@/components/reminders";

export const metadata: Metadata = { title: "Recordatorios" };

const nowMs = () => Date.now();
const VIEWS = [
  { k: "proximos", label: "Próximos" },
  { k: "vencidos", label: "Vencidos" },
  { k: "hechos", label: "Hechos" },
  { k: "historial", label: "Historial" },
] as const;
type View = (typeof VIEWS)[number]["k"];

const EVENT_LABEL: Record<string, string> = {
  creado: "Creado", editado: "Editado", notificado: "Te avisé", hecho: "Marcado hecho", pospuesto: "Pospuesto",
  reabierto: "Reabierto", cancelado: "Cancelado", sin_dispositivo: "No pude avisar",
};
const SOURCE_LABEL: Record<string, string> = { app: "desde la app", noti: "desde la notificación", sistema: "" };

const dayKey = (iso: string) => new Date(iso).toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "long", timeZone: "America/Argentina/Buenos_Aires" });
const hhmm = (iso: string) => new Date(iso).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Argentina/Buenos_Aires" });

export default async function RemindersPage({ searchParams }: { searchParams: Promise<{ v?: string }> }) {
  const sp = await searchParams;
  const s = await requireOrg();
  const org = s.org.org_id;
  const now = nowMs();
  const [{ data: pend }, { data: done }, { data: events }, { count: devices }] = await Promise.all([
    s.supabase.from("reminders").select("*").eq("org_id", org).eq("status", "pendiente").order("due_at").limit(500),
    s.supabase.from("reminders").select("*").eq("org_id", org).neq("status", "pendiente").order("updated_at", { ascending: false }).limit(200),
    s.supabase.from("reminder_events").select("id, kind, detail, source, at, reminder_id, reminders(title, link_path)").eq("org_id", org).order("at", { ascending: false }).limit(200),
    s.supabase.from("push_subscriptions").select("id", { count: "exact", head: true }).eq("org_id", org).lt("failures", 5),
  ]);
  const pending = (pend ?? []) as Reminder[];
  const overdue = pending.filter((r) => new Date(r.due_at).getTime() <= now);
  const upcoming = pending.filter((r) => new Date(r.due_at).getTime() > now);
  const finished = (done ?? []) as Reminder[];
  const todayEnd = new Date(now - 3 * 3600e3); todayEnd.setUTCHours(23, 59, 59, 999);
  const today = upcoming.filter((r) => new Date(r.due_at).getTime() - 3 * 3600e3 <= todayEnd.getTime()).length;
  const weekAgo = now - 7 * 864e5;
  const doneWeek = (events ?? []).filter((e) => e.kind === "hecho" && new Date(e.at).getTime() > weekAgo).length;

  const view: View = VIEWS.some((v) => v.k === sp.v) ? (sp.v as View) : overdue.length ? "vencidos" : "proximos";
  const counts: Record<View, number> = { proximos: upcoming.length, vencidos: overdue.length, hechos: finished.length, historial: events?.length ?? 0 };

  // Próximos agrupados por día
  const groups = new Map<string, Reminder[]>();
  for (const r of upcoming) { const k = dayKey(r.due_at); groups.set(k, [...(groups.get(k) ?? []), r]); }

  return (
    <>
      <PageHeader title="Recordatorios" description="Lo que quieras que te avise: a la hora exacta, con repetición, enlazado a una OC o entrega, y con historial de todo." actions={<NewReminderButton />} />

      <DeviceStatus devices={devices ?? 0} />

      <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat icon={BellRing} label="Vencidos sin hacer" value={String(overdue.length)} tone={overdue.length ? "warn" : undefined} />
        <Stat icon={AlarmClock} label="Para hoy" value={String(today)} />
        <Stat icon={CalendarCheck} label="Próximos" value={String(upcoming.length)} />
        <Stat icon={CheckCircle2} label="Hechos esta semana" value={String(doneWeek)} tone="accent" />
      </div>

      <nav className="mt-5 flex gap-1 overflow-x-auto rounded-full border border-border bg-surface p-1" aria-label="Vistas">
        {VIEWS.map((v) => (
          <Link key={v.k} href={`/recordatorios?v=${v.k}`} aria-current={view === v.k ? "page" : undefined}
            className={cn("whitespace-nowrap rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors",
              view === v.k ? "bg-primary text-primary-fg" : "text-fg-muted hover:text-fg")}>
            {v.label}{counts[v.k] ? <span className="ml-1.5 opacity-70">{counts[v.k]}</span> : null}
          </Link>
        ))}
      </nav>

      <div className="mt-4 grid gap-4">
        {view === "vencidos" && (
          <Card>
            <CardHeader title="Vencidos" description="Ya te avisé y todavía no los marcaste. Marcalos hechos o posponelos." />
            {overdue.length ? <ul className="divide-y divide-border">{overdue.map((r) => <ReminderRow key={r.id} r={r} now={now} />)}</ul>
              : <EmptyState title="Nada vencido" description="Estás al día." />}
          </Card>
        )}

        {view === "proximos" && (upcoming.length ? [...groups].map(([day, list]) => (
          <Card key={day}>
            <CardHeader title={<span className="capitalize">{day}</span>} />
            <ul className="divide-y divide-border">{list.map((r) => <ReminderRow key={r.id} r={r} now={now} />)}</ul>
          </Card>
        )) : (
          <Card><EmptyState icon={<AlarmClock className="size-6" />} title="No tenés recordatorios" description="Creá uno con el botón de arriba, o desde una OC o una entrega con “Recordarme”." action={<NewReminderButton />} /></Card>
        ))}

        {view === "hechos" && (
          <Card>
            <CardHeader title="Hechos y cancelados" description="Los podés reabrir si hace falta." />
            {finished.length ? <ul className="divide-y divide-border">{finished.map((r) => <ReminderRow key={r.id} r={r} now={now} />)}</ul>
              : <EmptyState title="Todavía no marcaste ninguno" />}
          </Card>
        )}

        {view === "historial" && (
          <Card>
            <CardHeader title="Historial" description="Todo lo que pasó con cada recordatorio: cuándo te avisé, cuándo lo marcaste, si lo pospusiste." />
            {events?.length ? (
              <ul className="divide-y divide-border">
                {events.map((e) => {
                  const rem = (Array.isArray(e.reminders) ? e.reminders[0] : e.reminders) as { title: string; link_path: string | null } | null;
                  return (
                    <li key={e.id} className="flex items-start gap-3 px-4 py-2.5 text-sm sm:px-5">
                      <span className="w-24 shrink-0 text-xs text-fg-subtle">{new Date(e.at).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", timeZone: "America/Argentina/Buenos_Aires" })} {hhmm(e.at)}</span>
                      <span className={cn("w-32 shrink-0 font-medium", e.kind === "sin_dispositivo" && "text-danger", e.kind === "hecho" && "text-accent")}>{EVENT_LABEL[e.kind] ?? e.kind}</span>
                      <span className="min-w-0 flex-1">
                        {rem?.link_path ? <Link href={rem.link_path} className="hover:underline">{rem.title}</Link> : rem?.title}
                        {(e.detail || SOURCE_LABEL[e.source]) && <span className="text-fg-subtle"> · {[e.detail, SOURCE_LABEL[e.source]].filter(Boolean).join(" · ")}</span>}
                      </span>
                    </li>
                  );
                })}
              </ul>
            ) : <EmptyState title="Sin movimientos todavía" />}
          </Card>
        )}
      </div>
    </>
  );
}
