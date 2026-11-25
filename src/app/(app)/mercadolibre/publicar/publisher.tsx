"use client";
import * as React from "react";
import { toast } from "sonner";
import { ImagePlus, Sparkles, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge, Card, CardBody, CardHeader, Field, Input, NativeSelect } from "@/components/ui/primitives";
import { formatMoney } from "@/lib/format";
import { parseArNumber } from "@/lib/money";
import { buildTitle, netPerUnit, priceForMargin } from "@/lib/ml/logic";
import { mlCategoryAttributes, mlFeePreview, mlPredictCategory, mlPublish, mlUploadPicture, mlValidateItem, type CatAttr, type NewItem } from "../pro-actions";

type Copy = { title: string; category_id: string; price: number; available_quantity: number; listing_type_id: string; condition: "new" | "used";
  pictures: { id: string; url: string }[]; attributes: { id: string; name: string; value_name: string | null }[]; description: string; free_shipping: boolean } | null;

const num = (s: string) => { const n = Number(parseArNumber(s) ?? NaN); return Number.isFinite(n) ? n : 0; };

export function Publisher({ copy, template, studio }: { copy: Copy; template: string | null; studio: { id: string; url: string }[] }) {
  const [title, setTitle] = React.useState(copy ? `${copy.title}`.slice(0, 60) : "");
  const [cats, setCats] = React.useState<{ category_id: string; category_name: string; domain_name: string }[]>([]);
  const [cat, setCat] = React.useState(copy?.category_id ?? "");
  const [path, setPath] = React.useState("");
  const [attrs, setAttrs] = React.useState<CatAttr[]>([]);
  const [vals, setVals] = React.useState<Record<string, string>>(() => Object.fromEntries((copy?.attributes ?? []).map((a) => [a.id, a.value_name ?? ""])));
  const [pics, setPics] = React.useState<{ id: string; url: string }[]>([...(copy?.pictures ?? []), ...studio]);
  const [price, setPrice] = React.useState(copy ? String(copy.price) : "");
  const [qty, setQty] = React.useState(copy ? String(copy.available_quantity) : "1");
  const [type, setType] = React.useState(copy?.listing_type_id ?? "gold_special");
  const [cond, setCond] = React.useState<"new" | "used">(copy?.condition ?? "new");
  const [free, setFree] = React.useState(copy?.free_shipping ?? true);
  const [warranty, setWarranty] = React.useState("30 días");
  const [desc, setDesc] = React.useState(copy?.description ?? "");
  const [cost, setCost] = React.useState("");
  const [pack, setPack] = React.useState(1);
  const [fee, setFee] = React.useState<{ fee: number; pct: number } | null>(null);
  const [issues, setIssues] = React.useState<string[] | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [done, setDone] = React.useState<{ id: string; permalink: string } | null>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (!cat) return;
    mlCategoryAttributes(cat).then((r) => { if (r.ok) { setAttrs(r.attrs); setPath(r.path); } else toast.error(r.error); });
  }, [cat]);
  const p = num(price);
  React.useEffect(() => {
    if (!cat || !p) return;
    const t = setTimeout(() => mlFeePreview(p, cat, type).then((r) => setFee(r.ok ? { fee: r.fee, pct: r.pct } : null)), 400);
    return () => clearTimeout(t);
  }, [cat, p, type]);

  const c = cost ? num(cost) * pack : null;
  const feeNow = cat && p ? fee : null;
  const net = p ? netPerUnit({ price: p, fee: feeNow?.fee ?? null, ship: null, cost: c }) : null;
  const feePct = feeNow?.pct || 14;
  const finalTitle = pack > 1 && !/pack/i.test(title) ? buildTitle(`Pack x${pack}`, [title]) : title;

  const item = (): NewItem => ({
    title: finalTitle, category_id: cat, price: p, available_quantity: Math.max(1, Math.floor(num(qty))), listing_type_id: type, condition: cond,
    pictures: pics.map((x) => x.id), attributes: Object.entries(vals).map(([id, value_name]) => ({ id, value_name })), description: desc.replaceAll("{titulo}", finalTitle),
    free_shipping: free, warranty,
  });

  const missingReq = attrs.filter((a) => a.required && !vals[a.id]?.trim());
  const upload = async (files: FileList | null) => {
    if (!files) return;
    setBusy("pic");
    for (const f of [...files].slice(0, 12 - pics.length)) {
      const fd = new FormData(); fd.append("file", f);
      const r = await mlUploadPicture(fd);
      if (r.ok) setPics((x) => [...x, { id: r.id, url: r.url || URL.createObjectURL(f) }]); else toast.error(r.error);
    }
    setBusy(null);
  };

  if (done) return (
    <Card><CardBody className="space-y-3 text-center">
      <p className="text-lg font-semibold">¡Publicada! {done.id}</p>
      <div className="flex justify-center gap-2">
        <Button asChild variant="secondary"><a href={done.permalink} target="_blank" rel="noreferrer">Ver en Mercado Libre</a></Button>
        <Button asChild><a href={`/mercadolibre/publicaciones/${done.id}`}>Abrir en la app</a></Button>
      </div>
    </CardBody></Card>
  );

  return (
    <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
      <div className="space-y-5">
        <Card>
          <CardHeader title="1. Título y categoría" />
          <CardBody className="space-y-3">
            <Field label={`Título (${finalTitle.length}/60)`} htmlFor="t">
              <div className="flex gap-2">
                <Input id="t" value={title} maxLength={60} onChange={(e) => setTitle(e.target.value)} placeholder="Producto + marca + modelo + medida/característica" />
                <Button variant="secondary" loading={busy === "cat"} disabled={title.trim().length < 5} onClick={async () => {
                  setBusy("cat"); const r = await mlPredictCategory(title); setBusy(null);
                  if (!r.ok) return toast.error(r.error);
                  setCats(r.options); if (r.options[0] && !cat) setCat(r.options[0].category_id);
                }}><Sparkles /> Categoría</Button>
              </div>
            </Field>
            {cats.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {cats.map((x) => <button key={x.category_id} type="button" onClick={() => setCat(x.category_id)} className={`rounded-full border px-3 py-1 text-xs ${cat === x.category_id ? "border-brand bg-brand text-brand-fg" : "border-border bg-field"}`}>{x.domain_name} · {x.category_name}</button>)}
              </div>
            )}
            {cat && <p className="text-xs text-fg-subtle">Categoría {cat}{path ? `: ${path}` : ""}</p>}
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Condición" htmlFor="c"><NativeSelect id="c" value={cond} onChange={(e) => setCond(e.target.value as "new")}><option value="new">Nuevo</option><option value="used">Usado</option></NativeSelect></Field>
              <Field label="Vender en pack de" htmlFor="pk"><NativeSelect id="pk" value={pack} onChange={(e) => setPack(Number(e.target.value))}>{[1, 2, 3, 4, 5, 6, 10, 12, 20, 24, 50, 100].map((n) => <option key={n} value={n}>{n === 1 ? "Unidad" : `${n} unidades`}</option>)}</NativeSelect></Field>
              <Field label="Garantía" htmlFor="w"><Input id="w" value={warranty} onChange={(e) => setWarranty(e.target.value)} /></Field>
            </div>
          </CardBody>
        </Card>

        {attrs.length > 0 && (
          <Card>
            <CardHeader title="2. Ficha técnica" description={missingReq.length ? `Faltan ${missingReq.length} obligatorios` : "Completá todo lo que puedas: los filtros de búsqueda usan estos datos."} />
            <CardBody className="grid gap-3 sm:grid-cols-2">
              {attrs.map((a) => (
                <Field key={a.id} label={`${a.name}${a.required ? " *" : ""}`} htmlFor={`a-${a.id}`}>
                  {a.values?.length && a.value_type === "list" ? (
                    <NativeSelect id={`a-${a.id}`} value={vals[a.id] ?? ""} onChange={(e) => setVals({ ...vals, [a.id]: e.target.value })}>
                      <option value="">—</option>{a.values.map((v) => <option key={v.id} value={v.name}>{v.name}</option>)}
                    </NativeSelect>
                  ) : (
                    <>
                      <Input id={`a-${a.id}`} list={a.values?.length ? `l-${a.id}` : undefined} value={vals[a.id] ?? ""} onChange={(e) => setVals({ ...vals, [a.id]: e.target.value })}
                        placeholder={a.allowed_units?.length ? `ej. 10 ${a.allowed_units[0].name}` : a.hint ?? ""} />
                      {a.values?.length ? <datalist id={`l-${a.id}`}>{a.values.map((v) => <option key={v.id} value={v.name} />)}</datalist> : null}
                    </>
                  )}
                </Field>
              ))}
            </CardBody>
          </Card>
        )}

        <Card>
          <CardHeader title="3. Fotos" description="La primera con fondo blanco. Hasta 12. Podés traer fotos del Estudio de fotos." />
          <CardBody>
            <div className="flex flex-wrap gap-2">
              {pics.map((x, i) => (
                <div key={x.id} className="relative">
                  <img src={x.url} alt="" className="size-24 rounded-lg border border-border bg-white object-contain" />
                  {i === 0 && <Badge tone="accent" className="absolute bottom-1 left-1">Portada</Badge>}
                  <button type="button" aria-label="Quitar" onClick={() => setPics(pics.filter((y) => y.id !== x.id))} className="absolute -right-1.5 -top-1.5 grid size-6 place-items-center rounded-full bg-danger text-white"><X className="size-3.5" /></button>
                  {i > 0 && <button type="button" onClick={() => setPics([x, ...pics.filter((y) => y.id !== x.id)])} className="absolute right-1 bottom-1 rounded bg-black/60 px-1 text-[10px] text-white">portada</button>}
                </div>
              ))}
              {pics.length < 12 && (
                <button type="button" onClick={() => fileRef.current?.click()} className="grid size-24 place-items-center rounded-lg border border-dashed border-border text-fg-muted hover:border-brand">
                  {busy === "pic" ? "Subiendo…" : <ImagePlus />}
                </button>
              )}
              <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" multiple hidden onChange={(e) => { upload(e.target.files); e.target.value = ""; }} />
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="4. Descripción" action={template ? <Button size="sm" variant="ghost" onClick={() => setDesc(template)}>Usar mi plantilla</Button> : null} />
          <CardBody>
            <textarea value={desc} onChange={(e) => setDesc(e.target.value)} rows={10} className="w-full rounded-lg border border-card-border bg-field px-3 py-2 text-sm" placeholder="Qué es, para qué sirve, medidas, qué incluye, garantía, factura A/B…" />
            <p className="mt-1 text-xs text-fg-subtle">Solo texto (ML no acepta HTML ni links ni teléfonos). {"{titulo}"} se reemplaza por el título.</p>
          </CardBody>
        </Card>
      </div>

      <div className="space-y-5 lg:sticky lg:top-4 lg:self-start">
        <Card>
          <CardHeader title="5. Precio y stock" />
          <CardBody className="space-y-3 text-sm">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Precio final" htmlFor="p"><Input id="p" value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" className="tabular" /></Field>
              <Field label="Stock" htmlFor="q"><Input id="q" value={qty} onChange={(e) => setQty(e.target.value.replace(/\D/g, ""))} inputMode="numeric" /></Field>
              <Field label="Tipo" htmlFor="lt"><NativeSelect id="lt" value={type} onChange={(e) => setType(e.target.value)}><option value="gold_special">Clásica</option><option value="gold_pro">Premium (cuotas sin interés)</option></NativeSelect></Field>
              <Field label={`Costo por unidad${pack > 1 ? ` (x${pack})` : ""}`} htmlFor="co"><Input id="co" value={cost} onChange={(e) => setCost(e.target.value)} placeholder="sin IVA" className="tabular" /></Field>
            </div>
            <label className="flex items-center gap-2"><input type="checkbox" checked={free} onChange={(e) => setFree(e.target.checked)} /> Envío gratis</label>
            {net && (
              <div className="space-y-1 rounded-lg bg-field px-3 py-2">
                <div className="flex justify-between"><span>Comisión {feeNow ? `(${feeNow.pct} %)` : "(aprox.)"}</span><span className="tabular">− {formatMoney(net.fee)}</span></div>
                <div className="flex justify-between font-semibold"><span>Te queda {c !== null ? "" : "antes del costo"}</span><span className="tabular">{formatMoney(net.net ?? net.beforeCost)}</span></div>
                {net.margin !== null && <div className="flex justify-between text-xs"><span>Margen</span><span>{net.margin} %</span></div>}
                {free && <p className="text-xs text-fg-subtle">El envío gratis se descuenta aparte al vender (depende del peso).</p>}
              </div>
            )}
            {c !== null && (
              <div className="flex flex-wrap gap-1.5 text-xs">
                {[15, 25, 35, 50].map((m) => { const v = priceForMargin(c, m, feePct); return v ? <button key={m} type="button" onClick={() => setPrice(String(Math.ceil(v)))} className="rounded-full border border-border px-2 py-1 hover:border-brand">{m} % → {formatMoney(Math.ceil(v))}</button> : null; })}
              </div>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardBody className="space-y-3">
            {issues && (issues.length === 0 ? <p className="text-sm text-accent">Mercado Libre la acepta. Lista para publicar.</p> : <ul className="space-y-1 text-sm text-danger">{issues.map((m) => <li key={m}>• {m}</li>)}</ul>)}
            <div className="flex gap-2">
              <Button variant="secondary" className="flex-1" loading={busy === "val"} disabled={!cat || !p || !finalTitle} onClick={async () => {
                setBusy("val"); const r = await mlValidateItem(item()); setBusy(null);
                if (!r.ok) return toast.error(r.error); setIssues(r.messages);
              }}>Revisar</Button>
              <Button className="flex-1" loading={busy === "pub"} disabled={!cat || !p || !finalTitle || !pics.length || missingReq.length > 0} onClick={async () => {
                setBusy("pub"); const r = await mlPublish(item()); setBusy(null);
                if (!r.ok) return toast.error(r.error, { duration: 12000 }); setDone(r);
              }}>Publicar</Button>
            </div>
            {missingReq.length > 0 && <p className="text-xs text-warn">Faltan: {missingReq.map((a) => a.name).join(", ")}</p>}
            {pics.length === 0 && <p className="text-xs text-warn">Falta al menos una foto.</p>}
            <Button variant="ghost" size="sm" onClick={() => { setPics([]); setVals({}); setDesc(""); setIssues(null); }}><Trash2 /> Limpiar</Button>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
