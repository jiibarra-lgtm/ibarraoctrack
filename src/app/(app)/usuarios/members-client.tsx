"use client";
import * as React from "react";
import { useActionState } from "react";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge, Field, Input, NativeSelect } from "@/components/ui/primitives";
import type { AppRole } from "@/lib/session";
import { addMember, removeMember, updateRole } from "./actions";

const LABEL: Record<AppRole, string> = { admin: "Administrador", finanzas: "Finanzas", compras: "Compras", logistica: "Logística", consulta: "Consulta" };

export function MemberRow({ id, name, email, role, since, isSelf, editable }: { id: string; name: string; email: string; role: AppRole; since: string; isSelf: boolean; editable: boolean }) {
  const [pending, start] = React.useTransition();
  return (
    <li className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-5">
      <div className="grid size-8 place-items-center rounded-full bg-surface-2 text-xs font-semibold text-fg-muted">{name.slice(0, 2).toUpperCase()}</div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{name} {isSelf && <Badge className="ml-1">Vos</Badge>}</p>
        <p className="truncate text-xs text-fg-subtle">{email} · desde {since}</p>
      </div>
      {editable ? (
        <>
          <NativeSelect
            className="w-40" defaultValue={role} disabled={pending}
            onChange={(e) => start(async () => { const r = await updateRole(id, e.target.value); if (r.error) toast.error(r.error); else toast.success("Rol actualizado"); })}
          >
            {(Object.keys(LABEL) as AppRole[]).map((r) => <option key={r} value={r}>{LABEL[r]}</option>)}
          </NativeSelect>
          {!isSelf && (
            <Button variant="ghost" size="icon-sm" className="hover:text-danger" disabled={pending} aria-label="Quitar acceso"
              onClick={() => { if (confirm(`¿Quitar el acceso de ${name}?`)) start(async () => { const r = await removeMember(id); if (r.error) toast.error(r.error); }); }}>
              <Trash2 />
            </Button>
          )}
        </>
      ) : <Badge>{LABEL[role]}</Badge>}
    </li>
  );
}

export function AddMemberForm() {
  const [state, action, pending] = useActionState(addMember, null);
  const formRef = React.useRef<HTMLFormElement>(null);
  React.useEffect(() => {
    if (state && "ok" in state && state.ok) { toast.success(state.ok); formRef.current?.reset(); }
  }, [state]);
  return (
    <form ref={formRef} action={action} className="flex flex-col gap-3">
      <Field label="Email"><Input name="email" type="email" required /></Field>
      <Field label="Rol">
        <NativeSelect name="role" defaultValue="consulta">
          {(Object.keys(LABEL) as AppRole[]).map((r) => <option key={r} value={r}>{LABEL[r]}</option>)}
        </NativeSelect>
      </Field>
      {state && "error" in state && state.error && <p className="text-sm text-danger">{state.error}</p>}
      <Button type="submit" loading={pending}>Dar acceso</Button>
    </form>
  );
}
