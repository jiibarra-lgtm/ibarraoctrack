"use server";
import { revalidatePath } from "next/cache";
import { requireOrg, canWrite } from "@/lib/session";
import { sessionProRpc, sessionRpc } from "@/lib/ml-rpc";
import { mlClient, type ApiItem, type Ml } from "@/lib/ml/client";
import { applyVacation, loadSettings, runMlPro, snapshotCompetitor, syncListings } from "@/lib/ml/sync";

type R<T = object> = ({ ok: true } & T) | { ok: false; error: string };
const fail = (e: unknown): { ok: false; error: string } => ({ ok: false, error: (e as Error).message || "Error inesperado" });

async function ctx() {
  const s = await requireOrg();
  if (!canWrite(s.org.role)) throw new Error("No tenés permiso para cambiar Mercado Libre");
  const ml = await mlClient(sessionRpc(s.supabase, s.org.org_id));
  if (!ml) throw new Error("Mercado Libre no está conectado (Configuración → Mercado Libre)");
  return { s, ml, pro: sessionProRpc(s.supabase, s.org.org_id) };
}
const refresh = (...p: string[]) => { for (const x of ["/mercadolibre/panel", ...p]) revalidatePath(x); };
const hist = (pro: Awaited<ReturnType<typeof ctx>>["pro"], item_id: string, field: string, old_value: unknown, new_value: unknown) =>
  pro("upsert", { table: "ml_item_history", rows: [{ item_id, field, old_value: String(old_value ?? ""), new_value: String(new_value ?? ""), source: "app" }] }).catch(() => null);

// ---------------------------------------------------------------------------
// Sincronizar
// ---------------------------------------------------------------------------
export async function mlSyncNow(): Promise<R<{ summary: string }>> {
  try {
    const { ml, pro } = await ctx();
    await syncListings(ml, pro, { force: true });
    const r = await runMlPro(ml, pro);
    refresh("/mercadolibre/publicaciones", "/mercadolibre/preguntas", "/mercadolibre/mercado");
    const p = r.publicaciones as { items?: number } | undefined, q = r.preguntas as { preguntas?: number } | undefined;
    return { ok: true, summary: `${p?.items ?? 0} publicaciones y ${q?.preguntas ?? 0} preguntas al día` };
  } catch (e) { return fail(e); }
}

// ---------------------------------------------------------------------------
// Publicaciones
// ---------------------------------------------------------------------------
type ItemPatch = { price?: number; available_quantity?: number; status?: "active" | "paused" | "closed"; title?: string };

async function patchOne(ml: Ml, pro: Awaited<ReturnType<typeof ctx>>["pro"], id: string, p: ItemPatch) {
  const before = await ml.get<ApiItem>(`/items/${id}`);
  const body: Record<string, unknown> = {};
  if (p.price !== undefined) { if (!(p.price > 0)) throw new Error("Precio inválido"); body.price = Math.round(p.price * 100) / 100; }
  if (p.title !== undefined) { const t = p.title.trim(); if (t.length < 10 || t.length > 60) throw new Error("El título tiene que tener entre 10 y 60 caracteres"); body.title = t; }
  if (p.status) body.status = p.status;
  if (p.available_quantity !== undefined) {
    if (!Number.isInteger(p.available_quantity) || p.available_quantity < 0) throw new Error("Stock inválido");
    if (before.ok && before.data.variations?.length) body.variations = before.data.variations.map((v) => ({ id: v.id, available_quantity: p.available_quantity }));
    else body.available_quantity = p.available_quantity;
  }
  const r = await ml.put<ApiItem>(`/items/${id}`, body);
  if (!r.ok) throw new Error(`${id}: ${r.error}`);
  for (const k of ["price", "title", "status", "available_quantity"] as const)
    if (p[k] !== undefined && before.ok) await hist(pro, id, k === "available_quantity" ? "stock" : k, before.data[k], p[k]);
  await pro("patch", { table: "ml_items", rows: [{ item_id: id, title: r.data.title, price: r.data.price, available: r.data.available_quantity, status: r.data.status }] }).catch(() => null);
}

export async function mlUpdateItem(id: string, p: ItemPatch): Promise<R> {
  try {
    const { ml, pro } = await ctx();
    await patchOne(ml, pro, id, p);
    refresh("/mercadolibre/publicaciones", `/mercadolibre/publicaciones/${id}`);
    return { ok: true };
  } catch (e) { return fail(e); }
}

/** Edición masiva: mismo cambio a muchas publicaciones (precio fijo, % de aumento/baja, stock, pausar/activar). */
export async function mlBulkUpdate(ids: string[], op: { kind: "price_pct" | "price" | "stock" | "status"; value: number | string }): Promise<R<{ done: number; errors: string[] }>> {
  try {
    const { ml, pro } = await ctx();
    if (!ids.length || ids.length > 200) return { ok: false, error: "Elegí entre 1 y 200 publicaciones" };
    const items = await Promise.all(ids.map((id) => ml.get<ApiItem>(`/items/${id}`)));
    let done = 0;
    const errors: string[] = [];
    for (const [i, id] of ids.entries()) {
      try {
        const it = items[i].ok ? items[i].data : null;
        if (op.kind === "price_pct") { if (!it) throw new Error("no se pudo leer"); await patchOne(ml, pro, id, { price: Math.round(it.price * (1 + Number(op.value) / 100)) }); }
        else if (op.kind === "price") await patchOne(ml, pro, id, { price: Number(op.value) });
        else if (op.kind === "stock") await patchOne(ml, pro, id, { available_quantity: Number(op.value) });
        else await patchOne(ml, pro, id, { status: String(op.value) as "active" | "paused" });
        done++;
      } catch (e) { errors.push((e as Error).message); }
    }
    refresh("/mercadolibre/publicaciones");
    return { ok: true, done, errors: errors.slice(0, 10) };
  } catch (e) { return fail(e); }
}

/** Costo propio por unidad (para el neto). */
export async function mlSetCost(id: string, cost: number | null): Promise<R> {
  try {
    const { pro } = await ctx();
    if (cost !== null && !(cost >= 0)) return { ok: false, error: "Costo inválido" };
    await pro("patch", { table: "ml_items", rows: [{ item_id: id, cost_unit: cost }] });
    refresh("/mercadolibre/publicaciones", "/mercadolibre/precios");
    return { ok: true };
  } catch (e) { return fail(e); }
}

/** Datos de una publicación para duplicarla o hacer un pack. */
export async function mlItemForCopy(id: string): Promise<R<{ item: Record<string, unknown> }>> {
  try {
    const { ml } = await ctx();
    const [it, d] = await Promise.all([ml.get<ApiItem>(`/items/${id}`), ml.get<{ plain_text: string }>(`/items/${id}/description`)]);
    if (!it.ok) return { ok: false, error: it.error ?? "No se pudo leer" };
    const x = it.data;
    return { ok: true, item: {
      title: x.title, category_id: x.category_id, price: x.price, currency_id: x.currency_id, available_quantity: x.available_quantity || 1, buying_mode: "buy_it_now",
      listing_type_id: x.listing_type_id, condition: x.condition, pictures: (x.pictures ?? []).map((p) => ({ id: p.id, url: p.secure_url })),
      attributes: (x.attributes ?? []).filter((a) => a.value_name || a.value_id).map((a) => ({ id: a.id, name: a.name, value_name: a.value_name, value_id: a.value_id })),
      sale_terms: (x.sale_terms ?? []).filter((t) => t.value_name).map((t) => ({ id: t.id, value_name: t.value_name })), description: d.ok ? d.data.plain_text : "",
      free_shipping: !!x.shipping?.free_shipping,
    } };
  } catch (e) { return fail(e); }
}

// ---------------------------------------------------------------------------
// Publicador
// ---------------------------------------------------------------------------
export async function mlPredictCategory(title: string): Promise<R<{ options: { category_id: string; category_name: string; domain_name: string }[] }>> {
  try {
    const { ml } = await ctx();
    const r = await ml.get<{ category_id: string; category_name: string; domain_name: string }[]>(`/sites/MLA/domain_discovery/search?q=${encodeURIComponent(title)}&limit=5`);
    if (!r.ok) return { ok: false, error: r.error ?? "No se pudo predecir" };
    return { ok: true, options: r.data };
  } catch (e) { return fail(e); }
}

export type CatAttr = { id: string; name: string; required: boolean; value_type: string; values?: { id: string; name: string }[]; hint?: string; allowed_units?: { id: string; name: string }[] };
export async function mlCategoryAttributes(categoryId: string): Promise<R<{ attrs: CatAttr[]; path: string }>> {
  try {
    const { ml } = await ctx();
    const [a, c] = await Promise.all([
      ml.get<{ id: string; name: string; tags?: Record<string, boolean>; value_type: string; values?: { id: string; name: string }[]; hint?: string; allowed_units?: { id: string; name: string }[] }[]>(`/categories/${categoryId}/attributes`),
      ml.get<{ path_from_root: { name: string }[] }>(`/categories/${categoryId}`),
    ]);
    if (!a.ok) return { ok: false, error: a.error ?? "No se pudo leer la categoría" };
    const attrs = a.data.filter((x) => !x.tags?.hidden && !x.tags?.read_only && !x.tags?.fixed)
      .map((x) => ({ id: x.id, name: x.name, required: !!(x.tags?.required || x.tags?.catalog_required), value_type: x.value_type, values: x.values?.slice(0, 200), hint: x.hint, allowed_units: x.allowed_units }))
      .sort((p, q) => Number(q.required) - Number(p.required)).slice(0, 60);
    return { ok: true, attrs, path: c.ok ? c.data.path_from_root.map((p) => p.name).join(" › ") : "" };
  } catch (e) { return fail(e); }
}

export async function mlFeePreview(price: number, categoryId: string, listingType: string): Promise<R<{ fee: number; pct: number }>> {
  try {
    const { ml } = await ctx();
    const r = await ml.get<{ sale_fee_amount: number; sale_fee_details?: { percentage_fee?: number } }>(`/sites/MLA/listing_prices?price=${price}&category_id=${categoryId}&listing_type_id=${listingType}`);
    if (!r.ok) return { ok: false, error: r.error ?? "" };
    return { ok: true, fee: r.data.sale_fee_amount, pct: r.data.sale_fee_details?.percentage_fee ?? 0 };
  } catch (e) { return fail(e); }
}

/** Sube una foto a Mercado Libre y devuelve su id (para usar en la publicación). */
export async function mlUploadPicture(form: FormData): Promise<R<{ id: string; url: string }>> {
  try {
    const { ml } = await ctx();
    const f = form.get("file");
    if (!(f instanceof File) || !f.size) return { ok: false, error: "Elegí una foto" };
    if (f.size > 10_000_000) return { ok: false, error: "La foto pesa más de 10 MB" };
    const fd = new FormData();
    fd.append("file", f, f.name || "foto.jpg");
    const r = await ml.raw(`/pictures/items/upload`, { method: "POST", body: fd });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.id) return { ok: false, error: j.message ?? `No se pudo subir (${r.status})` };
    const url = (j.variations?.[0]?.secure_url as string | undefined) ?? "";
    return { ok: true, id: j.id, url };
  } catch (e) { return fail(e); }
}

export type NewItem = {
  title: string; category_id: string; price: number; available_quantity: number; listing_type_id: string; condition: "new" | "used";
  pictures: string[]; attributes: { id: string; value_name: string }[]; description: string; free_shipping: boolean;
  warranty?: string | null;
};
const toBody = (x: NewItem) => ({
  title: x.title.trim(), category_id: x.category_id, price: x.price, currency_id: "ARS", available_quantity: x.available_quantity, buying_mode: "buy_it_now",
  listing_type_id: x.listing_type_id, condition: x.condition, pictures: x.pictures.map((id) => ({ id })),
  attributes: x.attributes.filter((a) => a.value_name.trim()).map((a) => ({ id: a.id, value_name: a.value_name.trim() })),
  shipping: { mode: "me2", free_shipping: x.free_shipping },
  sale_terms: [{ id: "WARRANTY_TYPE", value_name: "Garantía del vendedor" }, { id: "WARRANTY_TIME", value_name: x.warranty || "30 días" }],
});

/** Valida con Mercado Libre antes de publicar (no crea nada). */
export async function mlValidateItem(x: NewItem): Promise<R<{ messages: string[] }>> {
  try {
    const { ml } = await ctx();
    const r = await ml.post<{ cause?: { message: string; type?: string }[] }>(`/items/validate`, toBody(x));
    if (r.status === 204 || r.ok) return { ok: true, messages: [] };
    const causes = ((r.data as { cause?: { message: string; type?: string }[] } | null)?.cause ?? []).map((c) => `${c.type === "warning" ? "Aviso" : "Error"}: ${c.message}`);
    return { ok: true, messages: causes.length ? causes : [r.error ?? "Mercado Libre rechazó la publicación"] };
  } catch (e) { return fail(e); }
}

export async function mlPublish(x: NewItem): Promise<R<{ id: string; permalink: string }>> {
  try {
    const { ml, pro } = await ctx();
    if (!x.pictures.length) return { ok: false, error: "Subí al menos una foto" };
    const r = await ml.post<{ id: string; permalink: string; cause?: { message: string }[] }>(`/items`, toBody(x));
    if (!r.ok) return { ok: false, error: r.error ?? "Mercado Libre rechazó la publicación" };
    if (x.description.trim()) await ml.post(`/items/${r.data.id}/description`, { plain_text: x.description.trim().slice(0, 50000) });
    await hist(pro, r.data.id, "creada", "", x.title);
    refresh("/mercadolibre/publicaciones");
    return { ok: true, id: r.data.id, permalink: r.data.permalink };
  } catch (e) { return fail(e); }
}

// ---------------------------------------------------------------------------
// Preguntas, respuestas automáticas, bloqueos
// ---------------------------------------------------------------------------
export async function mlAnswer(questionId: string, text: string): Promise<R> {
  try {
    const { ml, pro } = await ctx();
    const t = text.trim();
    if (t.length < 2 || t.length > 2000) return { ok: false, error: "La respuesta tiene que tener entre 2 y 2000 caracteres" };
    const r = await ml.post(`/answers`, { question_id: Number(questionId), text: t });
    if (!r.ok) return { ok: false, error: r.error ?? "No se pudo responder" };
    await pro("patch", { table: "ml_questions", rows: [{ id: questionId, status: "ANSWERED", answer: t, answered_at: new Date().toISOString(), answered_by: "app" }] });
    refresh("/mercadolibre/preguntas");
    return { ok: true };
  } catch (e) { return fail(e); }
}

export async function mlSaveAutoAnswer(a: { id?: string; name: string; keywords: string; answer: string; active: boolean }): Promise<R> {
  try {
    const { s } = await ctx();
    const keywords = a.keywords.split(",").map((k) => k.trim().toLowerCase()).filter(Boolean).slice(0, 20);
    if (!a.name.trim() || !keywords.length || a.answer.trim().length < 5) return { ok: false, error: "Completá nombre, palabras (separadas por coma) y respuesta" };
    const row = { org_id: s.org.org_id, name: a.name.trim().slice(0, 60), keywords, answer: a.answer.trim().slice(0, 2000), active: a.active };
    const { error } = a.id ? await s.supabase.from("ml_auto_answers").update(row).eq("id", a.id).eq("org_id", s.org.org_id) : await s.supabase.from("ml_auto_answers").insert(row);
    if (error) return { ok: false, error: error.message };
    refresh("/mercadolibre/preguntas", "/mercadolibre/automatizaciones");
    return { ok: true };
  } catch (e) { return fail(e); }
}

export async function mlDeleteAutoAnswer(id: string): Promise<R> {
  try {
    const { s } = await ctx();
    await s.supabase.from("ml_auto_answers").delete().eq("id", id).eq("org_id", s.org.org_id);
    refresh("/mercadolibre/preguntas", "/mercadolibre/automatizaciones");
    return { ok: true };
  } catch (e) { return fail(e); }
}

/** Bloquear (o desbloquear) a un comprador para que no te compre ni te pregunte. */
export async function mlBlockBuyer(userId: string, block: boolean, reason?: string): Promise<R> {
  try {
    const { s, ml } = await ctx();
    if (!/^\d+$/.test(userId)) return { ok: false, error: "Usuario inválido" };
    if (block) {
      const a = await ml.post(`/users/${ml.userId}/order_blacklist`, { user_id: Number(userId) });
      const b = await ml.post(`/users/${ml.userId}/questions_blacklist`, { user_id: Number(userId) });
      if (!a.ok && !b.ok) return { ok: false, error: a.error ?? b.error ?? "No se pudo bloquear" };
      const u = await ml.get<{ nickname: string }>(`/users/${userId}`);
      await s.supabase.from("ml_blocked_buyers").upsert({ org_id: s.org.org_id, user_id: userId, nickname: u.ok ? u.data.nickname : null, reason: reason?.slice(0, 200) ?? null });
    } else {
      await ml.del(`/users/${ml.userId}/order_blacklist/${userId}`);
      await ml.del(`/users/${ml.userId}/questions_blacklist/${userId}`);
      await s.supabase.from("ml_blocked_buyers").delete().eq("org_id", s.org.org_id).eq("user_id", userId);
    }
    refresh("/mercadolibre/automatizaciones", "/mercadolibre/preguntas");
    return { ok: true };
  } catch (e) { return fail(e); }
}

/** Mensaje postventa al comprador (dentro de lo que permite ML). */
export async function mlSendMessage(packId: string, buyerId: string, text: string): Promise<R> {
  try {
    const { ml } = await ctx();
    const t = text.trim();
    if (t.length < 2 || t.length > 350) return { ok: false, error: "El mensaje tiene que tener entre 2 y 350 caracteres" };
    const r = await ml.post(`/messages/packs/${packId}/sellers/${ml.userId}?tag=post_sale`, { from: { user_id: String(ml.userId) }, to: { user_id: buyerId }, text: t });
    if (!r.ok) return { ok: false, error: r.error ?? "Mercado Libre no permitió el mensaje" };
    return { ok: true };
  } catch (e) { return fail(e); }
}

// ---------------------------------------------------------------------------
// Ventas: factura
// ---------------------------------------------------------------------------
export async function mlUploadInvoice(form: FormData): Promise<R> {
  try {
    const { ml } = await ctx();
    const pack = String(form.get("pack") ?? "");
    const f = form.get("file");
    if (!/^\d+$/.test(pack) || !(f instanceof File) || !f.size) return { ok: false, error: "Elegí el PDF de la factura" };
    if (f.size > 1_000_000) return { ok: false, error: "El PDF tiene que pesar menos de 1 MB" };
    const fd = new FormData();
    fd.append("fiscal_document", f, f.name || "factura.pdf");
    const r = await ml.raw(`/packs/${pack}/fiscal_documents`, { method: "POST", body: fd });
    if (!r.ok) { const j = await r.json().catch(() => ({})); return { ok: false, error: j.message ?? `No se pudo subir (${r.status})` }; }
    refresh("/mercadolibre/ventas");
    return { ok: true };
  } catch (e) { return fail(e); }
}

// ---------------------------------------------------------------------------
// Precios: reglas de repricing, promociones
// ---------------------------------------------------------------------------
export async function mlSavePriceRule(r: { item_id: string; strategy: "win_catalog" | "match_lowest" | "cost_plus"; min_price: number; max_price: number | null; margin_pct: number | null; step: number; active: boolean }): Promise<R> {
  try {
    const { s } = await ctx();
    if (!(r.min_price > 0)) return { ok: false, error: "Poné un precio mínimo (piso)" };
    if (r.max_price && r.max_price < r.min_price) return { ok: false, error: "El máximo no puede ser menor que el mínimo" };
    if (r.strategy === "cost_plus" && (r.margin_pct === null || r.margin_pct < 0)) return { ok: false, error: "Poné el margen que querés" };
    const { error } = await s.supabase.from("ml_price_rules").upsert({ org_id: s.org.org_id, ...r, step: r.step || 1 });
    if (error) return { ok: false, error: error.message };
    refresh("/mercadolibre/precios");
    return { ok: true };
  } catch (e) { return fail(e); }
}

export async function mlDeletePriceRule(itemId: string): Promise<R> {
  try {
    const { s } = await ctx();
    await s.supabase.from("ml_price_rules").delete().eq("org_id", s.org.org_id).eq("item_id", itemId);
    refresh("/mercadolibre/precios");
    return { ok: true };
  } catch (e) { return fail(e); }
}

export async function mlJoinPromotion(itemId: string, promo: { id: string; type: string }, dealPrice: number | null): Promise<R> {
  try {
    const { ml } = await ctx();
    const body: Record<string, unknown> = { promotion_id: promo.id, promotion_type: promo.type };
    if (dealPrice) body.deal_price = dealPrice;
    const r = await ml.post(`/seller-promotions/items/${itemId}?app_version=v2`, body);
    if (!r.ok) return { ok: false, error: r.error ?? "Mercado Libre no aceptó la promoción" };
    refresh("/mercadolibre/precios");
    return { ok: true };
  } catch (e) { return fail(e); }
}

export async function mlLeavePromotion(itemId: string, promo: { id: string; type: string }): Promise<R> {
  try {
    const { ml } = await ctx();
    const r = await ml.del(`/seller-promotions/items/${itemId}?promotion_type=${promo.type}&promotion_id=${promo.id}&app_version=v2`);
    if (!r.ok) return { ok: false, error: r.error ?? "No se pudo salir de la promoción" };
    refresh("/mercadolibre/precios");
    return { ok: true };
  } catch (e) { return fail(e); }
}

// ---------------------------------------------------------------------------
// Competencia
// ---------------------------------------------------------------------------
/** Seguir una publicación, un producto de catálogo o un vendedor (pegando el link o el código). */
export async function mlAddCompetitor(input: string, myItemId: string | null, followSeller = false): Promise<R> {
  try {
    const { s, ml } = await ctx();
    const t = input.trim();
    let kind: "item" | "seller" = "item", ref = "";
    const item = t.match(/MLA-?(\d{6,})/i), prod = t.match(/\/p\/(MLA\d+)/i);
    if (prod) ref = prod[1].toUpperCase();
    else if (item) ref = `MLA${item[1]}`;
    else if (/^\d+$/.test(t)) { kind = "seller"; ref = t; }
    if (!ref) return { ok: false, error: "Pegá el link de una publicación, de un producto de catálogo o el número de vendedor" };
    // "seguir al vendedor": se toma el vendedor de la publicación pegada
    if (followSeller && kind === "item") {
      const it = await ml.get<{ seller_id: number }>(`/items/${ref}`);
      if (!it.ok) return { ok: false, error: "No pude leer esa publicación" };
      kind = "seller"; ref = String(it.data.seller_id);
    }
    const snap = await snapshotCompetitor(ml, kind, ref);
    if (!snap) return { ok: false, error: "No pude leer eso en Mercado Libre" };
    const { error } = await s.supabase.from("ml_competitors").upsert({ org_id: s.org.org_id, kind, ref, label: snap.label, my_item_id: myItemId || null, last: snap.last, checked_at: new Date().toISOString() }, { onConflict: "org_id,kind,ref" });
    if (error) return { ok: false, error: error.message };
    refresh("/mercadolibre/mercado");
    return { ok: true };
  } catch (e) { return fail(e); }
}

export async function mlRemoveCompetitor(id: string): Promise<R> {
  try {
    const { s } = await ctx();
    await s.supabase.from("ml_competitors").delete().eq("org_id", s.org.org_id).eq("id", id);
    refresh("/mercadolibre/mercado");
    return { ok: true };
  } catch (e) { return fail(e); }
}

// ---------------------------------------------------------------------------
// Pruebas A/B
// ---------------------------------------------------------------------------
export async function mlStartAbTest(t: { item_id: string; field: "title" | "price"; variant_b: string; days_each: number; rounds: number }): Promise<R> {
  try {
    const { s, ml } = await ctx();
    const it = await ml.get<ApiItem>(`/items/${t.item_id}`);
    if (!it.ok) return { ok: false, error: it.error ?? "No pude leer la publicación" };
    const a = t.field === "title" ? it.data.title : String(it.data.price);
    if (t.field === "price" && !(Number(t.variant_b) > 0)) return { ok: false, error: "Precio B inválido" };
    if (t.field === "title" && (t.variant_b.trim().length < 10 || t.variant_b.trim().length > 60)) return { ok: false, error: "El título B tiene que tener entre 10 y 60 caracteres" };
    const days = Math.min(14, Math.max(2, t.days_each || 3)), rounds = Math.min(6, Math.max(2, t.rounds || 4));
    const p = await ml.put(`/items/${t.item_id}`, t.field === "price" ? { price: Number(t.variant_b) } : { title: t.variant_b.trim() });
    if (!p.ok) return { ok: false, error: p.error ?? "Mercado Libre no aceptó la variante B" };
    const { error } = await s.supabase.from("ml_ab_tests").insert({ org_id: s.org.org_id, item_id: t.item_id, field: t.field, variant_a: a, variant_b: t.variant_b.trim(), days_each: days, current: "b",
      ends_at: new Date(Date.now() + days * rounds * 864e5).toISOString() });
    if (error) return { ok: false, error: error.message };
    refresh(`/mercadolibre/publicaciones/${t.item_id}`, "/mercadolibre/precios");
    return { ok: true };
  } catch (e) { return fail(e); }
}

export async function mlStopAbTest(id: string, keep: "a" | "b"): Promise<R> {
  try {
    const { s, ml } = await ctx();
    const { data: t } = await s.supabase.from("ml_ab_tests").select("*").eq("id", id).eq("org_id", s.org.org_id).maybeSingle();
    if (!t) return { ok: false, error: "Prueba inexistente" };
    const value = keep === "a" ? t.variant_a : t.variant_b;
    await ml.put(`/items/${t.item_id}`, t.field === "price" ? { price: Number(value) } : { title: value });
    await s.supabase.from("ml_ab_tests").update({ status: "stopped" }).eq("id", id);
    refresh(`/mercadolibre/publicaciones/${t.item_id}`, "/mercadolibre/precios");
    return { ok: true };
  } catch (e) { return fail(e); }
}

// ---------------------------------------------------------------------------
// Automatizaciones y ajustes
// ---------------------------------------------------------------------------
export async function mlSaveSettings(p: Partial<{ auto_answers: boolean; push_sales: boolean; push_questions: boolean; push_claims: boolean; repricing: boolean;
  hours_from: number; hours_to: number; work_days: number[]; off_hours_answer: string; desc_template: string; goal_sales: number | null; goal_units: number | null; goal_profit: number | null }>): Promise<R> {
  try {
    const { s } = await ctx();
    if (p.hours_from !== undefined && (p.hours_from < 0 || p.hours_from > 23)) return { ok: false, error: "Hora inválida" };
    if (p.hours_to !== undefined && (p.hours_to < 1 || p.hours_to > 24)) return { ok: false, error: "Hora inválida" };
    const { error } = await s.supabase.from("ml_settings").upsert({ org_id: s.org.org_id, ...p, updated_at: new Date().toISOString() });
    if (error) return { ok: false, error: error.message };
    refresh("/mercadolibre/automatizaciones", "/mercadolibre/preguntas");
    return { ok: true };
  } catch (e) { return fail(e); }
}

export async function mlVacation(on: boolean): Promise<R<{ n: number }>> {
  try {
    const { ml, pro } = await ctx();
    const settings = await loadSettings(pro);
    if (on && settings?.vacation) return { ok: false, error: "Ya está en modo vacaciones" };
    const r = await applyVacation(ml, pro, on, settings);
    refresh("/mercadolibre/automatizaciones", "/mercadolibre/publicaciones");
    return { ok: true, n: Number((r as { pausadas?: number; reactivadas?: number }).pausadas ?? (r as { reactivadas?: number }).reactivadas ?? 0) };
  } catch (e) { return fail(e); }
}

export async function mlMarkEventsSeen(): Promise<R> {
  try {
    const { s } = await ctx();
    await s.supabase.from("ml_events").update({ seen: true }).eq("org_id", s.org.org_id).eq("seen", false);
    refresh();
    return { ok: true };
  } catch (e) { return fail(e); }
}
