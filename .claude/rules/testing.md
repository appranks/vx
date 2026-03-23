---
description: Vitest configuration, what to test, mocking patterns, coverage, fixtures, naming
paths:
  - "src/**/*.test.ts"
  - "tests/**"
  - "vitest.config.ts"
---

# Patrones de Testing

Contratos fuente: `.claude/contracts/testing.md`

## Framework

- Vitest 4.x. Configuración en `vitest.config.ts` con `defineConfig` de `vitest/config`.
- Ejecutar siempre con `bun run test` (o `bun run vitest`). **Nunca** `bun test` — invoca el test runner nativo de Bun, que tiene API diferente.
- `globals: false` — importar `describe`, `it`, `expect`, `vi` explícitamente de `vitest`.
- Environment: `node`.

## Qué se testea

| Módulo | Testeado | Razón |
|--------|----------|-------|
| `src/lib/args.ts` | Sí | Lógica pura |
| `src/lib/http.ts` | Sí (mock fetch) | Parsing y errores |
| `src/lib/format.ts` | Sí | Lógica pura |
| `src/lib/paths.ts` | Sí | Lógica pura |
| `src/lib/ports.ts` | Sí (mock fetch) | Lógica de detección |
| `src/stack/compose.ts` | Sí | Generación de objeto tipado |
| `src/stack/otel.ts` | Sí | Generación de config |
| `src/commands/*.ts` | Parcial (mock deps) | Flujo de control principal |
| `src/cli.ts` | No | Entry point, testeado por comandos individuales |
| Docker real | No | Lento, requiere infraestructura |
| Red real | No | No determinístico |

## Mocking

### `fetch` — `global.fetch = vi.fn()`
```typescript
global.fetch = vi.fn().mockResolvedValueOnce(
  new Response(JSON.stringify(data), { status: 200 })
);
```
- Sin librerías de terceros (no vitest-fetch-mock, no msw para unit tests).
- Cada test define la respuesta exacta con `mockResolvedValueOnce`.
- Restaurar en `afterEach` con `vi.restoreAllMocks()`.

### `Bun.spawnSync` — `vi.spyOn(Bun, 'spawnSync')`
```typescript
vi.spyOn(Bun, 'spawnSync').mockReturnValueOnce({
  exitCode: 0,
  stdout: new Uint8Array(),
  stderr: new Uint8Array(),
  success: true,
} as ReturnType<typeof Bun.spawnSync>);
```
- Para tests de comandos que llaman Docker.
- Nunca llamar Docker real en tests.

### `Bun.file` / `Bun.write` — `vi.spyOn`
- Para tests de generación de archivos.
- Verificar que se llamaron con los argumentos correctos, no el contenido exacto del archivo.

### Restauración
- `afterEach(() => vi.restoreAllMocks())` en cada archivo de test.
- Un test nunca contamina al siguiente.

## Ubicación de tests

- Tests colocados junto al código fuente: `src/lib/http.test.ts` junto a `src/lib/http.ts`.
- Fixtures en `tests/fixtures/` (respuestas reales de Victoria en `.json` / `.ndjson`).
- Helper `buildMockContext()` en `tests/helpers/mock-context.ts`.

```
src/lib/http.ts
src/lib/http.test.ts       ← junto al módulo
tests/fixtures/vm-vector-response.json
tests/helpers/mock-context.ts
```

## Naming de tests

- Describir comportamiento observable, no implementación interna.

```typescript
// Correcto:
it('returns empty array when query matches no logs', ...);
it('throws StackUnreachableError when victoria is not running', ...);

// INCORRECTO:
it('calls fetch with the right url', ...);
it('splits by newline', ...);
```

## buildMockContext helper

- Todo test de comando usa `buildMockContext()`. Nunca construir `CommandContext` manualmente.
- Acepta overrides de flags: `buildMockContext({ json: true, quiet: false })`.
- Expone `printed: unknown[]` y `errors: string[]` para assertions.

```typescript
const ctx = buildMockContext({ json: true });
await runMetrics(ctx);
expect(ctx.printed[0]).toHaveProperty('query');
```

## Fixtures

- Archivos en `tests/fixtures/` son respuestas reales copiadas de Victoria.
- Son inmutables. Solo se actualizan cuando la API de Victoria cambia.
- Se importan con `import fixture from '../../tests/fixtures/file.json' with { type: 'json' }`.

## Coverage

- Provider: `v8`.
- Umbral: 70% líneas, 65% funciones, 60% branches.
- Incluye: `src/**/*.ts`.
- Excluye: `src/cli.ts`, `src/**/*.d.ts`, `src/**/*.test.ts`.
- `src/cli.ts` está excluido del umbral pero puede tener tests opcionales.

## Reglas

1. `bun run test`. Nunca `bun test`.
2. Tests de comandos usan siempre `buildMockContext()`.
3. `global.fetch` se mockea con `vi.fn()`. Sin librerías de terceros.
4. `Bun.spawnSync` se mockea con `vi.spyOn`. Sin Docker real.
5. Todos los mocks se restauran en `afterEach` con `vi.restoreAllMocks()`.
6. Nombres de test: comportamiento observable, no implementación.
7. Tests unitarios no tocan filesystem real ni red real.
8. Fixtures son inmutables.
9. No existe un test que haga `docker compose up`.
10. El archivo `src/cli.ts` está excluido del coverage.
