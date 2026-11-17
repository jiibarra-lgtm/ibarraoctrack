import type { Metadata } from "next";
import { requireOrg } from "@/lib/session";
import { buildCatalog } from "@/lib/catalog";
import { catalogParams, loadCatalog } from "@/lib/catalog-load";
import { formatMoney, todayISO } from "@/lib/format";
import { CatalogPrintBar } from "./print-bar";

export const metadata: Metadata = { title: { absolute: "Catálogo Ibarra Insumos" } };

/** Catálogo listo para imprimir o "Guardar como PDF" y mandarlo a clientes. */
export default async function PrintCatalog({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const p = catalogParams(sp);
  const s = await requireOrg();
  const { rows, company } = await loadCatalog(s.supabase, s.org.org_id);
  const groups = buildCatalog(rows).filter((g) => !p.rubro || g.rubro === p.rubro);
  const date = todayISO().split("-").reverse().join("/");
  const total = groups.reduce((a, g) => a + g.items.length, 0);
  return (
    <div className="cat-root">
      <style>{`
        @page { size: A4; margin: 14mm 12mm; }
        html, body { background: #eef1ee !important; color: #111; }
        .cat-root { padding: 72px 0 40px; display: flex; justify-content: center; font-family: ui-sans-serif, system-ui, sans-serif; }
        .cat-sheet { width: 210mm; background: #fff; padding: 14mm 12mm; box-shadow: 0 10px 40px rgba(0,0,0,.12); }
        .cat-head { display: flex; align-items: center; gap: 14px; border-bottom: 3px solid #1f6f43; padding-bottom: 10px; margin-bottom: 14px; }
        .cat-head img { height: 54px; width: auto; }
        .cat-head h1 { font-size: 22px; font-weight: 700; margin: 0; letter-spacing: -.01em; }
        .cat-head p { margin: 2px 0 0; font-size: 11px; color: #555; }
        .cat-group { break-inside: auto; margin-top: 16px; }
        .cat-group h2 { font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; color: #1f6f43; margin: 0 0 6px; border-bottom: 1px solid #cfd8d2; padding-bottom: 3px; break-after: avoid; }
        .cat-table { width: 100%; border-collapse: collapse; font-size: 11px; }
        .cat-table th { text-align: left; font-weight: 600; color: #555; padding: 4px 6px; border-bottom: 1px solid #ddd; }
        .cat-table td { padding: 5px 6px; border-bottom: 1px solid #eee; vertical-align: top; }
        .cat-table tr { break-inside: avoid; }
        .cat-table .price { text-align: right; white-space: nowrap; font-weight: 600; font-variant-numeric: tabular-nums; }
        .cat-name { font-weight: 600; }
        .cat-spec { color: #666; font-size: 10px; margin-top: 2px; }
        .cat-foot { margin-top: 18px; font-size: 10px; color: #777; border-top: 1px solid #ddd; padding-top: 8px; }
        @media print {
          html, body { background: #fff !important; }
          .cat-root { padding: 0; display: block; }
          .cat-sheet { width: auto; padding: 0; box-shadow: none; }
          .no-print { display: none !important; }
        }
      `}</style>
      <CatalogPrintBar back="/productos/catalogo" />
      <div className="cat-sheet">
        <div className="cat-head">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/remito-logo.jpg" alt="" />
          <div>
            <h1>{p.title}{p.rubro ? ` · ${p.rubro}` : ""}</h1>
            <p>{[company.name, company.address, company.phones].filter(Boolean).join(" · ")}</p>
            <p>{[company.whatsapp ? `WhatsApp ${company.whatsapp}` : null, company.cuit ? `CUIT ${company.cuit}` : null, `Actualizado el ${date}`, `${total} productos`].filter(Boolean).join(" · ")}</p>
          </div>
        </div>
        {groups.map((g) => (
          <section key={g.rubro} className="cat-group">
            <h2>{g.rubro}</h2>
            <table className="cat-table">
              <thead><tr><th>Producto</th><th>Presentación</th><th>Marca</th><th>Código GCBA</th>{p.prices && <th style={{ textAlign: "right" }}>Precio c/IVA</th>}</tr></thead>
              <tbody>
                {g.items.map((i) => (
                  <tr key={i.key}>
                    <td><div className="cat-name">{i.name}</div>{p.specs && i.spec && <div className="cat-spec">{i.spec}</div>}</td>
                    <td>{i.presentation ?? ""}</td>
                    <td>{i.brand ?? ""}</td>
                    <td style={{ fontSize: 10, color: "#555" }}>{i.codes.join(", ")}</td>
                    {p.prices && <td className="price">{i.price != null ? formatMoney(i.price) : "Consultar"}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ))}
        <p className="cat-foot">{p.prices ? "Precios con IVA incluido, sujetos a cambio sin previo aviso. " : ""}Productos que proveemos en los Convenios Marco del GCBA.</p>
      </div>
    </div>
  );
}
