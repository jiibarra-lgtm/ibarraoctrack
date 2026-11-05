/** Rubro de una licitación según palabras clave del título (sin IA, editable acá). */
export const RUBROS = [
  { key: "limpieza", label: "Limpieza e higiene", words: ["limpieza", "lavandina", "detergente", "desinfect", "jab[oó]n", "higiene", "papel higi", "toalla", "residuo", "bolsa", "trapo", "escoba", "lustramueble", "alcohol en gel", "tocador", "perfumer"] },
  { key: "descartables", label: "Descartables y bazar", words: ["descartable", "bazar", "vaso", "plato", "cubierto", "bandeja", "envase", "contenedor", "jarra", "taza", "vajilla", "film", "aluminio"] },
  { key: "salud", label: "Salud e insumos médicos", words: ["m[eé]dic", "botiqu", "hospital", "quir[uú]rg", "guante", "barbijo", "jeringa", "gasa", "oxígeno|oxigeno", "concentrador", "laboratorio", "reactivo", "farmac", "medicamento", "odontol", "ortop", "pr[oó]tesis", "sutura", "cat[eé]ter", "esteril"] },
  { key: "libreria", label: "Librería y oficina", words: ["librer[ií]a", "papeler[ií]a", "resma", "útiles|utiles", "oficina", "t[oó]ner", "cartucho", "impres", "carpeta", "lapicer"] },
  { key: "alimentos", label: "Alimentos", words: ["aliment", "v[ií]veres", "comestible", "bebida", "agua mineral", "caf[eé]", "az[uú]car", "yerba", "leche", "catering", "refrigerio"] },
  { key: "textil", label: "Textil y blanco", words: ["textil", "ropa", "uniforme", "s[aá]bana", "frazada", "colch[oó]n", "almohada", "toall[oó]n", "indumentaria", "calzado", "guardapolvo", "abanico"] },
  { key: "mantenimiento", label: "Ferretería y mantenimiento", words: ["ferreter", "mantenimiento", "pintura", "herramienta", "el[eé]ctric", "iluminaci", "plomer", "construc", "repuesto", "cerrajer", "matafuego"] },
  { key: "tecnologia", label: "Tecnología", words: ["inform[aá]tic", "computador", "notebook", "software", "hardware", "monitor", "red de datos", "telefon"] },
  { key: "servicios", label: "Servicios y alquileres", words: ["servicio", "alquiler", "contrataci[oó]n de", "locaci[oó]n", "traslado", "flete", "fumigaci", "vigilancia", "capacitaci"] },
] as const;
export type RubroKey = (typeof RUBROS)[number]["key"] | "otros";

const COMPILED = RUBROS.map((r) => ({ key: r.key, re: new RegExp(`(${r.words.join("|")})`, "i") }));

export function rubroOf(title: string | null | undefined): RubroKey {
  const t = (title ?? "").normalize("NFC");
  return (COMPILED.find((r) => r.re.test(t))?.key ?? "otros") as RubroKey;
}
export const RUBRO_LABEL: Record<RubroKey, string> = { ...Object.fromEntries(RUBROS.map((r) => [r.key, r.label])), otros: "Otros" } as Record<RubroKey, string>;

/** Tipo de proceso según el sufijo del número (LPU26 → Licitación pública). */
export const PROCESS_TYPES: Record<string, string> = {
  LPU: "Licitación pública", LPR: "Licitación privada", CME: "Contratación menor", CDI: "Contratación directa",
  COMP: "Compulsa", CM: "Convenio marco", SUB: "Subasta", CON: "Concurso", LP: "Licitación pública", CD: "Contratación directa",
};
export function processType(num: string) {
  const m = /-([A-Z]{2,5})\d{2}$/.exec(num.toUpperCase());
  return m ? { code: m[1], label: PROCESS_TYPES[m[1]] ?? m[1] } : { code: "OTRO", label: "Otro" };
}
