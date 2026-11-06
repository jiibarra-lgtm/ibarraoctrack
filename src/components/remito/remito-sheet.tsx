/* eslint-disable @next/next/no-img-element */
import { baParts, fmtQty, type RemitoSheetData } from "@/lib/remitos";

const ROWS = 16;
const ink = "#111";
const line = "1px solid #222";
const soft = "1px solid #bbb";
const yellow = "#fffbe6";

/**
 * Hoja del remito, igual al modelo impreso de Ibarra Insumos (carta, 8,5 x 11 in).
 * Se usa en la vista previa (escalada) y en la impresión / PDF.
 */
export function RemitoSheet({ data, qrSvg }: { data: RemitoSheetData; qrSvg?: string | null }) {
  const { d, m, y, hm } = baParts(data.issuedAt);
  const it = data.issuer;
  const rows = [...data.items, ...Array.from({ length: Math.max(0, ROWS - data.items.length) }, () => null)];
  return (
    <div className="remito-sheet" style={{ width: "8.5in", minHeight: "11in", padding: "0.42in 0.42in 0.3in", background: "#fff", color: ink, fontFamily: "Inter, 'Helvetica Neue', Arial, sans-serif", fontFeatureSettings: "\"calt\" 0", position: "relative", boxSizing: "border-box", printColorAdjust: "exact", WebkitPrintColorAdjust: "exact" }}>
      {data.voided && (
        <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", pointerEvents: "none", zIndex: 5 }}>
          <span style={{ transform: "rotate(-28deg)", fontSize: 110, fontWeight: 800, color: "rgba(200,30,30,0.18)", letterSpacing: 8 }}>ANULADO</span>
        </div>
      )}

      {/* Encabezado */}
      <div style={{ display: "grid", gridTemplateColumns: "3.75fr 1.2fr 4.2fr", border: line }}>
        <div style={{ padding: "12px 10px 8px", borderRight: line }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <img src="/brand/remito-logo.jpg" alt="Ibarra Insumos" style={{ width: 205, height: 54, objectFit: "cover" }} />
            <div style={{ fontWeight: 700, fontSize: 18, lineHeight: 1.25 }}>{it.name.split(" ").map((w, i) => <div key={i}>{w}</div>)}</div>
          </div>
          <div style={{ textAlign: "center", fontSize: 9.5, lineHeight: 1.55, marginTop: 6 }}>
            <div>{it.address}</div>
            <div>{it.phones}</div>
            <div>{it.iva}</div>
          </div>
        </div>
        <div style={{ borderRight: line, display: "grid", gridTemplateRows: "auto 1fr" }}>
          <div style={{ fontSize: 40, fontWeight: 800, textAlign: "center", lineHeight: 1, padding: "10px 0", borderBottom: line }}>X</div>
          <div style={{ fontSize: 8, fontWeight: 700, textAlign: "center", lineHeight: 1.35, padding: "6px 4px" }}>DOCUMENTO<br />NO VÁLIDO<br />COMO<br />FACTURA</div>
        </div>
        <div style={{ display: "grid", gridTemplateRows: "auto auto 1fr" }}>
          <div style={{ textAlign: "center", fontWeight: 800, fontSize: 17, padding: "10px 6px 4px" }}>
            {data.provisional ? "REMITO PROVISORIO" : "REMITO"}
            <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: 0.5, marginTop: 2 }}>N° {data.label ?? "0001-________"}</div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 44px 44px 60px", borderTop: line, borderBottom: line, fontSize: 12 }}>
            <div style={{ padding: "6px 10px", fontWeight: 700 }}>FECHA</div>
            {[d, m, y].map((x, i) => <div key={i} style={{ borderLeft: line, padding: "6px 0", textAlign: "center" }}>{x}</div>)}
          </div>
          <div style={{ fontSize: 10, lineHeight: 1.7, padding: "6px 14px" }}>
            <div>C.U.I.T: {it.cuit}</div>
            <div>ING. BRUTOS: {it.iibb}</div>
            <div>INIC. ACTIVIDADES: {it.start}</div>
          </div>
        </div>
      </div>

      {/* Destinatario */}
      <div style={{ border: line, borderTop: "none", fontSize: 12.5 }}>
        <Row label="Señor(es):" value={data.recipient.name} />
        <Row label="Domicilio:" value={data.recipient.address} />
        <div style={{ display: "grid", gridTemplateColumns: "92px 1fr 64px 1fr" }}>
          <Cell bold>I.V.A.:</Cell>
          <Cell bg>{data.recipient.iva}</Cell>
          <Cell bold>CUIT:</Cell>
          <Cell bg last>{data.recipient.cuit}</Cell>
        </div>
      </div>

      <div style={{ fontStyle: "italic", fontSize: 11, margin: "10px 0 8px" }}>Remitimos a Uds. lo siguiente</div>

      {/* Renglones */}
      <div style={{ border: line, position: "relative" }}>
        <img src="/brand/remito-marca.jpg" alt="" aria-hidden style={{ position: "absolute", left: "10%", top: "34%", width: "80%", opacity: 0.9, pointerEvents: "none" }} />
        <div style={{ display: "grid", gridTemplateColumns: "6.2fr 1.5fr 3.8fr", background: "#222", color: "#fff", fontSize: 11, fontWeight: 700 }}>
          <div style={{ padding: "8px 10px" }}>DESCRIPCIÓN</div>
          <div style={{ padding: "8px 0", textAlign: "center" }}>CANTIDAD</div>
          <div style={{ padding: "8px 0", textAlign: "center" }}>DETALLE</div>
        </div>
        {rows.map((r, i) => (
          <div key={i} style={{ display: "grid", gridTemplateColumns: "6.2fr 1.5fr 3.8fr", minHeight: 27, fontSize: 11.5, background: i % 2 ? "rgba(235,235,235,0.75)" : "rgba(255,255,255,0.6)", borderTop: soft, position: "relative" }}>
            <div style={{ padding: "6px 10px", borderRight: soft, wordBreak: "break-word" }}>{r?.description}</div>
            <div style={{ padding: "6px 0", textAlign: "center", borderRight: soft, fontWeight: 600 }}>{r ? fmtQty(r.quantity) : ""}</div>
            <div style={{ padding: "6px 10px", wordBreak: "break-word" }}>{r?.detail}</div>
          </div>
        ))}
      </div>

      {data.notes && <div style={{ fontSize: 10.5, marginTop: 8 }}><b>Observaciones:</b> {data.notes}</div>}

      {/* Pie */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginTop: data.notes ? 40 : 64 }}>
        <div style={{ fontSize: 8.5, textAlign: "center", width: 110 }}>
          {qrSvg ? <div style={{ width: 82, height: 82, margin: "0 0 3px" }} dangerouslySetInnerHTML={{ __html: qrSvg }} /> : <div style={{ width: 82, height: 82 }} />}
          <div style={{ textAlign: "left" }}>Consultas por WhatsApp</div>
        </div>
        <div style={{ width: "36%", textAlign: "center", fontSize: 10.5 }}>
          <div style={{ borderTop: "1px solid #333", paddingTop: 6 }}>Recibido — Firma y sello</div>
        </div>
      </div>
      <div style={{ fontSize: 7.5, color: "#777", marginTop: 10, display: "flex", justifyContent: "space-between" }}>
        <span>{data.label ? `Remito ${data.label}` : "Vista previa"}{data.poNumber ? ` · OC ${data.poNumber}` : ""}</span>
        <span>Emitido {d}/{m}/{y} {hm} hs</span>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "92px 1fr", borderBottom: line }}>
      <Cell bold>{label}</Cell>
      <Cell bg last>{value}</Cell>
    </div>
  );
}
function Cell({ children, bold, bg, last }: { children: React.ReactNode; bold?: boolean; bg?: boolean; last?: boolean }) {
  return <div style={{ padding: "8px 10px", fontWeight: bold ? 700 : 400, background: bg ? yellow : "#fff", borderRight: last ? "none" : line }}>{children}</div>;
}
