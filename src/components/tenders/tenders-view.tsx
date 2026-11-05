import Link from "next/link";
import { CalendarClock, Landmark, Mail, Search, Sparkles } from "lucide-react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Card, EmptyState, PageHeader } from "@/components/ui/primitives";
import { Stat } from "@/components/ui/stat";
import { CopyButton } from "@/components/ui/copy-button";
import { formatDate, todayISO } from "@/lib/format";
import { processType, rubroOf, RUBRO_LABEL, RUBROS, type RubroKey } from "@/lib/rubros";
import { cn } from "@/lib/utils";

/** Fecha ISO desplazada `days` días desde hoy. */
function shiftDays(days: number) {
  return new Date(Date.now() + days * 864e5).toISOString();
}

type Pub = { id: string; source: string; process_number: string; unit_code: string | null; unit_name: string | null; title: string | null; opening_date: string | null; received_at: string | null };

export async function TendersView({ sb, orgId, source, params }: {
  sb: SupabaseClient; orgId: string; source: "bac" | "comprar"; params: { rubro?: string; tipo?: string; q?: string; ver?: string };
}) {
  const base = source === "bac" ? "/licitaciones" : "/licitaciones/comprar";
  const { rubro = "", tipo = "", q = "", ver = "abiertas" } = params;
  const { data } = await sb.from("bac_publications").select("*").eq("org_id", orgId).eq("source", source)
    .order("received_at", { ascending: false }).limit(3000);
  const today = todayISO();
  const monthAgo = shiftDays(-30);
  const weekAhead = shiftDays(7).slice(0, 10);
  const all = ((data ?? []) as Pub[]).map((p) => ({ ...p, rubro: rubroOf(p.title), type: processType(p.process_number) }));
  const open = (p: (typeof all)[number]) => (source === "bac" ? !p.opening_date || p.opening_date >= today : (p.received_at ?? "") >= monthAgo);
  const scoped = all.filter((p) => (ver === "todas" ? true : open(p)));
  const needle = q.trim().toLowerCase();
  const rows = scoped
    .filter((p) => !rubro || p.rubro === rubro)
    .filter((p) => !tipo || p.type.code === tipo)
    .filter((p) => !needle || [p.process_number, p.title, p.unit_name].some((x) => x?.toLowerCase().includes(needle)));
  const counts = new Map<RubroKey, number>();
  scoped.forEach((p) => counts.set(p.rubro, (counts.get(p.rubro) ?? 0) + 1));
  const types = [...new Map(scoped.map((p) => [p.type.code, p.type.label])).entries()];
  const href = (over: Record<string, string>) => {
    const p = new URLSearchParams({ ...(rubro ? { rubro } : {}), ...(tipo ? { tipo } : {}), ...(q ? { q } : {}), ...(ver !== "abiertas" ? { ver } : {}), ...over });
    [...p.entries()].forEach(([k, v]) => { if (!v) p.delete(k); });
    return `${base}${p.toString() ? `?${p}` : ""}`;
  };
  const soon = all.filter((p) => p.opening_date && p.opening_date >= today && p.opening_date <= weekAhead).length;
  const chip = (active: boolean) => cn("shrink-0 rounded-full px-3 py-1 text-xs font-medium", active ? "bg-primary text-primary-fg" : "bg-field text-fg-muted hover:text-fg");

  return (
    <>
      <PageHeader
        title={source === "bac" ? "Licitaciones BAC" : "Licitaciones COMPR.AR"}
        description={source === "bac" ? "Pliegos de la Ciudad (Buenos Aires Compras) en tus rubros, según los avisos por mail." : "Procesos de Nación (COMPR.AR) publicados en tus rubros, según los avisos por mail."}
      />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat icon={Sparkles} label={source === "bac" ? "Abiertas" : "Últimos 30 días"} value={String(all.filter(open).length)} href={href({ ver: "" })} />
        <Stat icon={Landmark} label="Total recibidas" value={String(all.length)} href={href({ ver: "todas" })} />
        {source === "bac"
          ? <Stat icon={CalendarClock} label="Abren en 7 días" value={String(soon)} tone={soon ? "warn" : undefined} />
          : <Stat icon={CalendarClock} label="Organismos" value={String(new Set(all.map((p) => p.unit_name)).size)} />}
        <Stat icon={Mail} label="Rubros con avisos" value={String(new Set(all.map((p) => p.rubro)).size)} />
      </div>

      <Card className="mt-5 overflow-hidden">
        <div className="flex flex-col gap-2.5 border-b border-border px-4 py-3 sm:px-5">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex gap-1.5">
              <Link href={href({ ver: "" })} className={chip(ver !== "todas")}>{source === "bac" ? "Abiertas" : "Recientes"}</Link>
              <Link href={href({ ver: "todas" })} className={chip(ver === "todas")}>Todas</Link>
            </div>
            <form className="relative w-full sm:w-72" action={base}>
              {rubro && <input type="hidden" name="rubro" value={rubro} />}
              {tipo && <input type="hidden" name="tipo" value={tipo} />}
              {ver !== "abiertas" && <input type="hidden" name="ver" value={ver} />}
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-subtle" />
              <input name="q" defaultValue={q} placeholder="Buscar proceso, producto, organismo…" className="h-9 w-full rounded-full border border-card-border bg-field pl-9 pr-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/40" />
            </form>
          </div>
          <div className="flex gap-1.5 overflow-x-auto pb-0.5">
            <Link href={href({ rubro: "" })} className={chip(!rubro)}>Todos los rubros · {scoped.length}</Link>
            {[...RUBROS.map((r) => r.key), "otros" as const].filter((k) => counts.get(k)).map((k) => (
              <Link key={k} href={href({ rubro: k })} className={chip(rubro === k)}>{RUBRO_LABEL[k]} · {counts.get(k)}</Link>
            ))}
          </div>
          {types.length > 1 && (
            <div className="flex gap-1.5 overflow-x-auto pb-0.5">
              <Link href={href({ tipo: "" })} className={chip(!tipo)}>Todos los tipos</Link>
              {types.map(([code, label]) => <Link key={code} href={href({ tipo: code })} className={chip(tipo === code)}>{label}</Link>)}
            </div>
          )}
        </div>
        {!rows.length ? (
          <EmptyState icon={<Landmark />} title={all.length ? "Nada con estos filtros" : "Todavía no hay avisos"}
            description={all.length ? undefined : "Aparecen solas cuando llegan los mails de publicación (conectá Gmail en Configuración)."} />
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((p) => (
              <li key={p.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1 px-4 py-3 sm:grid-cols-[210px_minmax(0,1fr)_200px_110px] sm:items-center sm:px-5">
                <div className="flex items-center gap-1 font-mono text-sm font-semibold">{p.process_number}<CopyButton value={p.process_number} /></div>
                <div className="col-span-2 min-w-0 sm:col-span-1">
                  <p className="text-sm leading-snug">{p.title ?? "—"}</p>
                  <p className="mt-1 flex flex-wrap gap-1.5">
                    <span className="rounded-md bg-info-soft px-1.5 py-0.5 text-[11px] font-medium text-brand">{RUBRO_LABEL[p.rubro]}</span>
                    <span className="rounded-md bg-surface-2 px-1.5 py-0.5 text-[11px] text-fg-muted">{p.type.label}</span>
                  </p>
                </div>
                <p className="col-span-2 truncate text-xs text-fg-muted sm:col-span-1">{p.unit_code ? `${p.unit_code} · ` : ""}{p.unit_name ?? "—"}</p>
                <div className="col-start-2 row-start-1 text-right text-xs sm:col-start-auto sm:row-start-auto">
                  {p.opening_date
                    ? <p className={cn("font-medium tabular", p.opening_date < today ? "text-fg-subtle" : "text-fg")}>Abre {formatDate(p.opening_date)}</p>
                    : <p className="tabular text-fg-subtle">{formatDate(p.received_at)}</p>}
                  <Link href={`/correos?q=${encodeURIComponent(p.process_number)}`} className="text-brand hover:underline">ver mail</Link>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
