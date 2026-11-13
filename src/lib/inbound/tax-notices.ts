/**
 * Avisos fiscales que llegan por mail: e-Ventanilla de ARCA (Domicilio Fiscal Electrónico) y AGIP.
 * ARCA no manda el contenido, sólo el sistema que emitió la comunicación: con eso se arma la alerta.
 */
export type TaxNotice = {
  message_id: string; at: string; source: "arca" | "agip"; system: string; title: string;
  severity: "danger" | "warn" | "info"; kind: "dfe" | "falta_presentacion" | "intimacion" | "plan" | "vep" | "embargo" | "otro";
  vep_number: string | null; cuit: string | null;
};

export const isTaxNoticeMail = (from: string) => /eventanilla@(arca|afip)\.go[bv]\.ar|@agip\.gob?\.ar|@agip\.gov\.ar/i.test(from);

const clean = (s: string) => s.replace(/&quot;/g, '"').replace(/[\t\r]+/g, " ").replace(/\s+/g, " ").trim();

export function parseTaxNotice(m: { id: string; from: string; subject: string; body: string; date: string }): TaxNotice | null {
  if (!isTaxNoticeMail(m.from)) return null;
  const subject = clean(m.subject), body = clean(m.body), text = `${subject} ${body}`;
  const at = new Date(m.date).toISOString();
  const cuitM = /\[?(\d{2})-?(\d{8})-?(\d)\]?/.exec(text);
  const cuit = cuitM ? cuitM[1] + cuitM[2] + cuitM[3] : null;

  if (/eventanilla/i.test(m.from)) {
    const system = /sistema\s+"([^"]+)"/i.exec(subject)?.[1] ?? /sistema\s+"([^"]+)"/i.exec(body)?.[1] ?? "Comunicación";
    let kind: TaxNotice["kind"] = "dfe", severity: TaxNotice["severity"] = "warn";
    if (/falta de presentaci/i.test(system)) { kind = "falta_presentacion"; severity = "danger"; }
    else if (/intimaci|fiscalizaci|inducci|inconsistenc|determinaci|sumario|embargo|ejecuci/i.test(system)) { kind = "intimacion"; severity = "danger"; }
    else if (/facilidades|plan de pago/i.test(system)) { kind = "plan"; severity = "warn"; }
    else if (/domicilio fiscal|cuentas tributarias|malvina|presentaci[oó]n digital/i.test(system)) { severity = "warn"; }
    else if (/pyme|campa[ñn]a|percepci[oó]n iva - plataformas/i.test(system)) { severity = "info"; }
    return { message_id: m.id, at, source: "arca", system: system.slice(0, 160), title: `ARCA: nueva comunicación de "${system}"`.slice(0, 200), severity, kind, vep_number: null, cuit };
  }

  // AGIP: planes, VEP generados, mandatarios (embargos / ejecuciones)
  const vep = /\bvep\s*(?:n[º°o.]*\s*)?(\d{6,14})\b/i.exec(text)?.[1] ?? null;
  const embargo = /embargo|ejecuci[oó]n fiscal|mandatari/i.test(text) || /mandatario/i.test(m.from);
  const kind: TaxNotice["kind"] = embargo ? "embargo" : vep ? "vep" : /plan/i.test(text) ? "plan" : "otro";
  const severity: TaxNotice["severity"] = embargo ? "danger" : vep ? "warn" : "info";
  const title = subject.replace(/^(re|rv|fwd?):\s*/i, "").slice(0, 200) || "Aviso de AGIP";
  return { message_id: m.id, at, source: "agip", system: "AGIP", title: `AGIP: ${title}`.slice(0, 200), severity, kind, vep_number: vep, cuit };
}
