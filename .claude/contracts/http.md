---
name: http-query
description: Fetch wrapper, timeout/retry, response parsing, output formatting, per-backend routing
area: http
depth_level: 3
decisions: 10
created: 2026-03-23
---

## Proposito

Define como el CLI hace peticiones HTTP a los tres backends de Victoria (Metrics en :8428, Logs en :9428, Traces en :10428). Cubre el fetch wrapper con timeouts, el parsing diferenciado por backend (JSON para VM, JSON Lines para VL/VT), la estrategia de retry, el formato de output al agente, y la deteccion de cuando el stack no esta disponible.

---

## Decisiones

### D-01: Fetch wrapper — `fetch()` nativo de Bun con `AbortSignal.timeout()`

**Eleccion:** Usar `fetch()` nativo de Bun sin wrappers de terceros. El timeout se implementa con `AbortSignal.timeout(N)` nativo, disponible en Bun y Node 18+. No se usa axios ni node-fetch.

**Justificacion:** El contrato del proyecto es zero dependencias externas. `fetch()` de Bun es identico al Web API fetch, con soporte completo de `AbortSignal`. `AbortSignal.timeout()` es la forma moderna y sin memory leaks de implementar timeouts (vs el patron antiguo con `AbortController` + `setTimeout`). La API es identica en Bun y en Node 18+, lo que facilita los tests con Vitest.

**Ejemplo:**

```typescript
// src/lib/http.ts
export async function httpGet(url: string, timeoutMs = 10_000): Promise<Response> {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(timeoutMs),
    headers: { 'Accept': 'application/json' },
  });
  return res;
}
```

---

### D-02: Manejo de errores de red — diferencia entre stack down y query invalida

**Eleccion:** Los errores de red (ECONNREFUSED, timeout) resultan en exit code 2 (STACK_ERROR). Los errores de query (400 Bad Request de Victoria) resultan en exit code 1 (USER_ERROR). El mensaje de error es diferente para cada caso.

**Justificacion:** El agente necesita saber si el problema es "mi query esta mal formada" (lo puede corregir) o "el stack no esta corriendo" (necesita ejecutar `vx up`). Mezclar ambos con el mismo mensaje o exit code obliga al agente a parsear el mensaje de error en lugar de leer el exit code.

**Ejemplo:**

```typescript
// src/lib/http.ts
export class StackUnreachableError extends Error {
  constructor(url: string, cause?: unknown) {
    super(`victoria backend unreachable at ${url}`);
    this.cause = cause;
  }
}

export class QueryError extends Error {
  constructor(query: string, detail: string) {
    super(`invalid query: ${detail}`);
  }
}

export async function victoriaGet(url: string, timeoutMs = 10_000): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    // ECONNREFUSED, timeout, DNS fail — stack no esta corriendo
    throw new StackUnreachableError(url, err);
  }

  if (res.status === 400 || res.status === 422) {
    const body = await res.text();
    throw new QueryError(url, body);
  }

  if (!res.ok) {
    throw new StackUnreachableError(url, `HTTP ${res.status}`);
  }

  return res;
}
```

---

### D-03: Retry — sin retry automatico

**Eleccion:** El CLI no implementa retry automatico en queries. Si una peticion falla, reporta el error inmediatamente. La excepcion es `vx up` que hace polling en un loop separado con logica propia.

**Justificacion:** Los queries son invocaciones discretas del agente. Si el stack no esta disponible, el agente debe saberlo de inmediato para poder ejecutar `vx up`. Un retry silencioso oculta el problema y agrega latencia no deterministica. El polling de health en `vx up` es un caso especial con semantica diferente (esperar hasta que este listo), no un retry de query.

---

### D-04: Parsing de respuesta de Victoria Metrics — JSON con envoltura `data.result`

**Eleccion:** Victoria Metrics responde con la envoltura estandar de Prometheus: `{"status":"success","data":{"resultType":"vector","result":[...]}}`. El parser extrae `data.result` directamente y tipifica el resultado.

**Justificacion:** Victoria Metrics implementa la API de Prometheus al 100%. Conocer la estructura exacta de la respuesta permite tipado TypeScript completo y evita accesos inseguros a propiedades desconocidas. El agente recibe solo `result`, no la envoltura completa, a menos que use `--json` raw.

**Ejemplo:**

```typescript
// src/lib/http.ts
export interface MetricSample {
  metric: Record<string, string>;
  value: [number, string]; // [timestamp, value]
}

export interface MetricsResponse {
  resultType: 'vector' | 'matrix' | 'scalar' | 'string';
  result: MetricSample[];
}

export async function queryMetrics(query: string, time?: string): Promise<MetricsResponse> {
  const url = new URL('http://localhost:8428/api/v1/query');
  url.searchParams.set('query', query);
  if (time) url.searchParams.set('time', time);

  const res = await victoriaGet(url.toString());
  const body = await res.json() as { status: string; data: MetricsResponse };

  if (body.status !== 'success') {
    throw new QueryError(query, `victoria returned status: ${body.status}`);
  }

  return body.data;
}
```

---

### D-05: Parsing de respuesta de Victoria Logs — JSON Lines (NDJSON)

**Eleccion:** Victoria Logs responde con JSON Lines (una linea JSON por entrada de log). El parser lee el body como texto, divide por `\n`, parsea cada linea, y descarta lineas vacias. La respuesta al agente es un array de objetos de log.

**Justificacion:** La documentacion oficial de VictoriaLogs especifica que `/select/logsql/query` retorna stream de JSON Lines. Cada linea es un objeto con campos `_msg`, `_stream`, `_time`, y campos custom. Leer el body completo como texto y dividir por `\n` es la forma mas simple y correcta. Usando streaming de fetch se podria procesar en tiempo real, pero para el caso de uso del agente (queries discretas) el array completo es mas util.

**Ejemplo:**

```typescript
// src/lib/http.ts
export interface LogEntry {
  _msg: string;
  _stream: string;
  _time: string;
  [key: string]: string; // campos custom del usuario
}

export async function queryLogs(query: string, limit = 100): Promise<LogEntry[]> {
  const url = new URL('http://localhost:9428/select/logsql/query');
  url.searchParams.set('query', query);
  url.searchParams.set('limit', String(limit));

  const res = await victoriaGet(url.toString(), 15_000);
  const text = await res.text();

  const entries: LogEntry[] = text
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      try {
        return JSON.parse(line) as LogEntry;
      } catch {
        return { _msg: line, _stream: '', _time: '' };
      }
    });

  return entries;
}
```

---

### D-06: Parsing de respuesta de Victoria Traces — mismo patron que Logs

**Eleccion:** Victoria Traces en su endpoint `/select/logsql/query` responde tambien con JSON Lines. El parser es identico al de logs con tipos diferentes.

**Justificacion:** Victoria Traces es un producto WIP que comparte el protocolo LogsQL de VictoriaLogs para queries. Reutilizar el mismo parser con tipos diferenciados reduce la duplicacion de codigo. Si el API de VT cambia (el manifest lo marca como "WIP"), solo hay que actualizar el parser.

**Ejemplo:**

```typescript
// src/lib/http.ts
export interface TraceEntry {
  traceID: string;
  spanID: string;
  operationName: string;
  duration: number;
  _time: string;
  [key: string]: unknown;
}

export async function queryTraces(query: string, limit = 50): Promise<TraceEntry[]> {
  const url = new URL('http://localhost:10428/select/logsql/query');
  url.searchParams.set('query', query);
  url.searchParams.set('limit', String(limit));

  const res = await victoriaGet(url.toString(), 15_000);
  const text = await res.text();

  return text
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      try {
        return JSON.parse(line) as TraceEntry;
      } catch {
        return { traceID: '', spanID: '', operationName: line, duration: 0, _time: '' };
      }
    });
}
```

---

### D-07: Timeouts por backend — diferenciados por tipo de query

**Eleccion:** Victoria Metrics: 10s. Victoria Logs: 15s. Victoria Traces: 15s. Health checks: 3s.

**Justificacion:** Las queries de metrics son instantaneas (PromQL sobre series de tiempo indexadas). Las queries de logs y traces pueden escanear volumenes mayores de datos, especialmente con ventanas de tiempo amplias. Los health checks deben fallar rapido para que el polling en `vx up` sea responsivo.

**Ejemplo:**

```typescript
// src/lib/constants.ts
export const TIMEOUTS = {
  metrics: 10_000,    // MetricsQL — rapido, datos indexados
  logs:    15_000,    // LogsQL — puede escanear muchos datos
  traces:  15_000,    // LogsQL sobre traces — mismo caso
  health:   3_000,    // Health checks — deben fallar rapido
} as const;
```

---

### D-08: Formato de output al agente — JSON compacto con estructura consistente

**Eleccion:** Todos los comandos de query retornan la misma estructura base: `{"query":"...","count":N,"results":[...]}`. El campo `results` contiene el array especifico del backend.

**Justificacion:** El agente puede escribir codigo generico para extraer `results` de cualquier comando de `vx`. Si cada comando tiene una estructura diferente, el agente necesita codigo especifico para cada uno. La consistencia reduce la superficie de parsing del agente. El campo `count` permite al agente saber cuantos resultados hay sin contar el array.

**Ejemplo:**

```typescript
// src/lib/format.ts
export interface QueryOutput<T> {
  query: string;
  count: number;
  results: T[];
}

export function formatQueryResult<T>(query: string, results: T[]): QueryOutput<T> {
  return { query, count: results.length, results };
}

// Uso en commands/metrics.ts:
ctx.output.print(formatQueryResult(query, metricsData.result));

// Output JSON al agente:
// {"query":"rate(http_requests_total[5m])","count":3,"results":[{"metric":{"handler":"/api/health"},"value":[1711234567,"0.042"]},...]}
```

---

### D-09: Construccion de URLs — siempre con `new URL()`, nunca concatenacion de strings

**Eleccion:** Las URLs de query se construyen con `new URL()` y `url.searchParams.set()`. Nunca con concatenacion de strings o template literals.

**Justificacion:** Los queries de MetricsQL y LogsQL contienen caracteres especiales (espacios, llaves, corchetes, comillas) que deben ser URL-encoded. `URLSearchParams.set()` encodea automaticamente. La concatenacion manual requiere encoding manual que es propenso a bugs. Una query mal-encoded resulta en un error 400 de Victoria que el agente interpretaria como query invalida.

**Ejemplo:**

```typescript
// Correcto:
const url = new URL('http://localhost:8428/api/v1/query');
url.searchParams.set('query', 'rate(http_requests_total{job="api"}[5m])');
// Produce: http://localhost:8428/api/v1/query?query=rate%28http_requests_total%7Bjob%3D%22api%22%7D%5B5m%5D%29

// Incorrecto (NO hacer):
const url = `http://localhost:8428/api/v1/query?query=${query}`;
// Si query contiene llaves {}, la URL queda invalida
```

---

### D-10: Limites de resultados — defaults conservadores, sobrescribibles por flag

**Eleccion:** Limites por defecto: metrics 1000 series, logs 100 entradas, traces 50 spans. Sobrescribibles via `--limit N`.

**Justificacion:** Sin limites, una query de logs sobre `_time:1h` puede retornar millones de entradas que saturan stdout y hacen que el output del agente sea inutilizable. Los defaults son suficientemente generosos para casos reales de desarrollo pero protegen contra queries accidentalmente amplias. El agente puede aumentar el limite explicitamente cuando lo necesita.

**Ejemplo:**

```typescript
// src/lib/constants.ts
export const QUERY_LIMITS = {
  metrics: 1000,
  logs:    100,
  traces:  50,
} as const;

// En el handler:
const limitStr = ctx.flags['--limit'] ?? String(QUERY_LIMITS.logs);
const limit = parseInt(limitStr, 10);
if (isNaN(limit) || limit < 1) {
  ctx.output.error('--limit must be a positive integer');
  exitWith(EXIT.USER_ERROR);
  return;
}
```

---

## Interfaz

```typescript
// Tipos publicos de src/lib/http.ts

export class StackUnreachableError extends Error {}
export class QueryError extends Error {}

export interface MetricSample {
  metric: Record<string, string>;
  value: [number, string];
}

export interface MetricsResponse {
  resultType: 'vector' | 'matrix' | 'scalar' | 'string';
  result: MetricSample[];
}

export interface LogEntry {
  _msg: string;
  _stream: string;
  _time: string;
  [key: string]: string;
}

export interface TraceEntry {
  traceID: string;
  spanID: string;
  operationName: string;
  duration: number;
  _time: string;
  [key: string]: unknown;
}

export async function queryMetrics(query: string, time?: string): Promise<MetricsResponse>;
export async function queryLogs(query: string, limit?: number): Promise<LogEntry[]>;
export async function queryTraces(query: string, limit?: number): Promise<TraceEntry[]>;
export async function victoriaGet(url: string, timeoutMs?: number): Promise<Response>;

// src/lib/format.ts
export interface QueryOutput<T> { query: string; count: number; results: T[]; }
export function formatQueryResult<T>(query: string, results: T[]): QueryOutput<T>;
```

---

## Reglas

1. `StackUnreachableError` siempre resulta en exit code 2. `QueryError` siempre en exit code 1.
2. Las URLs de query siempre se construyen con `new URL()` + `searchParams.set()`. Nunca con concatenacion.
3. Todos los query commands retornan `{ query, count, results }` como estructura raiz.
4. El timeout por defecto para queries es 10s para metrics y 15s para logs/traces.
5. Los limites de resultados son siempre explicitos — no se delega al backend para decidir cuantos mandar.
6. El CLI no hace retry. Una falla es un error inmediato con exit code correspondiente.
7. El body de la respuesta se parsea completamente antes de retornar. No se usan streams al caller.
8. Las lineas vacias en JSON Lines se descartan silenciosamente.
9. Un status de respuesta HTTP != 2xx que no sea 400/422 se trata como `StackUnreachableError`.
10. `Accept: application/json` siempre presente en el header de cada request.

---

## Ejemplos

```bash
# Query de metrics — salida JSON al agente
$ result=$(vx metrics 'rate(http_requests_total[5m])')
$ echo $result
{"query":"rate(http_requests_total[5m])","count":2,"results":[{"metric":{"handler":"/api/health","method":"GET"},"value":[1711234567,"0.042"]},{"metric":{"handler":"/api/runs","method":"POST"},"value":[1711234567,"0.18"]}]}

# Query de logs
$ result=$(vx logs '{app="engine"} error _time:5m')
$ echo $result
{"query":"{app=\"engine\"} error _time:5m","count":3,"results":[{"_msg":"error: connection timeout","_stream":"{app=\"engine\"}","_time":"2026-03-23T12:34:56Z","level":"error"},...]}

# Stack no corriendo
$ vx metrics 'up'
# stderr: {"error":"victoria backend unreachable at http://localhost:8428/api/v1/query","detail":"connect ECONNREFUSED","code":2}
# exit: 2

# Query mal formada
$ vx metrics 'invalid{{'
# stderr: {"error":"invalid query: unexpected symbol at position 8","detail":"...","code":1}
# exit: 1

# Con limite custom
$ vx logs '{app="api"}' --limit 500
# {"query":"{app=\"api\"}","count":500,"results":[...]}
```
