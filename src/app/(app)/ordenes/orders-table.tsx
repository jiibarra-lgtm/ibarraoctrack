"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  flexRender, getCoreRowModel, getPaginationRowModel, getSortedRowModel, useReactTable,
  type ColumnDef, type SortingState, type VisibilityState, type RowSelectionState,
} from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Columns3, Download, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Menu, MenuContent, MenuTrigger, MenuLabel } from "@/components/ui/overlays";
import { StatusBadge } from "@/components/po/status-badge";
import { formatDate, formatMoney } from "@/lib/format";
import { sum } from "@/lib/money";
import type { PoStatus } from "@/lib/po/schema";
import { PO_STATUS_LABEL } from "@/lib/po/schema";
import { cn } from "@/lib/utils";
import * as DropdownPrimitive from "@radix-ui/react-dropdown-menu";

export type OrderRow = {
  id: string; display_number: string; bac_number: string | null; expediente_number: string | null; process_number: string | null;
  customer_name: string | null; dependencia: string | null; issue_date: string | null; due_date: string | null; status: PoStatus;
  currency: string; total_amount: string | null; net_amount: string | null; items_count: number; source: string;
};

const columns: ColumnDef<OrderRow>[] = [
  {
    id: "select",
    enableSorting: false, enableHiding: false,
    header: ({ table }) => (
      <input type="checkbox" aria-label="Seleccionar todo" className="size-4 accent-[var(--primary)]"
        checked={table.getIsAllPageRowsSelected()} onChange={table.getToggleAllPageRowsSelectedHandler()} />
    ),
    cell: ({ row }) => (
      <input type="checkbox" aria-label="Seleccionar" className="size-4 accent-[var(--primary)]" onClick={(e) => e.stopPropagation()}
        checked={row.getIsSelected()} onChange={row.getToggleSelectedHandler()} />
    ),
  },
  {
    accessorKey: "bac_number", header: "Orden",
    cell: ({ row }) => (
      <div className="min-w-0">
        <Link href={`/ordenes/${row.original.id}`} className="font-medium text-fg hover:text-primary" onClick={(e) => e.stopPropagation()}>
          {row.original.bac_number ?? row.original.display_number}
        </Link>
        <p className="font-mono text-[11px] text-fg-subtle">{row.original.display_number}</p>
      </div>
    ),
  },
  {
    accessorKey: "customer_name", header: "Organismo",
    cell: ({ getValue }) => <span className="line-clamp-2 max-w-64">{(getValue() as string) ?? "—"}</span>,
  },
  { accessorKey: "process_number", header: "Proceso", cell: ({ getValue }) => <span className="font-mono text-[12px]">{(getValue() as string) ?? "—"}</span> },
  { accessorKey: "expediente_number", header: "Expediente", cell: ({ getValue }) => <span className="font-mono text-[12px] text-fg-muted">{(getValue() as string) ?? "—"}</span> },
  { accessorKey: "issue_date", header: "Fecha", cell: ({ getValue }) => <span className="tabular">{formatDate(getValue() as string)}</span> },
  { accessorKey: "items_count", header: "Renglones", cell: ({ getValue }) => <span className="tabular">{getValue() as number}</span> },
  { accessorKey: "status", header: "Estado", cell: ({ getValue }) => <StatusBadge status={getValue() as PoStatus} /> },
  {
    accessorKey: "total_amount", header: () => <span className="block text-right">Adjudicado</span>,
    sortingFn: (a, b) => Number(a.original.total_amount ?? a.original.net_amount ?? 0) - Number(b.original.total_amount ?? b.original.net_amount ?? 0),
    cell: ({ row }) => <span className="block text-right font-medium tabular">{formatMoney(row.original.total_amount ?? row.original.net_amount, row.original.currency)}</span>,
  },
];

const COLUMN_LABEL: Record<string, string> = {
  bac_number: "Orden", customer_name: "Organismo", process_number: "Proceso", expediente_number: "Expediente",
  issue_date: "Fecha", items_count: "Renglones", status: "Estado", total_amount: "Adjudicado",
};

function toCsv(rows: OrderRow[]) {
  const head = ["Orden BAC", "Interno", "Organismo", "Proceso", "Expediente", "Fecha", "Estado", "Moneda", "Importe total", "Renglones"];
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = rows.map((r) => [
    r.bac_number, r.display_number, r.customer_name, r.process_number, r.expediente_number, formatDate(r.issue_date),
    PO_STATUS_LABEL[r.status], r.currency, (r.total_amount ?? r.net_amount ?? "").toString().replace(".", ","), r.items_count,
  ].map(esc).join(";"));
  return "﻿" + [head.join(";"), ...lines].join("\n"); // BOM + ";" para Excel en es-AR
}

export function OrdersTable({ rows }: { rows: OrderRow[] }) {
  const router = useRouter();
  const [sorting, setSorting] = React.useState<SortingState>([]);
  const [visibility, setVisibility] = React.useState<VisibilityState>({ expediente_number: false });
  const [selection, setSelection] = React.useState<RowSelectionState>({});

  React.useEffect(() => {
    try {
      const saved = localStorage.getItem("oc:orders-columns");
      if (saved) setVisibility(JSON.parse(saved));
    } catch {}
  }, []);
  React.useEffect(() => {
    try { localStorage.setItem("oc:orders-columns", JSON.stringify(visibility)); } catch {}
  }, [visibility]);

  const table = useReactTable({
    data: rows, columns, getRowId: (r) => r.id,
    state: { sorting, columnVisibility: visibility, rowSelection: selection },
    onSortingChange: setSorting, onColumnVisibilityChange: setVisibility, onRowSelectionChange: setSelection,
    getCoreRowModel: getCoreRowModel(), getSortedRowModel: getSortedRowModel(), getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize: 25 } },
  });

  const selected = table.getSelectedRowModel().rows.map((r) => r.original);
  const exportRows = selected.length ? selected : table.getSortedRowModel().rows.map((r) => r.original);

  // Totales por moneda: nunca se mezclan
  const totalsByCurrency = React.useMemo(() => {
    const m = new Map<string, string[]>();
    exportRows.filter((r) => r.status !== "anulada").forEach((r) => {
      const v = r.total_amount ?? r.net_amount;
      if (v != null) m.set(r.currency, [...(m.get(r.currency) ?? []), String(v)]);
    });
    return [...m.entries()].map(([c, vals]) => ({ currency: c, total: sum(vals) }));
  }, [exportRows]);

  const download = () => {
    const blob = new Blob([toCsv(exportRows)], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `ordenes-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2.5">
        <p className="text-sm text-fg-muted">
          {selected.length ? <><span className="font-medium text-fg">{selected.length}</span> seleccionadas · </> : null}
          <span className="tabular">{rows.length}</span> órdenes
          {totalsByCurrency.map((t) => <span key={t.currency} className="ml-2 font-medium text-fg tabular">· {formatMoney(t.total, t.currency)}</span>)}
        </p>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={download}><Download /> CSV{selected.length ? ` (${selected.length})` : ""}</Button>
          <Menu>
            <MenuTrigger asChild><Button variant="ghost" size="sm"><Columns3 /> Columnas</Button></MenuTrigger>
            <MenuContent>
              <MenuLabel>Columnas visibles</MenuLabel>
              {table.getAllLeafColumns().filter((c) => c.getCanHide()).map((c) => (
                <DropdownPrimitive.CheckboxItem
                  key={c.id} checked={c.getIsVisible()} onCheckedChange={(v) => c.toggleVisibility(!!v)}
                  onSelect={(e) => e.preventDefault()}
                  className="flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-sm outline-none data-[highlighted]:bg-surface-2"
                >
                  <span className={cn("grid size-4 place-items-center rounded border border-border-strong text-[10px]", c.getIsVisible() && "border-primary bg-primary text-primary-fg")}>{c.getIsVisible() ? "✓" : ""}</span>
                  {COLUMN_LABEL[c.id] ?? c.id}
                </DropdownPrimitive.CheckboxItem>
              ))}
            </MenuContent>
          </Menu>
        </div>
      </div>

      {/* Escritorio */}
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full text-sm">
          <thead>
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id} className="border-b border-border bg-surface-2/50">
                {hg.headers.map((h) => (
                  <th key={h.id} className="whitespace-nowrap px-4 py-2.5 text-left text-xs font-medium text-fg-muted">
                    {h.column.getCanSort() ? (
                      <button className="inline-flex items-center gap-1 hover:text-fg" onClick={h.column.getToggleSortingHandler()}>
                        {flexRender(h.column.columnDef.header, h.getContext())}
                        {h.column.getIsSorted() === "asc" ? <ArrowUp className="size-3" /> : h.column.getIsSorted() === "desc" ? <ArrowDown className="size-3" /> : <ChevronsUpDown className="size-3 opacity-40" />}
                      </button>
                    ) : flexRender(h.column.columnDef.header, h.getContext())}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((r) => (
              <tr key={r.id} onClick={() => router.push(`/ordenes/${r.original.id}`)}
                className={cn("cursor-pointer border-b border-border last:border-0 hover:bg-surface-2/60", r.getIsSelected() && "bg-info-soft/50")}>
                {r.getVisibleCells().map((c) => <td key={c.id} className="px-4 py-3 align-middle">{flexRender(c.column.columnDef.cell, c.getContext())}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Móvil */}
      <ul className="divide-y divide-border md:hidden">
        {table.getRowModel().rows.map((r) => {
          const o = r.original;
          return (
            <li key={r.id}>
              <Link href={`/ordenes/${o.id}`} className="flex flex-col gap-1.5 px-4 py-3 active:bg-surface-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{o.bac_number ?? o.display_number}</span>
                  <StatusBadge status={o.status} />
                </div>
                <p className="line-clamp-1 text-sm text-fg-muted">{o.customer_name ?? "—"}</p>
                <div className="flex items-center justify-between text-xs text-fg-subtle">
                  <span className="tabular">{formatDate(o.issue_date)} · {o.items_count} renglones</span>
                  <span className="text-sm font-medium text-fg tabular">{formatMoney(o.total_amount ?? o.net_amount, o.currency)}</span>
                </div>
              </Link>
            </li>
          );
        })}
      </ul>

      {table.getPageCount() > 1 && (
        <div className="flex items-center justify-between border-t border-border px-4 py-2.5 text-sm text-fg-muted">
          <span className="tabular">Página {table.getState().pagination.pageIndex + 1} de {table.getPageCount()}</span>
          <div className="flex gap-1">
            <Button variant="secondary" size="icon-sm" disabled={!table.getCanPreviousPage()} onClick={() => table.previousPage()} aria-label="Anterior"><ChevronLeft /></Button>
            <Button variant="secondary" size="icon-sm" disabled={!table.getCanNextPage()} onClick={() => table.nextPage()} aria-label="Siguiente"><ChevronRight /></Button>
          </div>
        </div>
      )}
    </div>
  );
}
