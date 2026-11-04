const TZ = "America/Argentina/Buenos_Aires";

const moneyFormatters = new Map<string, Intl.NumberFormat>();

/** $ 132.225,00 — nunca suma monedas distintas: cada importe lleva su moneda. */
export function formatMoney(value: string | number | null | undefined, currency = "ARS"): string {
  if (value === null || value === undefined || value === "") return "—";
  let f = moneyFormatters.get(currency);
  if (!f) {
    f = new Intl.NumberFormat("es-AR", { style: "currency", currency, minimumFractionDigits: 2, maximumFractionDigits: 2 });
    moneyFormatters.set(currency, f);
  }
  // Intl acepta string decimal sin pérdida de precisión
  return f.format(value as unknown as number);
}

const qtyFormatter = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 4 });
export function formatQty(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  return qtyFormatter.format(value as unknown as number);
}

/** Fechas de negocio (columna date "AAAA-MM-DD") → DD/MM/AAAA sin corrimientos de zona. */
export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (m && value.length === 10) return `${m[3]}/${m[2]}/${m[1]}`;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("es-AR", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric" }).format(d);
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("es-AR", {
    timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
  }).format(d);
}

/** "12/11/2024" → "2024-11-12". Devuelve null si la fecha no existe. */
export function parseArDate(input: string | null | undefined): string | null {
  if (!input) return null;
  const m = /(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(input);
  if (!m) return null;
  const [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return null;
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function todayISO(): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  return parts; // en-CA => AAAA-MM-DD
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
