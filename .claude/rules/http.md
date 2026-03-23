---
description: Fetch wrapper, timeouts, error classes, response parsing, output format, URL construction
paths:
  - "src/lib/http.ts"
  - "src/lib/format.ts"
  - "src/commands/metrics.ts"
  - "src/commands/logs.ts"
  - "src/commands/traces.ts"
  - "src/commands/check.ts"
---

# Patrones HTTP / Query

Contratos fuente: `.claude/contracts/http.md`

## Fetch

- `fetch()` nativo de Bun. Sin axios, sin node-fetch, sin wrappers de terceros.
- Timeout con `AbortSignal.timeout(N)`. Sin `AbortController` + `setTimeout` manual.
- Header `Accept: application/json` siempre presente.
- Sin retry automático. Una falla es un error inmediato con exit code correspondiente.
- La función base es `victoriaGet(url, timeoutMs)` en `src/lib/http.ts`.

## Clases de error

```typescript
// Stack no responde (ECONNREFUSED, timeout, DNS fail) → exit 2
export class StackUnreachableError extends Error {}

// Query inválida (400, 422 de Victoria) → exit 1
export class QueryError extends Error {}
```

- `StackUnreachableError` se lanza cuando `fetch()` lanza (red) o cuando el HTTP status no es 2xx ni 400/422.
- `QueryError` se lanza cuando Victoria retorna 400 o 422 (query mal formada).
- Los handlers capturan estas clases y mapean al exit code correcto.

## Timeouts por backend

```typescript
export const TIMEOUTS = {
  metrics: 10_000,   // MetricsQL — datos indexados, rápido
  logs:    15_000,   // LogsQL — puede escanear mucho
  traces:  15_000,   // LogsQL sobre traces — mismo caso
  health:   3_000,   // Health checks — debe fallar rápido
} as const;
```

## Parsing de respuestas

### Victoria Metrics (`:8428`)
- Endpoint: `/api/v1/query` (instant) o `/api/v1/query_range` (rango).
- Respuesta: JSON con envoltura Prometheus `{"status":"success","data":{"resultType":"...","result":[...]}}`.
- El parser extrae `data.result` y lo tipifica como `MetricsResponse`.
- Si `status !== 'success'`, lanza `QueryError`.

### Victoria Logs (`:9428`)
- Endpoint: `/select/logsql/query`.
- Respuesta: JSON Lines (NDJSON) — una línea JSON por entrada de log.
- El parser lee el body como texto, divide por `\n`, parsea cada línea, descarta líneas vacías.
- Cada entrada es `LogEntry { _msg, _stream, _time, [key: string]: string }`.

### Victoria Traces (`:10428`)
- Endpoint: `/select/logsql/query`.
- Respuesta: JSON Lines (misma forma que logs).
- Cada entrada es `TraceEntry { traceID, spanID, operationName, duration, _time }`.
- Reutiliza el mismo patrón de parsing que logs con tipos diferentes.

## Funciones de query

```typescript
export async function queryMetrics(query: string, time?: string): Promise<MetricsResponse>;
export async function queryLogs(query: string, limit?: number): Promise<LogEntry[]>;
export async function queryTraces(query: string, limit?: number): Promise<TraceEntry[]>;
```

## Formato de output

- Todos los comandos de query retornan la misma estructura base:

```typescript
interface QueryOutput<T> {
  query: string;
  count: number;
  results: T[];
}
```

- La función `formatQueryResult(query, results)` de `src/lib/format.ts` construye esta estructura.
- El agente parsea `results` genéricamente sin importar si es metrics, logs, o traces.

## Construcción de URLs

- Siempre con `new URL()` + `url.searchParams.set()`. **Nunca** concatenación de strings.
- `searchParams.set()` encodea automáticamente chars especiales de MetricsQL/LogsQL (llaves, corchetes, comillas).

```typescript
// Correcto:
const url = new URL('http://localhost:8428/api/v1/query');
url.searchParams.set('query', 'rate(http_requests_total{job="api"}[5m])');

// INCORRECTO — nunca hacer:
const url = `http://localhost:8428/api/v1/query?query=${query}`;
```

## Límites de resultados

| Backend | Default | Override |
|---------|---------|----------|
| Metrics | 1000 series | `--limit N` |
| Logs | 100 entradas | `--limit N` |
| Traces | 50 spans | `--limit N` |

- Los límites son siempre explícitos en el request. No se delega al backend.
- Si `--limit` no es un entero positivo, error con exit 1.

## Reglas

1. `StackUnreachableError` → exit 2. `QueryError` → exit 1. Sin excepciones.
2. URLs siempre con `new URL()` + `searchParams.set()`. Nunca concatenación.
3. Todos los query commands retornan `{ query, count, results }`.
4. Sin retry automático. Falla inmediata.
5. El body se parsea completo antes de retornar. Sin streams al caller.
6. Líneas vacías en JSON Lines se descartan silenciosamente.
7. HTTP status != 2xx que no sea 400/422 se trata como `StackUnreachableError`.
