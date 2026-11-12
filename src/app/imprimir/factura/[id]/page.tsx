import type { Metadata } from "next";
import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { requireOrg } from "@/lib/session";
import { isUuid } from "@/lib/utils";
import { formatMoney } from "@/lib/format";
import { afipQrUrl, IVA_CONDITIONS, letterOf, VOUCHER_NAME } from "@/lib/einvoice";
import { InvoicePrintBar } from "./print-bar";

type Line = { description: string; quantity: number; unit: string | null; unit_price: number; vat_rate: number; amount: number; net_amount: number; total_amount: number };
type Vat = { id: number; rate: number; base: number; amount: number };

const pad = (n: number, l: number) => String(n).padStart(l, "0");
const d = (iso: string | null) => (iso ? iso.slice(0, 10).split("-").reverse().join("/") : "");
const fmtCuit = (c: string) => (c.length === 11 ? `${c.slice(0, 2)}-${c.slice(2, 10)}-${c.slice(10)}` : c);
const qty = (n: number) => String(Number(n)).replace(".", ",");

async function load(id: string) {
  const s = await requireOrg();
  const { data: e } = await s.supabase.from("arca_emissions_overview").select("*").eq("id", id).eq("org_id", s.org.org_id).maybeSingle();
  if (!e) return null;
  const { data: issuer } = await s.supabase.from("remito_settings").select("issuer_name, address_line, phones_line, iva_condition, cuit, iibb, start_date").eq("org_id", s.org.org_id).maybeSingle();
  return { e, issuer };
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  if (!isUuid(id)) return { title: "Factura" };
  const r = await load(id);
  if (!r) return { title: "Factura" };
  const { e } = r;
  return { title: { absolute: `${VOUCHER_NAME[e.voucher_type]} ${pad(e.point_of_sale, 5)}-${pad(Number(e.number), 8)} - ${e.receiver_name}` } };
}

export default async function PrintInvoice({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const r = await load(id);
  if (!r) notFound();
  const { e, issuer } = r;
  const cuit = (issuer?.cuit ?? "").replace(/\D/g, "");
  const letter = letterOf(e.voucher_type);
  const lines = e.lines as Line[];
  const vat = e.vat_detail as Vat[];
  const qr = await QRCode.toString(afipQrUrl({ date: e.issue_date, cuit, pointOfSale: e.point_of_sale, type: e.voucher_type, number: Number(e.number), total: Number(e.total), docType: e.doc_type, docNumber: e.doc_number, cae: e.cae }), { type: "svg", margin: 0, errorCorrectionLevel: "M" });
  const isA = letter === "A";

  return (
    <div className="inv-root">
      <style>{`
        @page { size: A4; margin: 10mm; }
        html, body { background: #e9ece9 !important; }
        .inv-root { min-height: 100vh; padding: 72px 0 40px; display: flex; justify-content: center; color: #111; }
        .inv { width: 190mm; background: #fff; padding: 8mm; box-shadow: 0 10px 40px rgba(0,0,0,.15); font: 10.5px/1.35 ui-sans-serif, system-ui, Arial; }
        .inv .box { border: 1px solid #111; }
        .inv table { width: 100%; border-collapse: collapse; }
        .inv th { background: #f1f1f1; font-weight: 600; text-align: left; padding: 4px 6px; border-bottom: 1px solid #111; }
        .inv td { padding: 4px 6px; border-bottom: 1px solid #e5e5e5; vertical-align: top; }
        .inv .r { text-align: right; font-variant-numeric: tabular-nums; }
        @media print { html, body { background: #fff !important; } .inv-root { padding: 0; display: block; min-height: 0; } .inv { box-shadow: none; width: auto; padding: 0; } .no-print { display: none !important; } }
      `}</style>
      <InvoicePrintBar label={`${VOUCHER_NAME[e.voucher_type]} ${pad(e.point_of_sale, 5)}-${pad(Number(e.number), 8)}`} />
      <div className="inv">
        <div className="box" style={{ display: "grid", gridTemplateColumns: "1fr 70px 1fr", position: "relative" }}>
          <div style={{ padding: "8px 10px", borderRight: "1px solid #111" }}>
            <div style={{ fontSize: 16, fontWeight: 700 }}>{issuer?.issuer_name}</div>
            <div style={{ marginTop: 6 }}>{issuer?.address_line}</div>
            {issuer?.phones_line && <div>{issuer.phones_line}</div>}
            <div style={{ marginTop: 4 }}><b>Condición frente al IVA:</b> {issuer?.iva_condition}</div>
          </div>
          <div style={{ textAlign: "center", borderRight: "1px solid #111", paddingTop: 4 }}>
            <div style={{ fontSize: 34, fontWeight: 800, lineHeight: 1 }}>{letter}</div>
            <div style={{ fontSize: 9 }}>COD. {pad(e.voucher_type, 2)}</div>
          </div>
          <div style={{ padding: "8px 10px" }}>
            <div style={{ fontSize: 16, fontWeight: 700 }}>{e.kind === "factura" ? "FACTURA" : "NOTA DE CRÉDITO"}</div>
            <div style={{ marginTop: 4 }}><b>Punto de Venta:</b> {pad(e.point_of_sale, 5)} &nbsp; <b>Comp. Nro:</b> {pad(Number(e.number), 8)}</div>
            <div><b>Fecha de Emisión:</b> {d(e.issue_date)}</div>
            <div style={{ marginTop: 4 }}><b>CUIT:</b> {fmtCuit(cuit)}</div>
            <div><b>Ingresos Brutos:</b> {issuer?.iibb}</div>
            <div><b>Inicio de Actividades:</b> {issuer?.start_date}</div>
          </div>
          <div style={{ position: "absolute", top: 0, right: 8, fontSize: 9, fontWeight: 700 }}>ORIGINAL</div>
        </div>

        <div className="box" style={{ marginTop: 6, padding: "6px 10px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "2px 16px" }}>
          <div><b>CUIT:</b> {fmtCuit(e.doc_number)}</div>
          <div><b>Apellido y Nombre / Razón Social:</b> {e.receiver_name}</div>
          <div><b>Condición frente al IVA:</b> {IVA_CONDITIONS[e.iva_condition]?.label}</div>
          <div><b>Domicilio:</b> {e.receiver_address}</div>
          <div><b>Condición de venta:</b> Cuenta corriente</div>
          {e.po_label && <div><b>Orden de compra:</b> {e.po_label}</div>}
          {e.associated_number && <div style={{ gridColumn: "1 / -1" }}><b>Comprobante asociado:</b> {VOUCHER_NAME[e.associated_type]} {pad(e.associated_pv, 5)}-{pad(Number(e.associated_number), 8)}</div>}
        </div>

        <table style={{ marginTop: 6 }} className="box">
          <thead><tr>
            <th>Descripción</th><th className="r" style={{ width: 60 }}>Cantidad</th><th style={{ width: 50 }}>U. medida</th>
            <th className="r" style={{ width: 90 }}>Precio unit.</th>{isA && <th className="r" style={{ width: 50 }}>IVA</th>}<th className="r" style={{ width: 95 }}>Subtotal</th>
          </tr></thead>
          <tbody>
            {lines.map((l, i) => {
              // A: precios sin IVA; B: precios finales
              const unit = isA ? l.net_amount / l.quantity : l.total_amount / l.quantity;
              return (
                <tr key={i}>
                  <td>{l.description}</td><td className="r">{qty(l.quantity)}</td><td>{l.unit ?? "unidades"}</td>
                  <td className="r">{formatMoney(unit)}</td>{isA && <td className="r">{qty(l.vat_rate)}%</td>}<td className="r">{formatMoney(isA ? l.net_amount : l.total_amount)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <div className="box" style={{ marginTop: 6, padding: "6px 10px", display: "flex", justifyContent: "space-between", gap: 16 }}>
          <div style={{ flex: 1 }}>{e.notes && <><b>Observaciones:</b> {e.notes}</>}</div>
          <table style={{ width: 260 }}>
            <tbody>
              {isA ? (
                <>
                  <tr><td>Importe Neto Gravado: $</td><td className="r">{formatMoney(e.net)}</td></tr>
                  {vat.map((v) => <tr key={v.id}><td>IVA {qty(v.rate)}%: $</td><td className="r">{formatMoney(v.amount)}</td></tr>)}
                </>
              ) : <tr><td>Subtotal: $</td><td className="r">{formatMoney(e.total)}</td></tr>}
              <tr><td style={{ fontWeight: 700, fontSize: 13 }}>Importe Total: $</td><td className="r" style={{ fontWeight: 700, fontSize: 13 }}>{formatMoney(e.total)}</td></tr>
            </tbody>
          </table>
        </div>
        {!isA && (
          <div className="box" style={{ marginTop: 6, padding: "4px 10px", fontSize: 9.5 }}>
            <b>Régimen de Transparencia Fiscal al Consumidor (Ley 27.743)</b> — IVA Contenido: $ {formatMoney(e.vat)}
          </div>
        )}

        <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ width: 92, height: 92 }} dangerouslySetInnerHTML={{ __html: qr }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 700, fontStyle: "italic" }}>ARCA</div>
            <div style={{ fontWeight: 600 }}>Comprobante Autorizado</div>
            <div style={{ fontSize: 9, color: "#555" }}>Esta Administración Federal no se responsabiliza por los datos ingresados en el detalle de la operación</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div><b>CAE N°:</b> {e.cae}</div>
            <div><b>Fecha de Vto. de CAE:</b> {d(e.cae_due)}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
