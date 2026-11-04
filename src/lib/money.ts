import Decimal from "decimal.js";

/**
 * Aritmética monetaria exacta (nunca float binario para importes).
 * Los importes viajan como string decimal canónico: "132225.00".
 */
Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

export type DecimalInput = string | number | Decimal | null | undefined;

export function dec(v: DecimalInput): Decimal {
  if (v === null || v === undefined || v === "") return new Decimal(0);
  return new Decimal(v);
}

export function isValidDecimal(v: unknown): boolean {
  if (typeof v !== "string" && typeof v !== "number") return false;
  try {
    const d = new Decimal(v);
    return d.isFinite();
  } catch {
    return false;
  }
}

export function round2(v: DecimalInput): string {
  return dec(v).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);
}

export function lineTotal(quantity: DecimalInput, unitPrice: DecimalInput): string {
  return round2(dec(quantity).times(dec(unitPrice)));
}

export function sum(values: DecimalInput[]): string {
  return round2(values.reduce<Decimal>((acc, v) => acc.plus(dec(v)), new Decimal(0)));
}

/** Diferencia absoluta mayor a la tolerancia (por defecto 1 centavo). */
export function differs(a: DecimalInput, b: DecimalInput, tolerance: DecimalInput = "0.01"): boolean {
  return dec(a).minus(dec(b)).abs().greaterThan(dec(tolerance));
}

/**
 * Convierte números en formato argentino o mixto a decimal canónico.
 * "ARS $132.225,00" → "132225.00" · "8815,00" → "8815.00" · "15" → "15"
 * Devuelve null si no es interpretable (nunca inventa).
 */
export function parseArNumber(input: string | null | undefined): string | null {
  if (input === null || input === undefined) return null;
  let s = String(input).replace(/ARS|USD|\$|\s/gi, "").trim();
  if (!s) return null;
  const neg = s.startsWith("-");
  s = s.replace(/^-/, "");
  if (!/^[\d.,]+$/.test(s)) return null;

  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  let normalized: string;

  if (lastComma >= 0 && lastDot >= 0) {
    // El último separador es el decimal
    if (lastComma > lastDot) normalized = s.replace(/\./g, "").replace(",", ".");
    else normalized = s.replace(/,/g, "");
  } else if (lastComma >= 0) {
    const parts = s.split(",");
    // En AR la coma es decimal ("8815,00"); varias comas = separador de miles estilo US
    normalized = parts.length === 2 ? `${parts[0]}.${parts[1]}` : s.replace(/,/g, "");
  } else if (lastDot >= 0) {
    const parts = s.split(".");
    const last = parts[parts.length - 1];
    if (parts.length > 2 && last.length === 2) {
      // OCR suele leer la coma decimal como punto: "132.225.00" → 132225.00
      normalized = parts.slice(0, -1).join("") + "." + last;
    } else {
      // "132.225" o "1.234.567" → miles; "8815.00" → decimal
      const looksThousands = parts.length > 2 || (parts.length === 2 && last.length === 3);
      normalized = looksThousands ? s.replace(/\./g, "") : s;
    }
  } else {
    normalized = s;
  }

  if (!/^\d+(\.\d+)?$/.test(normalized)) return null;
  return (neg ? "-" : "") + normalized;
}
