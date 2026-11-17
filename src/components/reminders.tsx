"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlarmClock, BellOff, BellRing, Check, Clock, Link2, Pencil, Plus, Repeat, RotateCcw, Search, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger, Menu, MenuContent, MenuItem, MenuTrigger } from "@/components/ui/overlays";
import { Badge, Input, NativeSelect, Textarea } from "@/components/ui/primitives";
import { safeAction } from "@/lib/safe-action";
import { cn } from "@/lib/utils";
import { ios, standalone, subscribe, supported } from "@/components/push-prompt";
import { actReminder, deleteReminder, saveReminder, searchReminderLinks, type LinkOption } from "@/app/(app)/recordatorios/actions";

export type Reminder = {
  id: string; title: string; notes: string | null; due_at: string; repeat: Repeat; nag_minutes: number | null; priority: "normal" | "alta";
  status: "pendiente" | "hecho" | "cancelado"; order_id: string | null; board_id: string | null; link_path: string | null; link_label: string | null;
  notified_at: string | null; notify_count: number; done_at: string | null; created_at: string;
};
type Repeat = "none" | "daily" | "weekdays" | "weekly" | "monthly";
export type ReminderLink = { order_id?: string | null; board_id?: string | null; link_path?: string | null; link_label?: string | null };

export const REPEAT_LABEL: Record<Repeat, string> = { none: "Una vez", daily: "Todos los días", weekdays: "Lunes a viernes", weekly: "Cada semana", monthly: "Cada mes" };
const NAG: { v: number | null; label: string }[] = [
  { v: null, label: "No, avisame una vez" }, { v: 15, label: "Cada 15 min hasta que lo marque" }, { v: 60, label: "Cada 1 hora hasta que lo marque" },
  { v: 180, label: "Cada 3 horas hasta que lo marque" }, { v: 1440, label: "Todos los días hasta que lo marque" },
];

// ---- Fechas en hora argentina (-03:00, sin horario de verano) ----
const AR = 3 * 3600e3;
const arNow = () => new Date(Date.now() - AR);
const toLocal = (d: Date) => d.toISOString().slice(0, 16); // d ya corrido a hora AR
const isoToLocal = (iso: string) => toLocal(new Date(new Date(iso).getTime() - AR));
const at = (daysAhead: number, h: number, m = 0) => { const d = arNow(); d.setUTCDate(d.getUTCDate() + daysAhead); d.setUTCHours(h, m, 0, 0); return toLocal(d); };
const inMinutes = (min: number) => { const d = new Date(arNow().getTime() + min * 60e3); d.setUTCSeconds(0, 0); return toLocal(d); };
const nextMonday = (h: number) => { const d = arNow(); const add = ((8 - d.getUTCDay()) % 7) || 7; return at(add, h); };
const PRESETS = [
  { label: "En 1 hora", fn: () => inMinutes(60) },
  { label: "Hoy 18:00", fn: () => at(0, 18) },
  { label: "Mañana 9:00", fn: () => at(1, 9) },
  { label: "Lunes 9:00", fn: () => nextMonday(9) },
  { label: "En 1 semana", fn: () => at(7, 9) },
];

const fmtWhen = (iso: string) => {
  const d = new Date(iso);
  const day = d.toLocaleDateString("es-AR", { weekday: "short", day: "numeric", month: "short", timeZone: "America/Argentina/Buenos_Aires" });
  const time = d.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Argentina/Buenos_Aires" });
  return `${day} · ${time}`;
};
export function relWhen(iso: string, now: number) {
  const diff = new Date(iso).getTime() - now;
  const abs = Math.abs(diff), m = Math.round(abs / 60e3), h = Math.round(abs / 3600e3), d = Math.round(abs / 864e5);
  const t = m < 60 ? `${m} min` : h < 36 ? `${h} h` : `${d} días`;
  return diff >= 0 ? `en ${t}` : `hace ${t}`;
}

type Run = (k: string, fn: () => Promise<{ ok: true } | { ok: false; error: string }>, msg: string) => Promise<void>;
function useRun(): [string | null, Run] {
  const router = useRouter();
  const [busy, setBusy] = React.useState<string | null>(null);
  const run: Run = async (k, fn, msg) => {
    setBusy(k);
    const r = await safeAction(fn);
    setBusy(null);
    if (!r.ok) { if (r.error) toast.error(r.error); return; }
    toast.success(msg);
    router.refresh();
  };
  return [busy, run];
}

// ---------------- Diálogo crear / editar ----------------
export function ReminderDialog({ reminder, defaults, trigger, onSaved }: {
  reminder?: Reminder; defaults?: ReminderLink & { title?: string; notes?: string }; trigger: React.ReactNode; onSaved?: () => void;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const blank = React.useCallback(() => ({
    title: reminder?.title ?? defaults?.title ?? "", notes: reminder?.notes ?? defaults?.notes ?? "",
    due: reminder ? isoToLocal(reminder.due_at) : at(1, 9),
    repeat: (reminder?.repeat ?? "none") as Repeat, nag: reminder?.nag_minutes ?? null as number | null, priority: reminder?.priority ?? "normal",
    link: (reminder ? { order_id: reminder.order_id, board_id: reminder.board_id, link_path: reminder.link_path, link_label: reminder.link_label }
      : { order_id: defaults?.order_id ?? null, board_id: defaults?.board_id ?? null, link_path: defaults?.link_path ?? null, link_label: defaults?.link_label ?? null }) as ReminderLink,
  }), [reminder, defaults]);
  const [f, setF] = React.useState(blank);
  const [busy, setBusy] = React.useState(false);
  const onOpen = (o: boolean) => { if (o) setF(blank()); setOpen(o); };
  const save = async () => {
    setBusy(true);
    const r = await safeAction(() => saveReminder({
      id: reminder?.id ?? "", title: f.title, notes: f.notes, due: f.due, repeat: f.repeat, nag_minutes: f.nag, priority: f.priority as "normal" | "alta",
      order_id: f.link.order_id ?? null, board_id: f.link.board_id ?? null, link_path: f.link.link_path ?? "", link_label: f.link.link_label ?? null,
    }));
    setBusy(false);
    if (!r.ok) { if (r.error) toast.error(r.error); return; }
    toast.success(reminder ? "Recordatorio guardado" : `Te aviso el ${fmtWhen(new Date(`${f.due}:00-03:00`).toISOString())}`);
    setOpen(false);
    onSaved?.();
    router.refresh();
  };
  return (
    <Dialog open={open} onOpenChange={onOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent title={reminder ? "Editar recordatorio" : "Nuevo recordatorio"} description="Te llega como notificación al celu y a la compu donde tengas los avisos activados.">
        <div className="grid gap-3">
          <label className="grid gap-1 text-xs text-fg-muted">Qué te recuerdo
            <Input autoFocus value={f.title} maxLength={200} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="Llamar al hospital por la entrega" />
          </label>
          <label className="grid gap-1 text-xs text-fg-muted">Nota (opcional)
            <Textarea rows={2} value={f.notes} maxLength={2000} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder="Preguntar por Laura, interno 214" />
          </label>
          <div className="grid gap-1 text-xs text-fg-muted">
            Cuándo
            <div className="flex flex-wrap gap-1.5">
              {PRESETS.map((p) => (
                <button key={p.label} type="button" onClick={() => setF({ ...f, due: p.fn() })}
                  className="rounded-full border border-border px-2.5 py-1 text-xs text-fg hover:bg-surface-hover">{p.label}</button>
              ))}
            </div>
            <Input type="datetime-local" value={f.due} onChange={(e) => setF({ ...f, due: e.target.value })} className="mt-1" />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1 text-xs text-fg-muted">Repetir
              <NativeSelect value={f.repeat} onChange={(e) => setF({ ...f, repeat: e.target.value as Repeat })}>
                {(Object.keys(REPEAT_LABEL) as Repeat[]).map((k) => <option key={k} value={k}>{REPEAT_LABEL[k]}</option>)}
              </NativeSelect>
            </label>
            <label className="grid gap-1 text-xs text-fg-muted">Insistir
              <NativeSelect value={f.nag ?? ""} onChange={(e) => setF({ ...f, nag: e.target.value ? Number(e.target.value) : null })}>
                {NAG.map((n) => <option key={String(n.v)} value={n.v ?? ""}>{n.label}</option>)}
              </NativeSelect>
            </label>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={f.priority === "alta"} onChange={(e) => setF({ ...f, priority: e.target.checked ? "alta" : "normal" })} className="size-4 accent-[var(--color-brand)]" />
            Importante (se marca con ‼️)
          </label>
          <LinkPicker value={f.link} onChange={(link) => setF({ ...f, link })} />
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button loading={busy} disabled={!f.title.trim() || !f.due} onClick={save}>{!busy && <AlarmClock />} {reminder ? "Guardar" : "Recordarme"}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function LinkPicker({ value, onChange }: { value: ReminderLink; onChange: (v: ReminderLink) => void }) {
  const [q, setQ] = React.useState("");
  const [opts, setOpts] = React.useState<LinkOption[] | null>(null);
  const [searching, setSearching] = React.useState(false);
  React.useEffect(() => {
    if (value.link_path) return;
    let alive = true;
    const t = setTimeout(async () => {
      setSearching(true);
      const r = await searchReminderLinks(q).catch(() => [] as LinkOption[]);
      if (alive) { setOpts(r); setSearching(false); }
    }, q ? 250 : 0);
    return () => { alive = false; clearTimeout(t); };
  }, [q, value.link_path]);

  if (value.link_path) {
    return (
      <div className="grid gap-1 text-xs text-fg-muted">
        Enlazado a
        <div className="flex items-center gap-2 rounded-lg border border-border bg-surface-hover/50 px-3 py-2 text-sm text-fg">
          <Link2 className="size-4 shrink-0 text-brand" />
          <span className="min-w-0 flex-1 truncate">{value.link_label ?? value.link_path}</span>
          <button type="button" aria-label="Quitar enlace" className="text-fg-subtle hover:text-fg"
            onClick={() => onChange({ order_id: null, board_id: null, link_path: null, link_label: null })}><X className="size-4" /></button>
        </div>
      </div>
    );
  }
  return (
    <div className="grid gap-1 text-xs text-fg-muted">
      Enlazar a algo (opcional): al tocar la noti te lleva ahí
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-fg-subtle" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Número de OC, organismo, entrega o pantalla" className="pl-8" />
      </div>
      <div className="max-h-44 overflow-y-auto rounded-lg border border-border">
        {searching && !opts && <p className="px-3 py-2 text-fg-subtle">Buscando…</p>}
        {opts && !opts.length && <p className="px-3 py-2 text-fg-subtle">No encontré nada con eso.</p>}
        {opts?.map((o) => (
          <button key={`${o.kind}-${o.order_id ?? o.board_id ?? o.path}`} type="button"
            onClick={() => onChange({ order_id: o.order_id ?? null, board_id: o.board_id ?? null, link_path: o.path, link_label: o.sub ? `${o.label} · ${o.sub}` : o.label })}
            className="flex w-full items-center gap-2 border-b border-border px-3 py-1.5 text-left text-sm text-fg last:border-0 hover:bg-surface-hover">
            <Badge tone={o.kind === "orden" ? "info" : o.kind === "entrega" ? "accent" : "neutral"}>{o.kind === "orden" ? "OC" : o.kind === "entrega" ? "Entrega" : "Pantalla"}</Badge>
            <span className="min-w-0 flex-1 truncate">{o.label}{o.sub ? <span className="text-fg-subtle"> · {o.sub}</span> : null}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ---------------- Tarjeta ----------------
export function ReminderRow({ r, now, compact }: { r: Reminder; now: number; compact?: boolean }) {
  const [busy, run] = useRun();
  const [confirmDel, setConfirmDel] = React.useState(false);
  const pending = r.status === "pendiente";
  const overdue = pending && new Date(r.due_at).getTime() <= now;
  return (
    <li className={cn("flex flex-col gap-2 px-4 py-3 sm:px-5", overdue && "bg-danger/5")}>
      <div className="flex items-start gap-3">
        <span className={cn("mt-0.5 grid size-8 shrink-0 place-items-center rounded-full",
          !pending ? "bg-accent/15 text-accent" : overdue ? "bg-danger/15 text-danger" : "bg-brand/15 text-brand")}>
          {!pending ? <Check className="size-4" /> : overdue ? <BellRing className="size-4" /> : <Clock className="size-4" />}
        </span>
        <div className="min-w-0 flex-1">
          <p className={cn("font-medium", !pending && "text-fg-muted line-through")}>{r.priority === "alta" && "‼️ "}{r.title}</p>
          <p className="text-xs text-fg-subtle">
            {r.status === "hecho" && r.done_at ? `Hecho ${fmtWhen(r.done_at)}` : r.status === "cancelado" ? "Cancelado" : <>
              <span className={cn(overdue && "font-medium text-danger")}>{fmtWhen(r.due_at)} · {relWhen(r.due_at, now)}</span>
            </>}
          </p>
          {r.notes && !compact && <p className="mt-1 whitespace-pre-line text-sm text-fg-muted">{r.notes}</p>}
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {r.repeat !== "none" && <Badge tone="info"><Repeat className="size-3" /> {REPEAT_LABEL[r.repeat]}</Badge>}
            {r.nag_minutes && pending && <Badge tone="warn">Insiste {r.nag_minutes >= 1440 ? "cada día" : r.nag_minutes >= 60 ? `cada ${r.nag_minutes / 60} h` : `cada ${r.nag_minutes} min`}</Badge>}
            {r.notify_count > 0 && <Badge>Avisado {r.notify_count} {r.notify_count === 1 ? "vez" : "veces"}</Badge>}
            {r.link_path && !compact && (
              <Link href={r.link_path}><Badge tone="accent"><Link2 className="size-3" /> {r.link_label ?? "Abrir"}</Badge></Link>
            )}
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 pl-11">
        {pending ? (
          <>
            <Button size="sm" loading={busy === "done"} onClick={() => run("done", () => actReminder(r.id, "done"), r.repeat === "none" ? "¡Hecho!" : "Hecho · queda el próximo")}>{busy !== "done" && <Check />} Hecho</Button>
            <Menu>
              <MenuTrigger asChild><Button size="sm" variant="secondary" loading={busy === "snz"}>{busy !== "snz" && <AlarmClock />} Posponer</Button></MenuTrigger>
              <MenuContent align="start">
                {[{ l: "15 minutos", m: 15 }, { l: "1 hora", m: 60 }, { l: "3 horas", m: 180 }, { l: "Mañana", m: 1440 }, { l: "1 semana", m: 10080 }].map((o) => (
                  <MenuItem key={o.m} onSelect={() => run("snz", () => actReminder(r.id, "snooze", o.m), `Pospuesto ${o.l.toLowerCase()}`)}>{o.l}</MenuItem>
                ))}
              </MenuContent>
            </Menu>
          </>
        ) : (
          <Button size="sm" variant="ghost" loading={busy === "re"} onClick={() => run("re", () => actReminder(r.id, "reopen"), "Volvió a pendientes")}>{busy !== "re" && <RotateCcw />} Reabrir</Button>
        )}
        <ReminderDialog reminder={r} trigger={<Button size="sm" variant="ghost"><Pencil /> Editar</Button>} />
        {pending && !compact && <Button size="sm" variant="ghost" className="text-fg-subtle" loading={busy === "cx"} onClick={() => run("cx", () => actReminder(r.id, "cancel"), "Cancelado")}>{busy !== "cx" && <BellOff />} Cancelar</Button>}
        {confirmDel ? (
          <span className="flex items-center gap-1 text-xs">¿Borrar con su historial?
            <Button size="sm" variant="ghost" className="text-danger" loading={busy === "del"} onClick={() => run("del", () => deleteReminder(r.id), "Borrado")}>Sí</Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirmDel(false)}>No</Button>
          </span>
        ) : !compact && <Button size="sm" variant="ghost" className="text-fg-subtle" aria-label="Borrar" onClick={() => setConfirmDel(true)}><Trash2 /></Button>}
      </div>
    </li>
  );
}

/** Botón chico para crear un recordatorio ya enlazado (desde una OC, una entrega, etc.). */
export function RemindMeButton({ link, title, notes, label = "Recordarme", size = "sm", variant = "secondary" }: {
  link: ReminderLink; title?: string; notes?: string; label?: string; size?: "sm" | "md"; variant?: "secondary" | "ghost" | "default";
}) {
  return <ReminderDialog defaults={{ ...link, title, notes }} trigger={<Button size={size} variant={variant}><AlarmClock /> {label}</Button>} />;
}

export function NewReminderButton() {
  return <ReminderDialog trigger={<Button><Plus /> Nuevo recordatorio</Button>} />;
}

/** Estado de las notificaciones en ESTE dispositivo + prueba en 1 minuto. */
export function DeviceStatus({ devices }: { devices: number }) {
  const router = useRouter();
  const [state, setState] = React.useState<"loading" | "on" | "off" | "denied" | "unsupported" | "ios">("loading");
  const [busy, setBusy] = React.useState<string | null>(null);
  React.useEffect(() => {
    let alive = true;
    (async () => {
      let s: typeof state;
      if (!supported()) s = ios() && !standalone() ? "ios" : "unsupported";
      else if (Notification.permission === "denied") s = "denied";
      else if (Notification.permission !== "granted") s = "off";
      else s = (await navigator.serviceWorker.ready.then((r) => r.pushManager.getSubscription()).catch(() => null)) ? "on" : "off";
      if (alive) setState(s);
    })();
    return () => { alive = false; };
  }, []);
  const enable = async () => {
    setBusy("on");
    try {
      const p = await Notification.requestPermission();
      if (p !== "granted") { setState(p === "denied" ? "denied" : "off"); toast.error("No se activaron: habilitalas en los ajustes del navegador"); }
      else { await subscribe(); setState("on"); toast.success("Listo: los recordatorios te llegan a este dispositivo"); router.refresh(); }
    } catch (e) { toast.error((e as Error).message); }
    setBusy(null);
  };
  const test = async () => {
    setBusy("test");
    const r = await safeAction(() => saveReminder({ title: "Prueba de recordatorio", notes: "Si ves esto, los avisos andan. Probá los botones de abajo.", due: inMinutes(1), repeat: "none", priority: "normal" }));
    setBusy(null);
    if (!r.ok) { if (r.error) toast.error(r.error); return; }
    toast.success("En 1 minuto te llega la notificación de prueba");
    router.refresh();
  };
  const msg = {
    loading: "Revisando este dispositivo…",
    on: "Este dispositivo recibe los recordatorios.",
    off: "Este dispositivo todavía no recibe avisos.",
    denied: "Bloqueaste las notificaciones en este navegador: habilitalas desde el candado de la barra de direcciones.",
    unsupported: "Este navegador no soporta notificaciones.",
    ios: "En iPhone: abrí OC Track desde el ícono en la pantalla de inicio (Compartir → Agregar a inicio) y activalas ahí.",
  }[state];
  return (
    <div className={cn("flex flex-wrap items-center gap-3 rounded-2xl border px-4 py-3", state === "on" ? "border-accent/30 bg-accent/5" : "border-warn/40 bg-warn/5")}>
      {state === "on" ? <BellRing className="size-5 text-accent" /> : <BellOff className="size-5 text-warn" />}
      <div className="min-w-0 flex-1 text-sm">
        <p className="font-medium">{msg}</p>
        <p className="text-xs text-fg-muted">{devices ? `${devices} dispositivo${devices === 1 ? "" : "s"} con avisos activados en total.` : "Ningún dispositivo tiene los avisos activados todavía."} Llegan a la hora exacta, aunque la app esté cerrada.</p>
      </div>
      {state === "off" && <Button size="sm" loading={busy === "on"} onClick={enable}>{busy !== "on" && <BellRing />} Activar acá</Button>}
      <Button size="sm" variant="secondary" loading={busy === "test"} onClick={test}>Probar (en 1 min)</Button>
    </div>
  );
}
