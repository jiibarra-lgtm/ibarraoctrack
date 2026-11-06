import type { Metadata } from "next";
import Link from "next/link";
import { FileText, Search } from "lucide-react";
import { requireOrg, canWrite } from "@/lib/session";
import { Card, EmptyState, PageHeader } from "@/components/ui/primitives";
import { formatDateTime } from "@/lib/format";
import { REMITO_STATUS, baParts, fmtQty, type RemitoIssuer, type RemitoRow } from "@/lib/remitos";
import { cn } from "@/lib/utils";
import { RemitoForm, type PlaceOption } from "./remito-form";

export const metadata: Metadata = { title: "Remitos" };

const nowBA = () => {
  const p = baParts(new Date().toISOString());
  return { date: `${p.y}-${p.m}-${p.d}`, time: p.hm };
};
const STATUS_FILTERS = [["todos", "Todos"], ["emitido", "Emitidos"], ["entregado", "Entregados"], ["firmado", "Firmados"], ["anulado", "Anulados"]] as const;

export default async function RemitosPage({ searchParams }: { searchParams: Promise<{ v?: string; q?: string; s?: string; oc?: string }> }) {
  const sp = await searchParams;
  const view = sp.v === "historial" ? "historial" : "emitir";
  const s = await requireOrg();
  const writable = canWrite(s.org.role) || s.org.role === "logistica";

  const tabs = (
    <div className="mb-5 inline-flex rounded-full border border-card-border bg-field p-1">
      {(["emitir", "historial"] as const).map((k) => (
        <Link key={k} href={k === "emitir" ? "/remitos" : "/remitos?v=historial"}
          className={cn("rounded-full px-4 py-1.5 text-sm font-medium", view === k ? "bg-surface-solid text-brand shadow-sm" : "text-fg-muted hover:text-fg")}>
          {k === "emitir" ? "Emitir remito" : "Historial"}
        </Link>
      ))}
    </div>
  );
  const header = <PageHeader title="Remitos" description="Emití remitos para hospitales y clientes. Cada uno queda numerado y registrado con destinatario, fecha, hora, productos y todo su recorrido: impresiones, entrega, copia firmada o anulación." />;

  if (view === "emitir") {
    if (!writable) return <>{header}{tabs}<Card className="p-6 text-sm text-fg-muted">Tu rol no permite emitir remitos.</Card></>;
    const [{ data: set }, { data: placesRows }, { data: customers }] = await Promise.all([
      s.supabase.from("remito_settings").select("*").eq("org_id", s.org.org_id).maybeSingle(),
      s.supabase.from("remito_places").select("id, name, address, cuit, iva_condition, customer_id").eq("org_id", s.org.org_id).order("name"),
      s.supabase.from("customers").select("id, name, address, cuit").eq("org_id", s.org.org_id).order("name").limit(1000),
    ]);
    const seen = new Set<string>();
    const norm = (x: string) => x.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
    const places: PlaceOption[] = [];
    (placesRows ?? []).forEach((p) => { seen.add(norm(p.name)); places.push({ key: `p:${p.id}`, name: p.name, address: p.address, cuit: p.cuit, iva: p.iva_condition, place_id: p.id, customer_id: p.customer_id ?? undefined }); });
    (customers ?? []).forEach((c) => { if (!seen.has(norm(c.name))) places.push({ key: `c:${c.id}`, name: c.name, address: c.address, cuit: c.cuit, iva: null, customer_id: c.id }); });
    places.sort((a, b) => a.name.localeCompare(b.name, "es"));
    const issuer: RemitoIssuer = {
      name: set?.issuer_name ?? "", address: set?.address_line ?? "", phones: set?.phones_line ?? "", iva: set?.iva_condition ?? "",
      cuit: set?.cuit ?? "", iibb: set?.iibb ?? "", start: set?.start_date ?? "", whatsapp: set?.whatsapp ?? null,
    };
    const now = nowBA();
    return <>{header}{tabs}<RemitoForm places={places} issuer={issuer} nowDate={now.date} nowTime={now.time} initialOc={sp.oc} /></>;
  }

  // Historial
  const q = (sp.q ?? "").trim();
  const st = sp.s ?? "todos";
  let query = s.supabase.from("remitos_overview").select("*").eq("org_id", s.org.org_id).order("issued_at", { ascending: false }).limit(500);
  if (st !== "todos") query = query.eq("status", st);
  const { data } = await query;
  const needle = q.toLowerCase();
  const rows = ((data ?? []) as RemitoRow[]).filter((r) => !needle || [r.label, r.recipient_name, r.po_number, r.items_text, r.recipient_address].some((x) => x?.toLowerCase().includes(needle)));
  const href = (p: Record<string, string>) => `/remitos?${new URLSearchParams({ v: "historial", ...(q ? { q } : {}), s: st, ...p })}`;

  return (
    <>
      {header}{tabs}
      <Card className="overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-border px-4 py-3 sm:px-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap gap-1.5">
            {STATUS_FILTERS.map(([k, l]) => (
              <Link key={k} href={href({ s: k })} className={cn("rounded-full px-3 py-1 text-xs font-medium", st === k ? "bg-primary text-primary-fg" : "bg-field text-fg-muted hover:text-fg")}>{l}</Link>
            ))}
          </div>
          <form className="relative w-full lg:w-80">
            <input type="hidden" name="v" value="historial" /><input type="hidden" name="s" value={st} />
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-subtle" />
            <input name="q" defaultValue={q} placeholder="Número, destinatario, OC, producto…" className="h-9 w-full rounded-full border border-card-border bg-field pl-9 pr-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/40" />
          </form>
        </div>
        {!rows.length ? (
          <EmptyState icon={<FileText />} title={data?.length ? "Nada con este filtro" : "Todavía no emitiste remitos"} />
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((r) => (
              <li key={r.id}>
                <Link href={`/remitos/${r.id}`} className={cn("grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1 px-4 py-3 hover:bg-surface-2/60 sm:grid-cols-[150px_minmax(0,1.4fr)_minmax(0,1fr)_110px] sm:px-5", r.status === "anulado" && "opacity-60")}>
                  <div>
                    <p className="font-mono text-sm font-semibold">{r.label}</p>
                    <p className="text-xs text-fg-subtle">{r.provisional ? "Provisorio" : "Definitivo"}</p>
                  </div>
                  <div className="col-span-2 row-start-2 min-w-0 sm:col-span-1 sm:row-start-auto">
                    <p className="truncate text-sm font-medium">{r.recipient_name}</p>
                    <p className="truncate text-xs text-fg-subtle">{r.items_count} {r.items_count === 1 ? "renglón" : "renglones"} · {fmtQty(r.units)} u. · {r.items_text}</p>
                  </div>
                  <div className="hidden min-w-0 text-xs text-fg-subtle sm:block">
                    <p>{formatDateTime(r.issued_at)}</p>
                    <p className="truncate">{r.po_number ? `OC ${r.po_number}` : "Sin OC"}{r.created_by_name ? ` · ${r.created_by_name}` : ""}</p>
                  </div>
                  <div className="col-start-2 row-start-1 justify-self-end sm:col-start-auto sm:row-start-auto">
                    <span className={cn("rounded-full px-2.5 py-1 text-xs font-medium", REMITO_STATUS[r.status].tone)}>{REMITO_STATUS[r.status].label}</span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
