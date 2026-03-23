---
description: OTel preset generation, Bun compatibility, idempotence, dependency injection, auto-detection
paths:
  - "src/presets/**"
  - "src/commands/init.ts"
  - "src/commands/snippet.ts"
  - "src/lib/preset-writer.ts"
  - "src/lib/package-json.ts"
---

# Patrones de Presets

Contratos fuente: `.claude/contracts/presets.md`

## Presets disponibles

| Preset | Runtime | Instrumentación | Paquete clave |
|--------|---------|-----------------|---------------|
| `hono` | Bun o Node | `@hono/otel` (middleware) | `@hono/otel@1.1.1` |
| `nextjs` | Node | `@vercel/otel` (auto) | `@vercel/otel@2.1.1` |
| `generic` | Node | SDK manual | `@opentelemetry/sdk-node@0.213.0` |

- Comando: `vx init [preset]`. Si no se especifica, detección automática.
- Tabla de dispatch en `src/commands/init.ts`: `Record<PresetName, handler>`.
- Agregar un preset nuevo = un archivo en `src/presets/` + una línea en la tabla.

## Incompatibilidad Bun + OTel

- **`@opentelemetry/auto-instrumentations-node` NO funciona en Bun.** Bun no soporta `diagnostics_channel`.
- El preset `hono` **NUNCA** incluye `auto-instrumentations-node`.
- El preset `hono` usa `@hono/otel` que opera a nivel middleware (no depende de monkey-patching).
- El preset `nextjs` usa `@vercel/otel` que sí usa auto-instrumentation (corre en Node).

## Archivos generados

### Preset `hono`
1. `instrumentation.ts` — Inicializa SDK OTel con exporters OTLP HTTP. Sin auto-instrumentaciones.
2. `.env.otel` — Variables de entorno OTel como referencia.

### Preset `nextjs`
1. `instrumentation.ts` — Exporta `register()` con `registerOTel()` de `@vercel/otel`.
2. `.env.otel` — Variables de entorno OTel como referencia.

### Preset `generic`
1. `instrumentation.ts` — SDK OTel manual sin framework assumptions.
2. `.env.otel` — Variables de entorno OTel como referencia.

## Dónde se escriben

- Los archivos de instrumentación se escriben en `process.cwd()` (directorio del proyecto del usuario), **no** en `.vx/`.
- `.vx/` es para el stack Docker. Los archivos de preset son código del usuario.
- Todos los archivos son `.ts`, nunca `.js` ni `.mjs`.

## Idempotencia

- Si el archivo ya existe, `vx init` **no lo sobreescribe**. Reporta `skipped`.
- El flag `--force` permite sobreescribir.
- La función `writeIfNotExists(path, content, force)` de `src/lib/preset-writer.ts` maneja esto.
- `vx init` es seguro para llamar múltiples veces.

## Inyección de dependencias

- `vx init` modifica el `package.json` del usuario agregando dependencias del preset a `dependencies`.
- Si una dependencia ya existe con versión diferente, **se respeta la versión existente** (no downgrade).
- Las dependencias añadidas se reportan en `added`, las que se saltaron en `skipped`.
- Las versiones son exactamente las del `stack-manifest.json`.
- La función `injectDependencies(deps, dev?)` de `src/lib/package-json.ts` maneja esto.

## Variables de entorno

- Se crea `.env.otel` como referencia. **No se modifica el `.env` del usuario.**
- El `.env.otel` contiene: `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_SERVICE_NAME`.
- El usuario copia manualmente al `.env` o `.env.local`.

## Detección automática

- Si no se especifica preset, `vx init` lee `package.json` del `cwd` y detecta:
  - `hono` en dependencies → preset `hono`
  - `next` en dependencies → preset `nextjs`
  - Ninguno → preset `generic`
- La detección está en `src/presets/detect.ts`: `detectPreset()`.
- Presencia de `workspaces` en package.json → warning, usa `generic`.
- Preset explícito siempre tiene prioridad sobre detección.

## Output de `vx init`

- Estructura JSON consistente:

```typescript
{
  preset: string;
  files: Array<{ path: string; action: 'created' | 'skipped' }>;
  dependencies: { added: string[]; skipped: string[] };
  next_steps: string[];  // acciones exactas para el agente
}
```

- `next_steps` siempre incluye las acciones que el agente debe ejecutar después (e.g., `pnpm install`).

## `vx snippet`

- Imprime el bloque markdown listo para pegar en `CLAUDE.md`.
- Solo stdout, sin side effects, sin archivos.
- El bloque contiene los comandos `vx` que el agente necesita conocer.

## Reglas

1. El preset `hono` **NUNCA** incluye `@opentelemetry/auto-instrumentations-node`.
2. `vx init` no sobreescribe archivos sin `--force`.
3. `vx init` no modifica `.env`. Solo crea `.env.otel`.
4. Detección de preset es por `package.json`, no por imports en código.
5. Todos los archivos generados son `.ts`.
6. Dependencias inyectadas respetan versiones existentes en `package.json`.
7. El output siempre incluye `next_steps`.
8. Las versiones de paquetes OTel son las del `stack-manifest.json`.
9. Los archivos de preset se escriben en `cwd`, no en `.vx/`.
10. `vx snippet` es read-only — nunca genera archivos.
