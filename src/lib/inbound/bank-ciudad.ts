/**
 * Aviso diario "Últimos movimientos" de Banco Ciudad.
 * Sólo se guardan los movimientos del negocio: pagos del GCBA a proveedores y retenciones SIRCREB.
 */
export type BankMovement = {
  account: string; mov_date: string; detail: string; amount: string; occurrence: number;
  kind: "gcba" | "sircreb"; counterpart_cuit: string | null;
};

const GCBA_CUIT = "34999032089";
const toNumber = (s: string) => s.replace(/\./g, "").replace(",", ".");

export function isCiudadMovementsMail(from: string, subject: string) {
  return /bancociudad/i.test(from) && /movimientos/i.test(subject);
}

export function parseCiudadMovements(body: string, receivedAt: string): BankMovement[] {
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
    if (/movimientos al|FECHA DETALLE/i.test(detail)) continue;
    const kind = /PAGO A PROVEEDORES/i.test(detail) && new RegExp(`${GCBA_CUIT}|GOBIERNO CI`, "i").test(detail) ? "gcba"
      : /SIRCREB|RET IB/i.test(detail) ? "sircreb" : null;
    if (!kind) continue;
    const year = Number(mm) > asOfMonth ? asOfYear - 1 : asOfYear;
    const mov_date = `${year}-${mm}-${dd}`;
    const amount = toNumber(amt).replace("-", "");
    const key = `${mov_date}|${detail}|${amount}`;
    const occurrence = (seen.get(key) ?? 0) + 1;
    seen.set(key, occurrence);
    out.push({ account, mov_date, detail: detail.slice(0, 200), amount, occurrence, kind, counterpart_cuit: kind === "gcba" ? GCBA_CUIT : null });
  }
  return out;
}
