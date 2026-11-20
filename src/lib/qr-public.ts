import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { QrMenuKey, QrTarget } from "@/lib/qr";
import type { RemitoIssuer } from "@/lib/remitos";

/** Cliente sin sesión: solo puede usar las funciones públicas del QR. */
export const anonDb = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

export type QrPublic = {
  code: string; label: string | null; mode: "single" | "menu"; target: QrTarget; menu: QrMenuKey[]; custom_url: string | null;
  color: string; logo: boolean; caption: string | null; whatsapp: string | null;
  remito: null | {
    label: string | null; provisional: boolean; issued_at: string; status: string;
    recipient: { name: string; address: string | null; iva: string | null; cuit: string | null };
    notes: string | null; issuer: RemitoIssuer; po_number: string | null; signed_document_id: string | null;
    items: { description: string; quantity: number | string; detail: string | null; unit_price: number | string | null }[];
  };
  po: null | { number: string; customer: string | null; issue_date: string | null; delivery_place: string | null; status: string };
  invoices: { id: string; invoice_type: string; point_of_sale: string | null; number: string | null; issue_date: string; total: number | string; currency: string; cae: string | null; document_id: string | null }[];
};

export async function loadQrPublic(code: string) {
  if (!/^[A-Za-z0-9]{6,12}$/.test(code)) return null;
  const { data } = await anonDb().rpc("qr_public", { p_code: code });
  return (data ?? null) as QrPublic | null;
}

export const waUrl = (phone: string | null, text: string) => {
  const n = (phone ?? "").replace(/\D/g, "");
  return n.length >= 8 ? `https://wa.me/${n}?text=${encodeURIComponent(text)}` : null;
};
