"use client";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Input, NativeSelect } from "@/components/ui/primitives";
import { PO_STATUSES, PO_STATUS_LABEL } from "@/lib/po/schema";

export function RankingFilters({ customers }: { customers: { id: string; name: string }[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const set = (k: string, v: string) => {
    const p = new URLSearchParams(sp.toString());
    if (v) p.set(k, v); else p.delete(k);
    router.replace(`${pathname}?${p.toString()}`, { scroll: false });
  };
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
      <NativeSelect value={sp.get("organismo") ?? ""} onChange={(e) => set("organismo", e.target.value)} className="sm:w-60">
        <option value="">Todos los organismos</option>{customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </NativeSelect>
      <NativeSelect value={sp.get("estado") ?? ""} onChange={(e) => set("estado", e.target.value)} className="sm:w-44">
        <option value="">Todos los estados</option>{PO_STATUSES.filter((s) => s !== "anulada").map((s) => <option key={s} value={s}>{PO_STATUS_LABEL[s]}</option>)}
      </NativeSelect>
      <div className="flex items-center gap-2">
        <Input type="date" value={sp.get("desde") ?? ""} onChange={(e) => set("desde", e.target.value)} className="sm:w-40" aria-label="Desde" />
        <span className="text-fg-subtle">–</span>
        <Input type="date" value={sp.get("hasta") ?? ""} onChange={(e) => set("hasta", e.target.value)} className="sm:w-40" aria-label="Hasta" />
      </div>
    </div>
  );
}
