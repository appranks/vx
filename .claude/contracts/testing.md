---
name: testing-strategy
description: Vitest configuration, what to test, mocking patterns, coverage expectations, fixture management
area: testing
depth_level: 3
decisions: 10
created: 2026-03-23
---

## Proposito

Define la estrategia de testing completa para `vx`. Cubre que se testea y que no, como se mockean dependencias externas (fetch, Bun.spawnSync, sistema de archivos), la estructura de los tests, el naming, coverage expectations, y la decision explicita de no correr Docker real en el CI de la herramienta.

---

## Decisiones

### D-01: Framework — Vitest ejecutado con `bun run test`

**Eleccion:** Vitest 4.x como framework. El script de test en `package.json` es `bun run vitest`. Nunca `bun test`.

**Justificacion:** `bun test` invoca el test runner nativo de Bun que tiene una API diferente (`expect`, `describe`, `it` de `@types/bun`). `vitest` es compatible con `@types/bun` y su ecosistema (vi.mock, vi.fn, vi.spyOn) es significativamente mas potente. El proyecto ya tiene esta decision en el `CLAUDE.md` y en `stack-manifest.json`. Cambiarla romperia todos los tests.

**Ejemplo:**

```json
// package.json
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest"
  }
}
```

```typescript
// vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json'],
      include: ['src/**/*.ts'],
      exclude: ['src/cli.ts', 'src/**/*.d.ts'],
    },
  },
});
```

---

### D-02: Que se testea — logica de negocio, NO integracion con Docker ni Victoria

**Eleccion:** Se testean: parsing de argumentos, construccion de URLs, parsing de respuestas (JSON / JSON Lines), logica de exit codes, formateo de output, generacion de compose config, y los parsers de flags. NO se testean: comandos end-to-end que requieren Docker, queries reales a Victoria, o el binary compilado.

**Justificacion:** Los tests de integracion con Docker son lentos (60s+ para levantar el stack), requieren Docker instalado, y son no-deterministas (dependen del estado de la red local). En una herramienta CLI cuyo usuario principal es un agente de coding que ejecuta en sandbox, el test de integracion real debe hacerse en el nivel del agente, no en el CI de la herramienta. Lo que se puede testear completamente en aislamiento (todo lo que no toca red ni proceso externo) es lo que va en Vitest.

**Tabla de decision:**

| Modulo | Testeado | Motivo |
|--------|----------|--------|
| `src/lib/args.ts` | Si | Logica pura |
| `src/lib/http.ts` | Si (con fetch mock) | Logica de parsing y errores |
| `src/lib/format.ts` | Si | Logica pura |
| `src/lib/paths.ts` | Si | Logica pura |
| `src/stack/compose.ts` | Si | Generacion de objeto tipado |
| `src/stack/otel.ts` | Si | Generacion de config |
| `src/commands/up.ts` | Parcial (mock de Bun.spawnSync) | Flujo de control |
| `src/commands/metrics.ts` | Si (mock de queryMetrics) | Flujo de control y output |
| `src/cli.ts` | No | Entry point, testeado manualmente |
| Docker real | No | Lento, requiere infraestructura |

---

### D-03: Mocking de `fetch` — `vi.fn()` global en setup, restaurado en afterEach

**Eleccion:** Usar `vi.fn()` para reemplazar `global.fetch` en el setup del test. Cada test define la respuesta esperada con `mockResolvedValueOnce`. Se restaura con `vi.restoreAllMocks()` en `afterEach`.

**Justificacion:** No se usa `vitest-fetch-mock` porque agrega una dependencia de test para algo que se puede hacer con `vi.fn()` directamente. El patron de `mockResolvedValueOnce` es mas explicito sobre que respuesta espera cada llamada, lo que hace los tests mas faciles de leer. La restauracion en `afterEach` garantiza que un test no contamina al siguiente.

**Ejemplo:**

```typescript
// tests/lib/http.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { queryMetrics, StackUnreachableError, QueryError } from '../../src/lib/http.ts';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('queryMetrics', () => {
  it('parses a successful vector response', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          status: 'success',
          data: {
            resultType: 'vector',
            result: [
              { metric: { job: 'api' }, value: [1711234567, '0.042'] },
            ],
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );

    const result = await queryMetrics('rate(http_requests_total[5m])');
    expect(result.resultType).toBe('vector');
    expect(result.result).toHaveLength(1);
    expect(result.result[0].value[1]).toBe('0.042');
  });

  it('throws StackUnreachableError when fetch throws ECONNREFUSED', async () => {
    global.fetch = vi.fn().mockRejectedValueOnce(
      Object.assign(new Error('fetch failed'), { code: 'ECONNREFUSED' })
    );

    await expect(queryMetrics('up')).rejects.toThrow(StackUnreachableError);
  });

  it('throws QueryError on 400 response', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce(
      new Response('invalid query syntax', { status: 400 })
    );

    await expect(queryMetrics('invalid{{')).rejects.toThrow(QueryError);
  });
});
```

---

### D-04: Mocking de `Bun.spawnSync` — `vi.spyOn` en el modulo de Bun

**Eleccion:** Para tests de comandos que llaman a Docker via `Bun.spawnSync`, usar `vi.spyOn(Bun, 'spawnSync')` para interceptar y retornar resultados controlados.

**Justificacion:** `Bun.spawnSync` es un global del runtime. `vi.spyOn` permite interceptarlo sin necesitar inyeccion de dependencias en el codigo de produccion. El codigo de produccion queda limpio y el test controla el comportamiento del proceso externo.

**Ejemplo:**

```typescript
// tests/commands/up.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { runUp } from '../../src/commands/up.ts';
import { buildContext } from '../../src/lib/context.ts';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('runUp', () => {
  it('exits with STACK_ERROR when docker compose up fails', async () => {
    vi.spyOn(Bun, 'spawnSync').mockReturnValueOnce({
      exitCode: 1,
      stdout: new Uint8Array(),
      stderr: new TextEncoder().encode('Error response from daemon: port already in use'),
      success: false,
    } as ReturnType<typeof Bun.spawnSync>);

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called'); // para poder capturar la llamada
    });

    const ctx = buildContext(['up']);
    await expect(runUp(ctx)).rejects.toThrow('process.exit called');
    expect(exitSpy).toHaveBeenCalledWith(2);
  });
});
```

---

### D-05: Mocking del sistema de archivos — `Bun.file()` y `Bun.write()` como vi.fn

**Eleccion:** Para tests de generacion de archivos (compose.ts, otel.ts), mockear `Bun.file` y `Bun.write` con `vi.spyOn`. Verificar que se llamaron con los argumentos correctos, no el contenido exacto del archivo.

**Justificacion:** Verificar el contenido exacto del YAML generado en un test es fragil: cualquier cambio de whitespace o comentario rompe el test. Es mejor verificar que la estructura correcta fue llamada con el path correcto. El test del YAML exacto se hace visualmente inspeccionando el archivo generado.

**Ejemplo:**

```typescript
// tests/stack/compose.test.ts
import { describe, it, expect, vi } from 'vitest';
import { buildComposeConfig } from '../../src/stack/compose.ts';
import { IMAGES, VX_PROJECT_NAME } from '../../src/lib/constants.ts';

describe('buildComposeConfig', () => {
  it('uses the vx project name', () => {
    const config = buildComposeConfig();
    expect(config.name).toBe(VX_PROJECT_NAME);
  });

  it('uses exact image versions from constants', () => {
    const config = buildComposeConfig();
    expect(config.services['victoria-metrics'].image).toBe(IMAGES.victoriaMetrics);
    expect(config.services['victoria-logs'].image).toBe(IMAGES.victoriaLogs);
    expect(config.services['victoria-traces'].image).toBe(IMAGES.victoriaTraces);
    expect(config.services['otel-collector'].image).toBe(IMAGES.otelCollector);
  });

  it('all services are on vx-net', () => {
    const config = buildComposeConfig();
    for (const service of Object.values(config.services)) {
      expect(service.networks).toContain('vx-net');
    }
  });

  it('all volumes have vx- prefix', () => {
    const config = buildComposeConfig();
    for (const volumeName of Object.keys(config.volumes)) {
      expect(volumeName).toMatch(/^vx-/);
    }
  });
});
```

---

### D-06: Estructura de archivos de test — colocados junto al codigo fuente

**Eleccion:** Los tests viven en `src/lib/http.test.ts`, `src/commands/metrics.test.ts`, etc. (junto al archivo que testean). No existe un directorio `tests/` separado para unit tests. Solo para fixtures y helpers de test hay un `tests/` separado.

**Justificacion:** Los tests colocados junto al codigo son mas faciles de encontrar y mantener. Cuando se cambia `http.ts`, el `http.test.ts` esta en el mismo directorio — no hay que navegar. Es el patron de Vitest, Jest, y Go. La convencion `*.test.ts` es estandar y reconocida por todos los IDEs.

**Estructura:**

```
src/
  lib/
    http.ts
    http.test.ts       <- junto al modulo
    format.ts
    format.test.ts
    args.ts
    args.test.ts
  stack/
    compose.ts
    compose.test.ts
  commands/
    metrics.ts
    metrics.test.ts

tests/
  fixtures/
    victoria-metrics-response.json
    victoria-logs-response.ndjson
  helpers/
    mock-context.ts    <- helper para construir CommandContext de test
```

---

### D-07: Naming de tests — descripcion de comportamiento, no de implementacion

**Eleccion:** Los nombres de tests describen el comportamiento observable: `'returns empty array when query matches no logs'`, no `'calls split() on text body'`.

**Justificacion:** Los tests nombrados por implementacion se vuelven invalidos cuando se refactoriza el codigo internamente. Los tests nombrados por comportamiento documentan que debe pasar, independientemente de como este implementado. Si el test falla, el nombre explica que contrato se rompie.

**Ejemplo:**

```typescript
// Correcto:
it('returns empty array when query matches no logs', async () => { ... });
it('throws StackUnreachableError when victoria is not running', async () => { ... });
it('limits results to 100 entries by default', async () => { ... });
it('URL-encodes special characters in MetricsQL query', async () => { ... });

// Incorrecto (NO hacer):
it('calls fetch with the right url', async () => { ... });
it('splits by newline', async () => { ... });
it('calls JSON.parse for each line', async () => { ... });
```

---

### D-08: Fixtures — archivos de respuesta reales para parsers

**Eleccion:** Los parsers de respuesta HTTP se testean con fixtures que son respuestas reales copiadas de Victoria. Los fixtures viven en `tests/fixtures/` como archivos `.json` o `.ndjson`.

**Justificacion:** Construir respuestas de Victoria manualmente en cada test es tedioso y puede diferir de la respuesta real. Un fixture capturado de una instancia real garantiza que el parser funciona con datos reales. Los fixtures son inmutables — solo se actualizan cuando la API de Victoria cambia.

**Ejemplo:**

```typescript
// tests/fixtures/vm-vector-response.json
{
  "status": "success",
  "data": {
    "resultType": "vector",
    "result": [
      {
        "metric": { "__name__": "up", "job": "vx-stack", "instance": "victoria-metrics:8428" },
        "value": [1711234567.123, "1"]
      }
    ]
  }
}
```

```typescript
// src/lib/http.test.ts
import vmFixture from '../../tests/fixtures/vm-vector-response.json' with { type: 'json' };

it('parses victoria metrics vector response', async () => {
  global.fetch = vi.fn().mockResolvedValueOnce(
    new Response(JSON.stringify(vmFixture), { status: 200 })
  );
  const result = await queryMetrics('up');
  expect(result.result[0].metric.__name__).toBe('up');
});
```

---

### D-09: Helper `buildMockContext` — constructor de CommandContext para tests

**Eleccion:** Existe un helper `tests/helpers/mock-context.ts` que construye un `CommandContext` completo con mocks de `output.print`, `output.error`, y `output.printHuman`. Los tests de comandos usan este helper.

**Justificacion:** Cada test de comando necesita un `CommandContext` valido. Sin un helper, cada test tiene 10+ lineas de setup repetido. El helper centraliza la creacion y permite variantes rapidas: `buildMockContext({ json: true })`, `buildMockContext({ quiet: true })`.

**Ejemplo:**

```typescript
// tests/helpers/mock-context.ts
import { vi } from 'vitest';
import type { CommandContext, GlobalFlags } from '../../src/lib/context.ts';

export function buildMockContext(flagOverrides: Partial<GlobalFlags> = {}): CommandContext & {
  printed: unknown[];
  errors: string[];
} {
  const printed: unknown[] = [];
  const errors: string[] = [];

  const flags: GlobalFlags = {
    json: true,
    quiet: false,
    verbose: false,
    help: false,
    version: false,
    ...flagOverrides,
  };

  return {
    command: 'test',
    args: [],
    flags,
    output: {
      print: vi.fn((data) => printed.push(data)),
      printHuman: vi.fn(),
      error: vi.fn((msg) => errors.push(msg)),
    },
    printed,
    errors,
  };
}
```

---

### D-10: Coverage — 70% minimo en `src/lib/`, sin coverage de `src/cli.ts`

**Eleccion:** El umbral de coverage es 70% de lineas para `src/lib/` y `src/stack/`. `src/cli.ts` esta excluido del coverage requirement. Los comandos tienen coverage parcial (flujo principal cubierto, edge cases criticos cubiertos).

**Justificacion:** Coverage del 100% en un CLI requiere mockear `process.exit`, `process.stdout.write`, y el sistema de senales — lo que resulta en tests que testean los mocks mas que el codigo real. El 70% en la logica de negocio (lib/, stack/) es alcanzable y significativo. `cli.ts` es un entry point de dispatch — su correctitud se verifica por los tests de los comandos individuales y por el test manual.

**Ejemplo de configuracion:**

```typescript
// vitest.config.ts
export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/cli.ts',          // entry point, no coverage automatico
        'src/**/*.d.ts',
        'src/**/*.test.ts',
      ],
      thresholds: {
        lines: 70,
        functions: 65,
        branches: 60,
      },
    },
  },
});
```

---

## Interfaz

```typescript
// tests/helpers/mock-context.ts
export function buildMockContext(
  flagOverrides?: Partial<GlobalFlags>,
  argOverrides?: string[]
): CommandContext & { printed: unknown[]; errors: string[] };

// Vitest configuration (vitest.config.ts)
// - environment: 'node'
// - include: ['src/**/*.test.ts', 'tests/**/*.test.ts']
// - coverage.exclude: ['src/cli.ts']
// - coverage.thresholds.lines: 70
```

---

## Reglas

1. El comando de test es siempre `bun run vitest`. Nunca `bun test`.
2. Los tests de comandos usan siempre `buildMockContext()`. Nunca construyen `CommandContext` manualmente.
3. `global.fetch` se mockea con `vi.fn()`. Nunca con librerias de terceros.
4. `Bun.spawnSync` se mockea con `vi.spyOn(Bun, 'spawnSync')`. Nunca se llama Docker real en tests.
5. Todos los mocks se restauran en `afterEach` con `vi.restoreAllMocks()`.
6. Los nombres de test describen comportamiento observable, no implementacion interna.
7. Los tests unitarios no tocan el sistema de archivos real. Mockean `Bun.file` y `Bun.write`.
8. Los fixtures en `tests/fixtures/` son inmutables — representan respuestas reales de Victoria.
9. No existe un test que haga `docker compose up` o conexion real a red.
10. El archivo `src/cli.ts` esta excluido del umbral de coverage pero puede tener tests opcionales.

---

## Ejemplos de tests completos

```typescript
// src/lib/args.test.ts
import { describe, it, expect } from 'vitest';
import { parseGlobalFlags, stripFlags } from './args.ts';

describe('parseGlobalFlags', () => {
  it('detects --json flag', () => {
    const flags = parseGlobalFlags(['metrics', '--json', 'up']);
    expect(flags.json).toBe(true);
  });

  it('detects -h as help', () => {
    const flags = parseGlobalFlags(['-h']);
    expect(flags.help).toBe(true);
  });

  it('all flags default to false when not present', () => {
    const flags = parseGlobalFlags(['metrics', 'up']);
    expect(flags.json).toBe(false);
    expect(flags.quiet).toBe(false);
    expect(flags.verbose).toBe(false);
  });
});

describe('stripFlags', () => {
  it('removes all -- prefixed args', () => {
    const positional = stripFlags(['--json', 'up', '--verbose', 'myquery']);
    expect(positional).toEqual(['up', 'myquery']);
  });
});
```

```typescript
// src/lib/format.test.ts
import { describe, it, expect } from 'vitest';
import { formatQueryResult } from './format.ts';

describe('formatQueryResult', () => {
  it('wraps results with query and count', () => {
    const output = formatQueryResult('up', [{ value: 1 }, { value: 2 }]);
    expect(output.query).toBe('up');
    expect(output.count).toBe(2);
    expect(output.results).toHaveLength(2);
  });

  it('returns count 0 for empty results', () => {
    const output = formatQueryResult('no_results', []);
    expect(output.count).toBe(0);
  });
});
```

```typescript
// src/lib/http.test.ts — JSON Lines parsing
describe('queryLogs', () => {
  it('parses JSON Lines response into array of LogEntry', async () => {
    const ndjson = [
      JSON.stringify({ _msg: 'error A', _stream: '{}', _time: '2026-01-01T00:00:00Z' }),
      JSON.stringify({ _msg: 'error B', _stream: '{}', _time: '2026-01-01T00:00:01Z' }),
      '', // linea vacia al final — debe descartarse
    ].join('\n');

    global.fetch = vi.fn().mockResolvedValueOnce(
      new Response(ndjson, { status: 200 })
    );

    const entries = await queryLogs('{app="api"} error');
    expect(entries).toHaveLength(2);
    expect(entries[0]._msg).toBe('error A');
  });
});
```
