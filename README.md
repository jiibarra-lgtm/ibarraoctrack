# Ibarra OC Track

ERP para órdenes de compra públicas (BAC / GCBA): importación de OC, renglones, costos, entregas, facturación, cobranzas y rentabilidad.

**Estado: Fase 1 — Fundamentos** (arquitectura, base de datos, auth, navegación, órdenes, importador BAC, buscador global).

## Stack

- Next.js 16 (App Router, Server Actions, Route Handlers, `proxy.ts`) · React 19 · TypeScript estricto
- Tailwind CSS 4 · Radix UI · Lucide · Recharts · TanStack Table · React Hook Form · Zod
- Supabase: Postgres + Auth + Storage privado + RLS · Vercel
- `decimal.js` para todo cálculo monetario (en DB: `numeric(18,2)` importes / `numeric(18,4)` cantidades y precios)

## Variables de entorno

| Variable | Dónde | Uso |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | cliente + servidor | URL del proyecto |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | cliente + servidor | clave publicable (RLS obligatoria) |
| `ANTHROPIC_API_KEY` | **sólo servidor** | opcional: lectura de capturas y escaneos con IA |
| `ANTHROPIC_MODEL` | sólo servidor | opcional, por defecto `claude-sonnet-5-5` |

No se usa la service role key en la app: todo corre con la sesión del usuario y RLS.

## Desarrollo

```bash
npm install
cp .env.example .env.local   # completar
npm run dev
npm test                     # unitarias (parser BAC, dinero, fusión texto+IA, PDF real)
npm run typecheck && npm run lint && npm run build
```

## Base de datos

Migraciones versionadas en `supabase/migrations/` (aplicadas en el proyecto `blhjhmfjkiwpsunxxaxe`).

- **Multi-empresa**: toda tabla tiene `org_id`; RLS por pertenencia (`is_org_member`) y rol (`has_org_role`).
- **Roles**: admin · finanzas · compras · logística · consulta.
- **Auditoría inmutable** (`audit_logs`): la escribe un trigger `security definer`; los clientes no tienen insert/update/delete.
- **Historial**: `purchase_order_status_history` (estados con motivo) y `purchase_order_revisions` (snapshot por versión).
- **Concurrencia**: control optimista por `version`; renglones únicos por (orden, renglón, opción) con restricción diferida.
- **Operaciones atómicas** vía RPC: `save_purchase_order`, `confirm_po_import`, `set_po_status`, `claim_import_job`.
- **Búsqueda**: `global_search` con `unaccent` + `pg_trgm` (índices GIN sobre `norm(...)`), respeta RLS.
- **Storage**: bucket `documents` privado, rutas `{org_id}/...`, URLs firmadas de 2 minutos.

## Importador BAC

Entrada: captura (PNG/JPG) o PDF de la pantalla **“Ver documento contractual”** de Buenos Aires Compras. No hay integración ni scraping de BAC.

1. Validación de tipo/tamaño → SHA-256 en el navegador → detección de duplicado.
2. Subida al bucket privado → `documents` + `import_jobs` (`pendiente`).
3. Procesamiento en una invocación separada (`POST /api/import/[id]/process`, `maxDuration` 300 s) con lock y reintentos (`claim_import_job`), verificación de integridad del hash.
4. Extracción:
   - PDF con texto → parser determinístico por patrones BAC (`src/lib/bac/parse-text.ts`).
   - Imagen / escaneo → IA con visión (captura partida en tramos legibles), transcripción literal con `null` ante dudas.
   - Si hay ambas, se cruzan: coincidencias confirman, diferencias quedan **para revisar**.
5. Validación aritmética exacta (cantidad × precio, suma de renglones, total − bonificado = neto) y duplicado por número de OC.
6. Vista previa editable al lado del original, campos dudosos en amarillo → confirmación → orden creada en una transacción.

## Fases

1. ✅ Fundamentos
2. Productos, proveedores, compras, costos, asignaciones, motor de rentabilidad, ranking
3. Entregas parciales, remitos desde el celular, lectura de remitos, expediente digital
4. Facturas de proveedores (IA), facturación, cobranzas, retenciones, flujo de caja
5. Dashboard avanzado, 12 meses, reportes, alertas, simulador
6. Producción: hardening, performance, e2e, backups, documentación
