"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { ORG_COOKIE } from "@/lib/session";

const schema = z.object({
  name: z.string().trim().min(2, "Ingresá un nombre").max(120),
  legal_name: z.string().trim().max(200).optional(),
  cuit: z.string().trim().regex(/^(\d{2}-?\d{8}-?\d)?$/, "CUIT inválido (ej. 20-12345678-9)").optional(),
});

export type OnboardingState = { error?: string } | null;

export async function createOrganization(_: OnboardingState, form: FormData): Promise<OnboardingState> {
  const parsed = schema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_organization", {
    p_name: parsed.data.name, p_legal_name: parsed.data.legal_name ?? null, p_cuit: parsed.data.cuit || null,
  });
  if (error) return { error: error.message };
  (await cookies()).set(ORG_COOKIE, data as string, { httpOnly: true, sameSite: "lax", secure: true, path: "/", maxAge: 31536000 });
  redirect("/dashboard");
}
