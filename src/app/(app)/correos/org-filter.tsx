"use client";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

export function OrgFilter({ options, value }: { options: { code: string; name: string }[]; value: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  return (
    <select value={value} aria-label="Organismo"
      onChange={(e) => {
        const p = new URLSearchParams(params.toString());
        if (e.target.value) p.set("org", e.target.value); else p.delete("org");
        p.delete("id");
        router.push(`${pathname}?${p}`);
      }}
      className="h-9 w-full rounded-full border border-card-border bg-field px-3 text-sm text-fg outline-none focus-visible:ring-2 focus-visible:ring-ring/40">
      <option value="">Todos los organismos</option>
      {options.map((o) => <option key={o.code} value={o.code}>{o.name}</option>)}
    </select>
  );
}
