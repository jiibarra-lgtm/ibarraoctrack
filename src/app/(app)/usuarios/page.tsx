import type { Metadata } from "next";
import { requireOrg, ROLE_LABEL, type AppRole } from "@/lib/session";
import { Card, CardBody, CardHeader, PageHeader } from "@/components/ui/primitives";
import { formatDate } from "@/lib/format";
import { MemberRow, AddMemberForm } from "./members-client";

export const metadata: Metadata = { title: "Usuarios" };

const PERMS: [AppRole, string][] = [
  ["admin", "Todo, incluidos usuarios y configuración"],
  ["finanzas", "Órdenes, costos, facturación, cobranzas y auditoría"],
  ["compras", "Órdenes, importación, compras y costos"],
  ["logistica", "Consulta de órdenes, entregas y remitos"],
  ["consulta", "Sólo lectura"],
];

export default async function UsersPage() {
  const s = await requireOrg();
  const { data: members } = await s.supabase.from("organization_members").select("id, user_id, role, created_at").eq("org_id", s.org.org_id).order("created_at");
  const ids = (members ?? []).map((m) => m.user_id);
  const { data: profiles } = ids.length ? await s.supabase.from("profiles").select("id, full_name, email").in("id", ids) : { data: [] };
  const byId = Object.fromEntries((profiles ?? []).map((p) => [p.id, p]));
  const isAdmin = s.org.role === "admin";

  return (
    <>
      <PageHeader title="Usuarios y permisos" description={`Acceso a ${s.org.org_name}`} />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Card>
          <CardHeader title={`Miembros (${members?.length ?? 0})`} />
          <ul className="divide-y divide-border">
            {(members ?? []).map((m) => (
              <MemberRow
                key={m.id}
                id={m.id}
                name={byId[m.user_id]?.full_name || byId[m.user_id]?.email || "—"}
                email={byId[m.user_id]?.email ?? ""}
                role={m.role as AppRole}
                since={formatDate(m.created_at)}
                isSelf={m.user_id === s.userId}
                editable={isAdmin}
              />
            ))}
          </ul>
        </Card>
        <div className="flex flex-col gap-5">
          {isAdmin && (
            <Card>
              <CardHeader title="Sumar usuario" description="La cuenta tiene que existir antes (se crea desde Supabase; el registro público está deshabilitado)." />
              <CardBody><AddMemberForm /></CardBody>
            </Card>
          )}
          <Card>
            <CardHeader title="Roles" />
            <CardBody className="flex flex-col gap-3">
              {PERMS.map(([r, d]) => (
                <div key={r}><p className="text-sm font-medium">{ROLE_LABEL[r]}</p><p className="text-xs text-fg-muted">{d}</p></div>
              ))}
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}
