import { NextResponse, type NextRequest } from "next/server";
import { requireOrg } from "@/lib/session";
import { writeStyledXlsx, type Cell } from "@/lib/xlsx-styled";
import { trialBalance, type Account, type TrialRow } from "@/lib/accounting";
import { todayISO } from "@/lib/format";

const ymd = /^\d{4}-\d{2}-\d{2}$/;
const dmy = (iso: string) => iso.slice(0, 10).split("-").reverse().join("/");

/** Libro diario y balance de sumas y saldos del período, en Excel para el contador. */
export async function GET(req: NextRequest) {
  const s = await requireOrg();
  const sp = req.nextUrl.searchParams;
  const today = todayISO();
  const from = ymd.test(sp.get("from") ?? "") ? sp.get("from")! : `${today.slice(0, 7)}-01`;
  const to = ymd.test(sp.get("to") ?? "") ? sp.get("to")! : today;
  const org = s.org.org_id;
  const [{ data: accData }, { data: tbData }, { data: entries }] = await Promise.all([
    s.supabase.from("acc_accounts").select("code, name, type, imputable, active").eq("org_id", org),
    s.supabase.rpc("acc_trial_balance", { p_org: org, p_from: from, p_to: to }),
    s.supabase.from("acc_entries").select("entry_date, description, created_at, acc_lines(account_code, debit, credit)").eq("org_id", org)
      .gte("entry_date", from).lte("entry_date", to).order("entry_date").order("created_at").limit(10000),
  ]);
  const accounts = ((accData ?? []) as Account[]).sort((a, b) => a.code.localeCompare(b.code, "en", { numeric: true }));
  const name = new Map(accounts.map((a) => [a.code, a.name]));
  const rows = ((tbData ?? []) as TrialRow[]).map((r) => ({ account_code: r.account_code, debit: Number(r.debit), credit: Number(r.credit), opening: Number(r.opening) }));
  type E = { entry_date: string; description: string; acc_lines: { account_code: string; debit: string; credit: string }[] };
  const diario: Cell[][] = [
    [{ v: `Libro diario del ${dmy(from)} al ${dmy(to)}`, s: "title" }], [],
    ["N°", "Fecha", "Cuenta", "Nombre", "Concepto", "Debe", "Haber"].map((h) => ({ v: h, s: "headDark" as const })),
  ];
  ((entries ?? []) as E[]).forEach((e, i) => {
    for (const l of [...e.acc_lines].sort((a, b) => Number(b.debit) - Number(a.debit)))
      diario.push([{ v: i + 1, s: "text" }, { v: dmy(e.entry_date), s: "text" }, { v: l.account_code, s: "text" }, { v: name.get(l.account_code) ?? "", s: "text" },
        { v: e.description, s: "wrap" }, { v: Number(l.debit) || null, s: "money" }, { v: Number(l.credit) || null, s: "money" }]);
  });
  const tb = trialBalance(accounts, rows);
  const balance: Cell[][] = [
    [{ v: `Balance de sumas y saldos del ${dmy(from)} al ${dmy(to)}`, s: "title" }], [],
    ["Cuenta", "Nombre", "Saldo inicial", "Debe", "Haber", "Saldo final"].map((h) => ({ v: h, s: "headDark" as const })),
    ...tb.lines.map((l): Cell[] => [{ v: l.code, s: "text" }, { v: l.name, s: l.imputable ? "text" : "totalLabel" }, { v: l.opening, s: "money" }, { v: l.debit, s: "money" }, { v: l.credit, s: "money" }, { v: l.closing, s: "money" }]),
    [{ v: "Totales", s: "totalLabel" }, "", "", { v: tb.totals.debit, s: "moneyBold" }, { v: tb.totals.credit, s: "moneyBold" }, { v: tb.totals.closing, s: "moneyBold" }],
  ];
  const xlsx = writeStyledXlsx([
    { name: "Diario", rows: diario, widths: [7, 11, 9, 34, 50, 16, 16], headerRow: 2 },
    { name: "Sumas y saldos", rows: balance, widths: [10, 40, 16, 16, 16, 16], headerRow: 2 },
  ]);
  return new NextResponse(Buffer.from(xlsx), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="contabilidad-${from}-a-${to}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
