import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CatalogLine, CatalogOptions } from "@/lib/catalog";

/** Tus renglones de convenio (los que ofertás) + datos de la empresa para el encabezado. */
export async function loadCatalog(sb: SupabaseClient, org: string) {
  const [{ data: lines }, { data: convs }, { data: rs }, { data: o }] = await Promise.all([
    sb.from("convenio_lines").select("contract_number, line_number, item_code, unit, product_name, item_description, my_spec, my_current_price, my_stock")
      .eq("org_id", org).eq("is_mine", true).order("contract_number").order("line_number").limit(5000),
    sb.from("convenios").select("contract_number, name").eq("org_id", org),
    sb.from("remito_settings").select("address_line, phones_line, whatsapp, cuit").eq("org_id", org).maybeSingle(),
    sb.from("organizations").select("name").eq("id", org).maybeSingle(),
  ]);
  const cn = new Map(((convs ?? []) as { contract_number: string; name: string | null }[]).map((c) => [c.contract_number, c.name]));
  const rows = ((lines ?? []) as Omit<CatalogLine, "convenio_name">[]).map((l) => ({ ...l, convenio_name: cn.get(l.contract_number) ?? null }));
  const r = (rs ?? {}) as { address_line?: string | null; phones_line?: string | null; whatsapp?: string | null; cuit?: string | null };
  const company: CatalogOptions["company"] = {
    name: (o as { name?: string } | null)?.name ?? "Ibarra Insumos",
    address: r.address_line ?? undefined, phones: r.phones_line ?? undefined, whatsapp: r.whatsapp ?? undefined, cuit: r.cuit ?? undefined,
  };
  return { rows, company };
}

export const catalogParams = (sp: URLSearchParams | Record<string, string | string[] | undefined>) => {
  // el checkbox manda "0" (oculto) y "1": vale el último
  const get = (k: string) => { const v = sp instanceof URLSearchParams ? sp.getAll(k).pop() : sp[k]; return (Array.isArray(v) ? v[v.length - 1] : v) ?? undefined; };
  return { prices: get("precios") !== "0", specs: get("desc") === "1", rubro: get("rubro") || null, title: (get("titulo") || "Catálogo de productos").slice(0, 80) };
};
