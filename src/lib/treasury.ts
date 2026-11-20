/**
 * Tesorería: cheques, caja, conciliación bancaria y flujo de fondos proyectado.
 * Lógica pura (sin base de datos) para poder probarla.
 */

export type ChequeDirection = "recibido" | "emitido";
export type ChequeStatus = "cartera" | "depositado" | "acreditado" | "endosado" | "emitido" | "debitado" | "rechazado" | "anulado";

export const CHEQUE_STATUS: Record<ChequeStatus, { label: string; tone: "accent" | "warn" | "danger" | "neutral" | "info" }> = {
  cartera: { label: "En cartera", tone: "info" },
  depositado: { label: "Depositado", tone: "warn" },
  acreditado: { label: "Acreditado", tone: "accent" },
  endosado: { label: "Endosado", tone: "neutral" },
  emitido: { label: "Emitido", tone: "warn" },
  debitado: { label: "Debitado", tone: "accent" },
  rechazado: { label: "Rechazado", tone: "danger" },
  anulado: { label: "Anulado", tone: "neutral" },
};

/** A qué estados puede pasar un cheque desde el actual. */
export function chequeNext(direction: ChequeDirection, status: ChequeStatus): ChequeStatus[] {
  if (direction === "recibido") {
    if (status === "cartera") return ["depositado", "endosado", "rechazado", "anulado"];
    if (status === "depositado") return ["acreditado", "rechazado", "cartera"];
    if (status === "acreditado") return ["rechazado"];
    if (status === "endosado") return ["rechazado", "cartera"];
    if (status === "rechazado") return ["cartera"];
    return [];
  }
  if (status === "emitido") return ["debitado", "rechazado", "anulado"];
  if (status === "debitado") return ["rechazado"];
  if (status === "rechazado") return ["emitido"];
  return [];
}

/** Cheques que siguen "vivos": los de terceros que todavía son plata a cobrar y los propios que todavía se van a debitar. */
export const chequeOpen = (c: { direction: ChequeDirection; status: ChequeStatus }) =>
  c.direction === "recibido" ? c.status === "cartera" || c.status === "depositado" : c.status === "emitido";

export const CASH_CATEGORIES = {
  venta: { label: "Cobro de venta", dir: "in" },
  aporte: { label: "Aporte del titular", dir: "in" },
  proveedor: { label: "Pago a proveedor", dir: "out" },
  gasto: { label: "Gasto", dir: "out" },
  retiro: { label: "Retiro del titular", dir: "out" },
  banco: { label: "Banco (extracción / depósito)", dir: "both" },
  arqueo: { label: "Ajuste de arqueo", dir: "both" },
  otro: { label: "Otro", dir: "both" },
} as const;
export type CashCategory = keyof typeof CASH_CATEGORIES;

export type CashMov = { id: string; mov_date: string; direction: "in" | "out"; amount: number; category: CashCategory; concept: string; created_at: string };

/** Movimientos de caja con saldo acumulado (orden cronológico). */
export function cashLedger(rows: CashMov[]) {
  let bal = 0;
  return [...rows].sort((a, b) => a.mov_date.localeCompare(b.mov_date) || a.created_at.localeCompare(b.created_at)).map((r) => {
    bal = r2(bal + (r.direction === "in" ? r.amount : -r.amount));
    return { ...r, balance: bal };
  });
}

/** Ajuste de arqueo: lo que hay que registrar para que el saldo del sistema sea lo contado. */
export function cashCountAdjustment(systemBalance: number, counted: number) {
  const diff = r2(counted - systemBalance);
  if (Math.abs(diff) < 0.01) return null;
  return { direction: diff > 0 ? ("in" as const) : ("out" as const), amount: Math.abs(diff) };
}

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const days = (a: string, b: string) => Math.round((Date.parse(a.slice(0, 10)) - Date.parse(b.slice(0, 10))) / 864e5);

export type MatchCandidate = { kind: string; ref_id: string | null; label: string; amount: number; date: string; dir: "in" | "out" };

/**
 * Sugerencias para conciliar un movimiento del banco: mismo sentido, mismo importe (±1 peso o ±0,5%)
 * y fecha cercana. Las mejores primero.
 */
export function suggestMatches(mov: { amount: number; mov_date: string; direction: "in" | "out" }, cands: MatchCandidate[], maxDays = 10) {
  const tol = Math.max(1, mov.amount * 0.005);
  return cands
    .filter((c) => c.dir === mov.direction && Math.abs(c.amount - mov.amount) <= tol && Math.abs(days(c.date, mov.mov_date)) <= maxDays)
    .map((c) => ({ ...c, score: Math.abs(c.amount - mov.amount) / tol + Math.abs(days(c.date, mov.mov_date)) / maxDays }))
    .sort((a, b) => a.score - b.score)
    .slice(0, 3);
}

// ---------------------------------------------------------------------------
// Flujo de fondos proyectado
// ---------------------------------------------------------------------------
export type FlowItem = { date: string; amount: number; dir: "in" | "out"; group: string; label: string; certain: boolean };

/** Lunes de la semana de una fecha (AAAA-MM-DD). */
export function weekStart(iso: string) {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
}

/**
 * Agrupa ingresos y egresos esperados por semana a partir de hoy y arrastra el saldo.
 * Lo vencido y no cobrado/pagado se pone en la semana actual.
 * `collectPct` = qué parte de lo que se espera cobrar entra de verdad (escenario).
 */
export function projectFlow(opening: number, items: FlowItem[], today: string, weeks: number, opts: { collectPct?: number; delayDays?: number } = {}) {
  const pct = (opts.collectPct ?? 100) / 100;
  const delay = opts.delayDays ?? 0;
  const first = weekStart(today);
  const keys = Array.from({ length: weeks }, (_, i) => {
    const d = new Date(`${first}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + i * 7); return d.toISOString().slice(0, 10);
  });
  const buckets = keys.map((k) => ({ week: k, in: 0, out: 0, groups: {} as Record<string, number> }));
  const end = new Date(`${keys[keys.length - 1]}T12:00:00Z`); end.setUTCDate(end.getUTCDate() + 6);
  const last = end.toISOString().slice(0, 10);
  for (const it of items) {
    let date = it.date.slice(0, 10);
    if (it.dir === "in" && !it.certain && delay) { const d = new Date(`${date}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + delay); date = d.toISOString().slice(0, 10); }
    if (date < today) date = today;
    if (date > last) continue;
    const idx = Math.max(0, keys.findIndex((k, i) => date >= k && (i === keys.length - 1 || date < keys[i + 1])));
    const amt = it.dir === "in" && !it.certain ? it.amount * pct : it.amount;
    const b = buckets[idx];
    if (it.dir === "in") b.in += amt; else b.out += amt;
    b.groups[it.group] = (b.groups[it.group] ?? 0) + (it.dir === "in" ? amt : -amt);
  }
  let bal = opening;
  return buckets.map((b) => {
    const open = bal;
    bal = r2(bal + b.in - b.out);
    return { ...b, in: r2(b.in), out: r2(b.out), opening: r2(open), closing: bal };
  });
}

/** Fechas de vencimiento de un gasto fijo en un rango (frecuencia en meses, día de vencimiento). */
export function fixedCostDates(from: string, to: string, dueDay: number | null, frequency: number | null) {
  const out: string[] = [];
  const day = Math.min(28, Math.max(1, dueDay || 10));
  const step = Math.max(1, frequency || 1);
  const y = Number(from.slice(0, 4)), m = Number(from.slice(5, 7));
  for (let i = 0; i < 24; i += step) {
    const mm = ((m - 1 + i) % 12) + 1, yy = y + Math.floor((m - 1 + i) / 12);
    const d = `${yy}-${String(mm).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    if (d > to) break;
    if (d >= from) out.push(d);
  }
  return out;
}
