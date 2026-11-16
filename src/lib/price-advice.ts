/** Qué hacer con el precio y el stock de cada renglón de convenio (todos los precios con IVA, como en el BAC). */
export type AdviceInput = {
  contract_number: string; line_number: number; option_number: number; product_name: string;
  my_current_price: string | number | null; best_other_price: string | number | null; cost: string | number | null;
  my_stock: string | number | null; my_stock_balance: string | number | null;
};
export type Advice = AdviceInput & {
  price: number | null; best: number | null; costVat: number | null;
  status: "te_ganan" | "ganas" | "sin_competencia" | "sin_precio";
  beatBy: number | null; beatPct: number | null;      // cuánto más caro sos que el mejor
  target: number | null;                               // precio sugerido
  move: number | null;                                 // cuánto bajar (negativo) o subir (positivo) para llegar al sugerido
  marginNow: number | null; marginTarget: number | null; // ganancia % sobre el costo
  canLower: boolean | null; minPrice: number | null;   // precio mínimo sin perder (costo + 5 %)
  offered: number | null; left: number | null; sold: number | null; leftPct: number | null;
  stockAction: "pedir_incremento" | "agotado" | "ok" | null; stockAdd: number | null;
  action: string;
};

const n = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));
const r2 = (v: number) => Math.round(v * 100) / 100;
/** Para ganar conviene quedar 1 % abajo del más barato; para subir, quedar 1 % abajo del siguiente. */
export const UNDERCUT = 0.01;
export const MIN_MARGIN = 0.05;

export function advise(l: AdviceInput): Advice {
  const price = n(l.my_current_price), best = n(l.best_other_price), cost = n(l.cost);
  const costVat = cost !== null ? r2(cost * 1.21) : null;
  const minPrice = costVat !== null ? r2(costVat * (1 + MIN_MARGIN)) : null;
  const status: Advice["status"] = price === null ? "sin_precio" : best === null ? "sin_competencia" : best < price ? "te_ganan" : "ganas";
  const undercut = best !== null ? Math.floor(best * (1 - UNDERCUT) * 100) / 100 : null;
  let target: number | null = null;
  if (status === "te_ganan") target = undercut;
  else if (status === "ganas" && undercut !== null && price !== null && undercut > price) target = undercut;
  const move = target !== null && price !== null ? r2(target - price) : null;
  const margin = (p: number | null) => (p !== null && costVat ? ((p - costVat) / costVat) * 100 : null);
  const canLower = status === "te_ganan" && target !== null && minPrice !== null ? target >= minPrice : null;
  const offered = n(l.my_stock), left = n(l.my_stock_balance);
  const sold = offered !== null && left !== null ? Math.max(0, offered - left) : null;
  const leftPct = offered && left !== null ? (left / offered) * 100 : null;
  const stockAction = offered === null || left === null ? null : left <= 0 ? "agotado" : left <= offered * 0.2 || left < 10 ? "pedir_incremento" : "ok";
  const stockAdd = stockAction && stockAction !== "ok" ? Math.max(sold ?? 0, Math.ceil((offered ?? 0) * 0.5), 1) : null;

  let action = "";
  if (status === "te_ganan") action = canLower === false
    ? `Te ganan por ${pct(((price! / best!) - 1) * 100)}. Para ganar tendrías que bajar a ${money(target!)} y no te da: tu mínimo es ${money(minPrice!)}.`
    : `Te ganan por ${pct(((price! / best!) - 1) * 100)}. Bajá ${money(-move!)} a ${money(target!)}${costVat ? ` (ganás ${pct(margin(target)!)})` : " (cargá tu costo para ver si te da)"}.`;
  else if (status === "ganas") action = move && move > 0 ? `Sos el más barato. Podés subir ${money(move)} a ${money(target!)} y seguís ganando.` : "Sos el más barato y estás pegado al siguiente: dejalo así.";
  else if (status === "sin_competencia") action = "Nadie más oferta este renglón.";
  else action = "Sin precio cargado en el BAC.";
  if (stockAction === "agotado") action += ` Stock agotado: pedí incremento de ${stockAdd}.`;
  else if (stockAction === "pedir_incremento") action += ` Te quedan ${left} de ${offered}: pedí incremento de ${stockAdd}.`;

  return { ...l, price, best, costVat, status, beatBy: status === "te_ganan" ? r2(price! - best!) : null,
    beatPct: status === "te_ganan" ? ((price! / best!) - 1) * 100 : null, target, move, marginNow: margin(price), marginTarget: margin(target),
    canLower, minPrice, offered, left, sold, leftPct, stockAction, stockAdd, action };
}

const money = (v: number) => `$${v.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pct = (v: number) => `${v.toFixed(1).replace(".", ",")}%`;

export const STATUS_LABEL: Record<Advice["status"], string> = { te_ganan: "Te ganan", ganas: "Ganás", sin_competencia: "Sin competencia", sin_precio: "Sin precio" };
