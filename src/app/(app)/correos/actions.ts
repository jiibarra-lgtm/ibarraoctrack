"use server";
import { revalidatePath } from "next/cache";
import { requireOrg } from "@/lib/session";
import { isUuid } from "@/lib/utils";

export async function markMailRead(id: string) {
  const s = await requireOrg();
  if (!isUuid(id)) return;
  await s.supabase.from("mail_messages").update({ is_read: true }).eq("id", id).eq("org_id", s.org.org_id).eq("is_read", false);
  revalidatePath("/correos");
}
