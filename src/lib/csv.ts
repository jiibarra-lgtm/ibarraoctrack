/**
 * CSV para Excel en español (Argentina): separador ";", coma decimal, fechas DD/MM/AAAA y BOM UTF-8
 * para que abra con acentos correctos haciendo doble clic.
 */
export type Col<T> = { header: string; value: (r: T) => unknown; type?: "money" | "number" | "date" | "text" };

const cell = (v: unknown, type?: Col<unknown>["type"]): string => {
  if (v === null || v === undefined || v === "") return "";
  let s: string;
  if (type === "money" || type === "number") {
    const n = Number(v);
    s = Number.isFinite(n) ? (type === "money" ? n.toFixed(2) : String(n)).replace(".", ",") : String(v);
  } else if (type === "date") {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v));
    s = m ? `${m[3]}/${m[2]}/${m[1]}` : String(v);
  } else s = String(v);
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function toCsv<T>(rows: T[], cols: Col<T>[]): string {
  const head = cols.map((c) => cell(c.header)).join(";");
  const body = rows.map((r) => cols.map((c) => cell(c.value(r), c.type)).join(";"));
  return "﻿" + [head, ...body].join("\r\n") + "\r\n";
}
