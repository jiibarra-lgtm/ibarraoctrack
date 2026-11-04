"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Command } from "cmdk";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Search, FileText, Package, Building2, Factory, ListTree, Clock, Loader2, Plus, Upload, LayoutDashboard } from "lucide-react";
import { globalSearch, type SearchResult } from "@/app/actions";
import { cn } from "@/lib/utils";

const KIND: Record<string, { label: string; icon: React.ElementType }> = {
  orden: { label: "Órdenes", icon: FileText },
  renglon: { label: "Productos en órdenes", icon: ListTree },
  organismo: { label: "Organismos", icon: Building2 },
  proveedor: { label: "Proveedores", icon: Factory },
  producto: { label: "Catálogo", icon: Package },
};

const RECENT_KEY = "oc:recent-searches";

function readRecent(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]").slice(0, 6);
  } catch {
    return [];
  }
}
function pushRecent(q: string) {
  try {
    const list = [q, ...readRecent().filter((x) => x !== q)].slice(0, 6);
    localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  } catch {}
}

export function CommandSearch() {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [q, setQ] = React.useState("");
  const [results, setResults] = React.useState<SearchResult[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [recent, setRecent] = React.useState<string[]>([]);
  const reqId = React.useRef(0);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const changeOpen = React.useCallback((o: boolean) => {
    if (o) setRecent(readRecent());
    setOpen(o);
  }, []);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === "k" && (e.metaKey || e.ctrlKey)) || (e.key === "/" && !/input|textarea|select/i.test((e.target as HTMLElement)?.tagName))) {
        e.preventDefault();
        setOpen((o) => {
          if (!o) setRecent(readRecent());
          return !o;
        });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /** Búsqueda con debounce; descarta respuestas viejas para no pisar resultados. */
  const onQuery = (value: string) => {
    setQ(value);
    if (timer.current) clearTimeout(timer.current);
    const term = value.trim();
    const id = ++reqId.current;
    if (term.length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    timer.current = setTimeout(async () => {
      const r = await globalSearch(term);
      if (id === reqId.current) {
        setResults(r);
        setLoading(false);
      }
    }, 180);
  };

  const go = (href: string) => {
    if (q.trim().length >= 2) pushRecent(q.trim());
    setOpen(false);
    onQuery("");
    router.push(href);
  };

  const grouped = results.reduce<Record<string, SearchResult[]>>((acc, r) => {
    (acc[r.kind] ??= []).push(r);
    return acc;
  }, {});

  return (
    <>
      <button
        onClick={() => changeOpen(true)}
        className="flex h-9 w-full max-w-md items-center gap-2 rounded-md border border-border bg-surface px-3 text-sm text-fg-subtle shadow-xs transition-colors hover:border-border-strong"
      >
        <Search className="size-4" />
        <span className="flex-1 truncate text-left">
          <span className="hidden sm:inline">Buscar por OC, expediente, proceso, organismo, producto…</span>
          <span className="sm:hidden">Buscar…</span>
        </span>
        <kbd className="hidden rounded border border-border bg-surface-2 px-1.5 font-mono text-[10px] text-fg-muted sm:inline">⌘K</kbd>
      </button>

      <DialogPrimitive.Root open={open} onOpenChange={changeOpen}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px]" />
          <DialogPrimitive.Content className="fixed left-1/2 top-[8vh] z-50 w-[calc(100vw-1.5rem)] max-w-2xl -translate-x-1/2 overflow-hidden rounded-xl border border-border bg-surface shadow-2xl">
            <DialogPrimitive.Title className="sr-only">Buscador global</DialogPrimitive.Title>
            <DialogPrimitive.Description className="sr-only">Buscá órdenes, expedientes, procesos, organismos y productos</DialogPrimitive.Description>
            <Command shouldFilter={false} loop>
              <div className="flex items-center gap-2 border-b border-border px-4">
                {loading ? <Loader2 className="size-4 animate-spin text-fg-subtle" /> : <Search className="size-4 text-fg-subtle" />}
                <Command.Input
                  autoFocus
                  value={q}
                  onValueChange={onQuery}
                  placeholder="412-17904-OC24, EX-2023-…, Argerich, lavandina…"
                  className="h-12 flex-1 bg-transparent text-[15px] outline-none placeholder:text-fg-subtle"
                />
                <kbd className="rounded border border-border px-1.5 font-mono text-[10px] text-fg-subtle">ESC</kbd>
              </div>
              <Command.List className="max-h-[60vh] overflow-y-auto p-2">
                {q.trim().length < 2 && (
                  <>
                    {recent.length > 0 && (
                      <Command.Group heading="Búsquedas recientes" className={groupCls}>
                        {recent.map((r) => (
                          <Command.Item key={r} value={`recent-${r}`} onSelect={() => onQuery(r)} className={itemCls}>
                            <Clock className="size-4 text-fg-subtle" /> {r}
                          </Command.Item>
                        ))}
                      </Command.Group>
                    )}
                    <Command.Group heading="Accesos rápidos" className={groupCls}>
                      <Command.Item value="go-dashboard" onSelect={() => go("/dashboard")} className={itemCls}><LayoutDashboard className="size-4 text-fg-subtle" /> Dashboard</Command.Item>
                      <Command.Item value="go-import" onSelect={() => go("/ordenes/importar")} className={itemCls}><Upload className="size-4 text-fg-subtle" /> Importar orden BAC</Command.Item>
                      <Command.Item value="go-new" onSelect={() => go("/ordenes/nueva")} className={itemCls}><Plus className="size-4 text-fg-subtle" /> Nueva orden manual</Command.Item>
                      <Command.Item value="go-orders" onSelect={() => go("/ordenes")} className={itemCls}><FileText className="size-4 text-fg-subtle" /> Todas las órdenes</Command.Item>
                    </Command.Group>
                  </>
                )}
                {q.trim().length >= 2 && !loading && results.length === 0 && (
                  <div className="px-3 py-10 text-center text-sm text-fg-muted">Sin resultados para “{q.trim()}”.</div>
                )}
                {Object.entries(grouped).map(([kind, rows]) => {
                  const meta = KIND[kind] ?? { label: kind, icon: FileText };
                  const Icon = meta.icon;
                  return (
                    <Command.Group key={kind} heading={meta.label} className={groupCls}>
                      {rows.map((r) => (
                        <Command.Item key={`${r.kind}-${r.href}-${r.title}`} value={`${r.kind}-${r.href}-${r.title}`} onSelect={() => go(r.href)} className={itemCls}>
                          <Icon className="size-4 shrink-0 text-fg-subtle" />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm text-fg">{r.title}</p>
                            {r.subtitle && <p className="truncate text-xs text-fg-subtle">{r.subtitle}</p>}
                          </div>
                        </Command.Item>
                      ))}
                    </Command.Group>
                  );
                })}
              </Command.List>
            </Command>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    </>
  );
}

const groupCls = cn("[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-fg-subtle");
const itemCls = "flex cursor-pointer items-center gap-3 rounded-md px-2.5 py-2 text-sm data-[selected=true]:bg-surface-2";
