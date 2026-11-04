"use client";
import { useActionState, useEffect } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/primitives";
import { updateOrg } from "./actions";

export function OrgForm({ org, editable }: { org: { name: string; legal_name: string | null; cuit: string | null }; editable: boolean }) {
  const [state, action, pending] = useActionState(updateOrg, null);
  useEffect(() => {
    if (state?.ok) toast.success("Datos guardados");
    if (state?.error) toast.error(state.error);
  }, [state]);
  return (
    <form action={action} className="flex flex-col gap-4">
      <Field label="Nombre comercial"><Input name="name" defaultValue={org.name} required disabled={!editable} /></Field>
      <Field label="Razón social"><Input name="legal_name" defaultValue={org.legal_name ?? ""} disabled={!editable} /></Field>
      <Field label="CUIT"><Input name="cuit" defaultValue={org.cuit ?? ""} disabled={!editable} /></Field>
      {editable && <Button type="submit" loading={pending} className="self-start">Guardar</Button>}
    </form>
  );
}
