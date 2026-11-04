"use client";
import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search, X } from "lucide-react";
import { Input, NativeSelect } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { PO_STATUSES, PO_STATUS_LABEL } from "@/lib/po/schema";

export function OrdersFilters({ customers }: { customers: { id: string; name: string }[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [q, setQ] = React.useState(sp.get("q") ?? "");
  const [pending, start] = React.useTransition();

  const set = React.useCallback((key: string, value: string) => {
    const next = new URLSearchParams(sp.toString());
    if (value) next.set(key, value); else next.delete(key);
    start(() => router.replace(`${pathname}?${next.toString()}`, { scroll: false }));
  }, [sp, pathname, router]);

  React.useEffect(() => {
    const t = setTimeout(() => { if ((sp.get("q") ?? "") !== q) set("q", q); }, 300);
    return () => clearTimeout(t);
  }, [q, sp, set]);

  const active = ["q", "estado", "organismo", "desde", "hasta"].some((k) => sp.get(k));

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center" data-pending={pending || undefined}>
      <div className="relative sm:w-72">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-fg-subtle" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="OC, expediente, proceso, organismo" className="pl-8" />
      </div>
      <NativeSelect value={sp.get("estado") ?? ""} onChange={(e) => set("estado", e.target.value)} className="sm:w-44">
        <option value="">Todos los estados</option>
        {PO_STATUSES.map((s) => <option key={s} value={s}>{PO_STATUS_LABEL[s]}</option>)}
      </NativeSelect>
      <NativeSelect value={sp.get("organismo") ?? ""} onChange={(e) => set("organismo", e.target.value)} className="sm:w-60">
        <option value="">Todos los organismos</option>
        {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </NativeSelect>
      <div className="flex items-center gap-2">
        <Input type="date" value={sp.get("desde") ?? ""} onChange={(e) => set("desde", e.target.value)} aria-label="Desde" className="sm:w-40" />
        <span className="text-fg-subtle">–</span>
        <Input type="date" value={sp.get("hasta") ?? ""} onChange={(e) => set("hasta", e.target.value)} aria-label="Hasta" className="sm:w-40" />
      </div>
      {active && (
        <Button variant="ghost" size="sm" onClick={() => { setQ(""); start(() => router.replace(pathname)); }}>
          <X /> Limpiar
        </Button>
      )}
    </div>
  );
}
