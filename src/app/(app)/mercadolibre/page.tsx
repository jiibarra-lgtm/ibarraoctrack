import type { Metadata } from "next";
import Link from "next/link";
import { Link2, PackageCheck, Search, ShoppingBag, Truck, Wallet } from "lucide-react";
import { requireOrg, canWrite } from "@/lib/session";
import { Button } from "@/components/ui/button";
import { Card, EmptyState, PageHeader } from "@/components/ui/primitives";
import { Stat } from "@/components/ui/stat";
import { formatMoney } from "@/lib/format";
import { monthLabel } from "@/lib/months";
import type { MlRow } from "@/lib/mercadolibre";
import { cn } from "@/lib/utils";
import { MlRowItem } from "./ml-row";
import { MlPublications } from "./publications";
import { MlSyncButton } from "./sync-button";

export const metadata: Metadata = { title: "Mercado Libre" };

const FILTERS = {
  compra: [["todas", "Todas"], ["en_camino", "En camino"], ["entregada", "Llegaron"], ["sin_precio", "Sin precio"], ["sin_vincular", "Sin vincular"], ["vinculadas", "Con OC"]],
  venta: [["todas", "Todas"], ["sin_vincular", "Sin vincular"], ["vinculadas", "Con OC"]],
} as const;

const monthsBack = (n: number) => {
  const d = new Date();
  return Array.from({ length: n }, (_, i) => {
    const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - (n - 1 - i), 1));
    return x.toISOString().slice(0, 7);
  });
};
const ym = (iso: string | null) => (iso ? new Date(new Date(iso).getTime() - 3 * 3600e3).toISOString().slice(0, 7) : "");
const currentYm = () => ym(new Date().toISOString());
const value = (r: MlRow) => (r.total_amount ? Number(r.total_amount) : r.unit_value && r.quantity ? Number(r.unit_value) * Number(r.quantity) : 0);

export default async function MercadoLibrePage({ searchParams }: { searchParams: Promise<{ t?: string; f?: string; q?: string }> }) {
  const sp = await searchParams;
  const t = sp.t === "venta" ? "venta" : "compra";
  const f = sp.f ?? "todas";
  const q = sp.q ?? "";
  const s = await requireOrg();
  const { data } = await s.supabase.from("ml_orders_overview").select("*").eq("org_id", s.org.org_id)
    .order("ordered_at", { ascending: false, nullsFirst: false }).limit(3000);
  const all = (data ?? []) as MlRow[];
  const { data: conn } = await s.supabase.rpc("ml_conn", { p_action: "status", p_org: s.org.org_id });
  const connected = !!(conn as { connected?: boolean } | null)?.connected;
  const compras = all.filter((r) => r.kind === "compra");
  const ventas = all.filter((r) => r.kind === "venta");
  const thisMonth = currentYm();

  const needle = q.trim().toLowerCase();
  const rows = (t === "venta" ? ventas : compras)
    .filter((r) => f === "todas" ? true
      : f === "sin_precio" ? !r.unit_value
      : f === "sin_vincular" ? !r.po_item_id
      : f === "vinculadas" ? !!r.po_item_id
      : r.status === f)
    .filter((r) => !needle || [r.title, r.ml_id, r.counterpart, r.po_number, r.po_item_description].some((x) => x?.toLowerCase().includes(needle)))
    .sort((a, b) => (b.ordered_at ?? b.created_at).localeCompare(a.ordered_at ?? a.created_at));

  const months = monthsBack(6);
  const byMonth = months.map((m) => {
    const c = compras.filter((r) => ym(r.ordered_at ?? r.created_at) === m);
    const v = ventas.filter((r) => ym(r.ordered_at) === m);
    return { m, compras: c.length, gastado: c.reduce((a, r) => a + value(r), 0), sinPrecio: c.filter((r) => !r.unit_value).length, ventas: v.length, vendido: v.reduce((a, r) => a + value(r), 0) };
  });
  const cur = byMonth[byMonth.length - 1];
  const enCamino = compras.filter((r) => r.status === "en_camino" || r.status === "comprada").length;
  const linked = all.filter((r) => r.po_item_id).length;
  const writable = canWrite(s.org.role);
  const href = (p: Record<string, string>) => `/mercadolibre?${new URLSearchParams({ t, ...(q ? { q } : {}), ...p })}`;

  if (sp.t === "publicaciones") {
    return (
      <>
        <PageHeader title="Mercado Libre" description="Stock de tus publicaciones con reposición automática." actions={<MlSyncButton connected={connected} />} />
        <div className="flex rounded-full bg-field p-0.5 w-fit">
          <Link href="/mercadolibre?t=compra" className="rounded-full px-3 py-1 text-xs font-semibold text-fg-muted hover:text-fg">Compras · {compras.length}</Link>
          <Link href="/mercadolibre?t=venta" className="rounded-full px-3 py-1 text-xs font-semibold text-fg-muted hover:text-fg">Ventas · {ventas.length}</Link>
          <span className="rounded-full bg-primary px-3 py-1 text-xs font-semibold text-primary-fg">Publicaciones y stock</span>
        </div>
        <MlPublications sb={s.supabase} org={s.org.org_id} canEdit={writable} connected={connected} />
      </>
    );
  }

  return (
    <>
      <PageHeader title="Mercado Libre" description="Lo que comprás, lo que te llega y lo que vendés en Mercado Libre, leído de tus mails y vinculado a las órdenes de compra."
        actions={<MlSyncButton connected={connected} />} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat icon={ShoppingBag} label="Compras del mes" value={String(cur.compras)} sub={cur.gastado ? `${formatMoney(cur.gastado)}${cur.sinPrecio ? ` · ${cur.sinPrecio} sin precio` : ""}` : cur.sinPrecio ? `${cur.sinPrecio} sin precio cargado` : undefined} href="/mercadolibre?t=compra" />
        <Stat icon={Truck} label="Por llegar" value={String(enCamino)} tone={enCamino ? "warn" : undefined} href="/mercadolibre?t=compra&f=en_camino" />
        <Stat icon={Wallet} label="Vendido en el mes" value={formatMoney(cur.vendido)} sub={`${cur.ventas} ventas · ${monthLabel(thisMonth)}`} tone="accent" href="/mercadolibre?t=venta" />
        <Stat icon={Link2} label="Vinculadas a OC" value={String(linked)} sub={`de ${all.length} operaciones`} href={`/mercadolibre?t=${t}&f=vinculadas`} />
      </div>

      <Card className="mt-5 overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-border px-4 py-3 sm:px-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-1.5">
            <div className="mr-2 flex rounded-full bg-field p-0.5">
              {(["compra", "venta"] as const).map((k) => (
                <Link key={k} href={`/mercadolibre?t=${k}`} className={cn("rounded-full px-3 py-1 text-xs font-semibold", t === k ? "bg-primary text-primary-fg" : "text-fg-muted hover:text-fg")}>
                  {k === "compra" ? `Compras · ${compras.length}` : `Ventas · ${ventas.length}`}
                </Link>
              ))}
              <Link href="/mercadolibre?t=publicaciones" className="rounded-full px-3 py-1 text-xs font-semibold text-fg-muted hover:text-fg">Publicaciones y stock</Link>
            </div>
            {FILTERS[t].map(([k, l]) => (
              <Link key={k} href={href({ f: k })} className={cn("rounded-full px-3 py-1 text-xs font-medium", f === k ? "bg-surface-2 text-fg ring-1 ring-card-border" : "text-fg-muted hover:text-fg")}>{l}</Link>
            ))}
          </div>
          <form className="relative w-full lg:w-72">
            <input type="hidden" name="t" value={t} />
            <input type="hidden" name="f" value={f} />
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-subtle" />
            <input name="q" defaultValue={q} placeholder="Buscar producto, número, OC…" className="h-9 w-full rounded-full border border-card-border bg-field pl-9 pr-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/40" />
          </form>
        </div>
        {!rows.length ? (
          <EmptyState icon={<PackageCheck />} title={all.length ? "Nada con este filtro" : "Todavía no hay movimientos de Mercado Libre"}
            description={all.length ? undefined : "Cuando el script de Gmail lea tus mails de Mercado Libre, acá aparecen tus compras, envíos y ventas."}
            action={!all.length && <Button asChild variant="secondary"><Link href="/configuracion#gmail">Conectar Gmail</Link></Button>} />
        ) : (
          <ul className="divide-y divide-border">{rows.slice(0, 300).map((r) => <MlRowItem key={r.id} r={r} canEdit={writable} />)}</ul>
        )}
      </Card>

      <Card className="mt-5 overflow-x-auto">
        <table className="w-full min-w-[520px] text-sm">
          <thead className="text-xs text-fg-subtle">
            <tr className="border-b border-border"><th className="px-5 py-2.5 text-left font-medium">Mes</th><th className="px-3 text-right font-medium">Compras</th><th className="px-3 text-right font-medium">Gastado</th><th className="px-3 text-right font-medium">Ventas</th><th className="px-5 text-right font-medium">Vendido</th></tr>
          </thead>
          <tbody className="tabular">
            {byMonth.slice().reverse().map((x) => (
              <tr key={x.m} className="border-b border-border last:border-0">
                <td className="px-5 py-2 capitalize">{monthLabel(x.m)}</td>
                <td className="px-3 text-right">{x.compras}</td>
                <td className="px-3 text-right">{formatMoney(x.gastado)}{x.sinPrecio ? <span className="block text-[11px] text-warn">{x.sinPrecio} sin precio</span> : null}</td>
                <td className="px-3 text-right">{x.ventas}</td>
                <td className="px-5 text-right font-medium">{formatMoney(x.vendido)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </>
  );
}
