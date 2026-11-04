const fmt = (b: number) => (b >= 1024 ** 3 ? `${(b / 1024 ** 3).toFixed(2)} GB` : b >= 1024 ** 2 ? `${(b / 1024 ** 2).toFixed(1)} MB` : `${Math.ceil(b / 1024)} KB`);

function Bar({ label, used, total, sub }: { label: string; used: number; total: number; sub: string }) {
  const pct = Math.min(100, (used / total) * 100);
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 text-sm"><span>{label}</span><span className="tabular text-fg-muted">{fmt(used)} de {fmt(total)}</span></div>
      <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-surface-2"><div className={`h-full rounded-full ${pct > 80 ? "bg-danger" : pct > 60 ? "bg-warn" : "bg-brand"}`} style={{ width: `${Math.max(1.5, pct)}%` }} /></div>
      <p className="mt-1 text-xs text-fg-subtle">{pct.toFixed(1)}% usado · {sub}</p>
    </div>
  );
}

export function StorageUsage({ u }: { u: { db_bytes: number; files_bytes: number; files: number; mails: number; mails_bytes: number } | null }) {
  if (!u) return <p className="text-sm text-fg-subtle">No se pudo leer el uso.</p>;
  return (
    <div className="flex flex-col gap-4">
      <Bar label="Base de datos" used={u.db_bytes} total={500 * 1024 ** 2} sub={`${u.mails} correos guardados (${fmt(u.mails_bytes)})`} />
      <Bar label="Archivos (PDF y fotos)" used={u.files_bytes} total={1024 ** 3} sub={`${u.files} archivos`} />
      <p className="text-xs text-fg-subtle">Límites del plan gratis de Supabase. Si te acercás al 80% te aviso para pasar al plan Pro (8 GB de base y 100 GB de archivos).</p>
    </div>
  );
}
