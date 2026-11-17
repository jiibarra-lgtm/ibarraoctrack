import type { Metadata } from "next";
import { FileSpreadsheet, FileText, Package } from "lucide-react";
import { requireOrg } from "@/lib/session";
import { Badge, Card, CardHeader, Input, NativeSelect, PageHeader } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { Stat } from "@/components/ui/stat";
import { buildCatalog } from "@/lib/catalog";
import { catalogParams, loadCatalog } from "@/lib/catalog-load";
import { formatMoney } from "@/lib/format";

export const metadata: Metadata = { title: "Catálogo" };

export default async function CatalogPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const p = catalogParams(sp);
  const s = await requireOrg();
  const { rows } = await loadCatalog(s.supabase, s.org.org_id);
  const all = buildCatalog(rows);
  const groups = all.filter((g) => !p.rubro || g.rubro === p.rubro);
  const total = groups.reduce((a, g) => a + g.items.length, 0);
  const noPrice = groups.reduce((a, g) => a + g.items.filter((i) => i.price == null).length, 0);
  const qs = new URLSearchParams({ precios: p.prices ? "1" : "0", desc: p.specs ? "1" : "0", ...(p.rubro ? { rubro: p.rubro } : {}), ...(p.title !== "Catálogo de productos" ? { titulo: p.title } : {}) }).toString();

  return (
    <>
      <PageHeader title="Catálogo" description="Todos tus productos (los de tus renglones de convenio, sin repetir), listos para mandar a un cliente en Excel o PDF."
        actions={<>
          <Button asChild variant="secondary"><a href={`/api/catalogo/export?${qs}`}><FileSpreadsheet /> Excel</a></Button>
          <Button asChild><a href={`/imprimir/catalogo?${qs}`} target="_blank" rel="noreferrer"><FileText /> PDF</a></Button>
        </>} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat icon={Package} label="Productos" value={String(total)} sub={`${rows.length} renglones de convenio`} />
        {all.slice(0, 3).map((g) => <Stat key={g.rubro} icon={Package} label={g.rubro} value={String(g.items.length)} />)}
      </div>

      <Card className="mt-4">
        <CardHeader title="Cómo lo querés" description="Elegí y después tocá Excel o PDF." />
        <form className="grid gap-3 px-5 pb-5 sm:grid-cols-[1fr_200px_auto_auto_auto] sm:items-end">
          <label className="grid gap-1 text-xs text-fg-muted">Título<Input name="titulo" defaultValue={p.title} maxLength={80} /></label>
          <label className="grid gap-1 text-xs text-fg-muted">Rubro
            <NativeSelect name="rubro" defaultValue={p.rubro ?? ""}>
              <option value="">Todos</option>
              {all.map((g) => <option key={g.rubro} value={g.rubro}>{g.rubro}</option>)}
            </NativeSelect>
          </label>
          <label className="flex items-center gap-2 text-sm"><input type="hidden" name="precios" value="0" /><input type="checkbox" name="precios" value="1" defaultChecked={p.prices} className="size-4" /> Con precios</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="desc" value="1" defaultChecked={p.specs} className="size-4" /> Con descripción</label>
          <Button type="submit" variant="secondary">Aplicar</Button>
        </form>
        {p.prices && noPrice > 0 && <p className="px-5 pb-4 text-xs text-warn">{noPrice} productos no tienen precio cargado: salen como “Consultar”.</p>}
      </Card>

      <div className="mt-4 grid gap-4">
        {groups.map((g) => (
          <Card key={g.rubro} className="overflow-hidden">
            <CardHeader title={g.rubro} description={`${g.items.length} productos`} />
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead className="text-left text-xs text-fg-subtle"><tr><th className="px-5 py-2 font-medium">Producto</th><th className="px-3 py-2 font-medium">Presentación</th><th className="px-3 py-2 font-medium">Marca</th><th className="px-3 py-2 font-medium">Código</th>{p.prices && <th className="px-5 py-2 text-right font-medium">Precio c/IVA</th>}</tr></thead>
                <tbody className="divide-y divide-border">
                  {g.items.map((i) => (
                    <tr key={i.key} className="align-top">
                      <td className="px-5 py-2"><p className="font-medium">{i.name}</p>{p.specs && i.spec && <p className="mt-0.5 line-clamp-2 text-xs text-fg-subtle">{i.spec}</p>}</td>
                      <td className="px-3 py-2">{i.presentation ?? "—"}</td>
                      <td className="px-3 py-2">{i.brand ? <Badge>{i.brand}</Badge> : "—"}</td>
                      <td className="px-3 py-2 text-xs text-fg-subtle">{i.codes.join(", ")}</td>
                      {p.prices && <td className="px-5 py-2 text-right font-medium tabular">{i.price != null ? formatMoney(i.price) : <span className="text-fg-subtle">Consultar</span>}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        ))}
      </div>
    </>
  );
}
