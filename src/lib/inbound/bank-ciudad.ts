/**
 * Aviso diario "Últimos movimientos" de Banco Ciudad: todos los movimientos de la cuenta y el saldo.
 * El aviso no trae el signo: compras, impuestos y débitos son salidas, los pagos del GCBA y depósitos entradas;
 * las transferencias se resuelven después con la diferencia de saldo entre avisos (o la regla que cargue el usuario).
 */
export type BankCategory =
  | "gcba" | "sircreb" | "pago_recibido" | "transferencia" | "deposito" | "cheque_depositado" | "cheque_pagado" | "cheque_rechazado"
  | "compra" | "debito_automatico" | "extraccion" | "imp_cheque" | "comision" | "iva_banco" | "interes_descubierto" | "interes_ganado"
  | "plazo_fijo_constitucion" | "plazo_fijo_acreditacion" | "devolucion" | "embargo" | "otro";

export type BankMovement = {
  account: string; mov_date: string; detail: string; amount: string; occurrence: number;
  kind: BankCategory; direction: "in" | "out" | null; counterpart_cuit: string | null; counterpart_name: string | null; cbu: string | null;
};
export type BankBalance = { account: string; as_of: string; balance: string };

const GCBA_CUIT = "34999032089";
const toNumber = (s: string) => s.replace(/\./g, "").replace(",", ".");

const RULES: [RegExp, BankCategory, "in" | "out" | null][] = [
  [/EMBARGO|BLOQUEO JUDICIAL|AFECTACION JUDICIAL|OFICIO/i, "embargo", "out"],
  [/SIRCREB|RET\.? ?I\.?B|RETENCION I\.?B/i, "sircreb", "out"],
  [/25413|IMP\.? ?(S\/|SOBRE )?(DEB|CRED)|IMPUESTO (AL )?(CHEQUE|DEBITO|CREDITO)|IMP DB\/CR|LEY 25\.?413/i, "imp_cheque", "out"],
  [/PERC(EPCION)?\.? ?IVA|IVA (BASICO|21|10)|I\.V\.A\./i, "iva_banco", "out"],
  [/COMISION|MANTENIMIENTO|CARGO (POR|MENSUAL)|SERVICIO DE CUENTA|PAQUETE/i, "comision", "out"],
  [/INTERES(ES)? (DESCUBIERTO|DEUDOR|ACUERDO|SALDO DEUDOR)|INT\.? ?DEUD/i, "interes_descubierto", "out"],
  [/INTERES(ES)? (PLAZO|GANADO|ACREDIT)|ACRED\.? ?INT/i, "interes_ganado", "in"],
  [/(CONST|CONSTITUCION|ALTA).{0,12}(PLAZO FIJO|P\.? ?FIJO)/i, "plazo_fijo_constitucion", "out"],
  [/(PLAZO FIJO|P\.? ?FIJO)/i, "plazo_fijo_acreditacion", "in"],
  [/RECHAZ|CHEQUE DEVUELTO|DEVOL(UCION)? (DE )?CH/i, "cheque_rechazado", null],
  [/DEP(OSITO|\.)? ?(DE )?CH(EQUE)?|CHEQUE DEPOSITADO|CLEARING/i, "cheque_depositado", "in"],
  [/CHEQUE (PAGADO|COMPENSADO|DEBITADO)|PAGO CHEQUE|CH\.? ?PAGADO/i, "cheque_pagado", "out"],
  [/DEVOLUCION|REINTEGRO|CONTRACARGO|ANULACION/i, "devolucion", "in"],
  [/DEP(OSITO|\.)? ?(EN )?EFECTIVO|DEPOSITO/i, "deposito", "in"],
  [/PAGO A PROVEEDORES|ACREDITACION (DE )?HABERES|ACRED(ITACION)?\.? ?(PAGO|TRANSF)/i, "pago_recibido", "in"],
  [/EXTRACCION|EXTR\.? |ATM|CAJERO/i, "extraccion", "out"],
  [/DEBITO AUTOMATICO|DEB\.? ?AUT|DEBIN|PAGO (DE )?SERVICIOS?|PAGO MIS CUENTAS|PMC/i, "debito_automatico", "out"],
  [/^COMPRA|COMPRA |DEBITO (TARJETA|VISA|MAESTRO)/i, "compra", "out"],
  [/TRANSF/i, "transferencia", null],
];

export function classifyMovement(detail: string): { kind: BankCategory; direction: "in" | "out" | null; counterpart_cuit: string | null; counterpart_name: string | null; cbu: string | null } {
  const d = detail.toUpperCase();
  let kind: BankCategory = "otro", direction: "in" | "out" | null = null;
  for (const [re, k, dir] of RULES) if (re.test(d)) { kind = k; direction = dir; break; }
  if (/PAGO A PROVEEDORES/.test(d) && (d.includes(GCBA_CUIT) || /GOBIERNO CI/.test(d))) { kind = "gcba"; direction = "in"; }
  const cuitM = /\b(2[0347]|3[034])-?(\d{8})-?(\d)\b/.exec(d);
  const cbuM = /\b(\d{22})\b/.exec(d.replace(/-/g, " ").replace(/\s+/g, " ")) ?? /-(\d{20,22})-/.exec(d);
  const counterpart_cuit = kind === "gcba" ? GCBA_CUIT : cuitM ? cuitM[1] + cuitM[2] + cuitM[3] : null;
  let counterpart_name: string | null = null;
  if (cuitM) {
    const after = d.slice(d.indexOf(cuitM[0]) + cuitM[0].length).replace(/^[-\s\d]+/, "").replace(/-?VAR$/, "").trim();
    counterpart_name = after.length >= 3 && /[A-Z]/.test(after) ? after.slice(0, 80) : null;
  } else if (kind === "compra") {
    counterpart_name = d.replace(/^COMPRA\s+/, "").replace(/\s+-\s+.*$/, "").slice(0, 80);
  }
  return { kind, direction, counterpart_cuit, counterpart_name, cbu: cbuM ? cbuM[1].padStart(22, "0") : null };
}

export function isCiudadMovementsMail(from: string, subject: string) {
  return /bancociudad/i.test(from) && /movimientos/i.test(subject);
}

export function parseCiudadMovements(body: string, receivedAt: string): BankMovement[] {
  return parseCiudad(body, receivedAt).movements;
}

export function parseCiudad(body: string, receivedAt: string): { movements: BankMovement[]; balance: BankBalance | null } {
  const flat = body.replace(/[|*\r\n\t]+/g, " ").replace(/\s{2,}/g, " ");
  const head = /movimientos al (\d{2})\/(\d{2}) de tu cuenta\s+(?:CA|CC)?\s*\$?\s*(\d{6,22})/i.exec(flat);
  const account = head?.[3] ?? "desconocida";
  const recv = new Date(receivedAt);
  const asOfMonth = head ? Number(head[2]) : recv.getUTCMonth() + 1;
  const asOfYear = asOfMonth > recv.getUTCMonth() + 1 ? recv.getUTCFullYear() - 1 : recv.getUTCFullYear();

  const out: BankMovement[] = [];
  const seen = new Map<string, number>();
  const re = /(?:^|\s)(\d{2})\/(\d{2})\s+(?!de tu cuenta)(.+?)\s+\$\s*(-?[\d.]+,\d{2})/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(flat))) {
    const [, dd, mm, rawDetail, amt] = m;
    const detail = rawDetail.trim().replace(/\s+/g, " ");
    if (/movimientos al|FECHA DETALLE|Saldo:/i.test(detail)) continue;
    const year = Number(mm) > asOfMonth ? asOfYear - 1 : asOfYear;
    const mov_date = `${year}-${mm}-${dd}`;
    const neg = amt.startsWith("-");
    const amount = toNumber(amt).replace("-", "");
    const key = `${mov_date}|${detail}|${amount}`;
    const occurrence = (seen.get(key) ?? 0) + 1;
    seen.set(key, occurrence);
    const c = classifyMovement(detail);
    out.push({ account, mov_date, detail: detail.slice(0, 200), amount, occurrence, ...c, direction: neg ? "out" : c.direction });
  }
  const sal = /Saldo:\s*\$\s*(-?[\d.]+,\d{2})/i.exec(flat);
  const balance = sal ? { account, as_of: receivedAt, balance: toNumber(sal[1]) } : null;
  return { movements: out, balance };
}
