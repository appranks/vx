---
name: presets-instrumentation
description: OTel preset generation, Bun compatibility constraints, idempotence, package injection, auto-detection
area: presets
depth_level: 3
decisions: 11
created: 2026-03-23
---

## Proposito

Define como `vx init` genera el codigo de instrumentacion OpenTelemetry para la app del usuario. Cubre que archivos genera cada preset, como se maneja la incompatibilidad de Bun con auto-instrumentation, la estrategia de idempotencia cuando el usuario vuelve a ejecutar `vx init`, como se inyectan dependencias en el `package.json` del usuario, y si existe deteccion automatica del preset.

---

## Decisiones

### D-01: Presets disponibles — `hono`, `nextjs`, `generic`

**Eleccion:** Tres presets iniciales: `hono` (para apps Bun+Hono), `nextjs` (para Next.js en Node), y `generic` (cualquier framework Node con instrumentacion manual). El comando es `vx init [preset]`. Si no se especifica preset, se ejecuta la deteccion automatica (ver D-10).

**Justificacion:** Los tres presets cubren los casos de uso del proyecto brainscode (Hono para engine, Next.js para web) mas el caso generico. Ampliar a otros frameworks en el futuro solo requiere agregar un archivo en `src/presets/`. La seleccion explicita del preset siempre tiene prioridad sobre la deteccion automatica — el usuario sabe mejor que framework usa.

**Ejemplo:**

```typescript
// src/commands/init.ts
import { initHono } from '../presets/hono.ts';
import { initNextjs } from '../presets/nextjs.ts';
import { initGeneric } from '../presets/generic.ts';
import { detectPreset } from '../presets/detect.ts';

type PresetName = 'hono' | 'nextjs' | 'generic';

const PRESETS: Record<PresetName, (ctx: CommandContext) => Promise<void>> = {
  hono: initHono,
  nextjs: initNextjs,
  generic: initGeneric,
};

export async function runInit(ctx: CommandContext): Promise<void> {
  const presetArg = ctx.args[0] as PresetName | undefined;
  const presetName = presetArg ?? await detectPreset();

  if (!PRESETS[presetName]) {
    ctx.output.error(
      `unknown preset: ${presetName}`,
      `Available presets: ${Object.keys(PRESETS).join(', ')}`
    );
    exitWith(EXIT.USER_ERROR);
    return;
  }

  await PRESETS[presetName](ctx);
}
```

---

### D-02: Incompatibilidad Bun + auto-instrumentation — estrategia por runtime

**Eleccion:** El preset `hono` (runtime Bun) usa `@hono/otel` como middleware de nivel framework + SDKs OTLP manuales. No instala `@opentelemetry/auto-instrumentations-node` porque Bun no soporta `diagnostics_channel`. El preset `nextjs` usa `@vercel/otel` que es el wrapper oficial para auto-instrumentacion en Next.js (Node runtime).

**Justificacion:** El `stack-manifest.json` documenta explicitamente: `"auto_instrumentation": false` para Bun, con la razon: "Bun lacks diagnostics_channel support needed for auto-instrumentation". Instalar `@opentelemetry/auto-instrumentations-node` en un proyecto Bun silenciosamente no instrumenta nada, o peor, causa errores en runtime. El preset debe ser honesto sobre lo que hace y lo que no.

**Paquetes por preset:**

```typescript
// src/presets/hono.ts — paquetes para Bun + Hono
const HONO_DEPS: Record<string, string> = {
  '@hono/otel': '1.1.1',                           // middleware Hono — funciona en Bun
  '@opentelemetry/api': '1.9.0',
  '@opentelemetry/sdk-node': '0.213.0',
  '@opentelemetry/exporter-trace-otlp-http': '0.213.0',
  '@opentelemetry/exporter-metrics-otlp-http': '0.213.0',
  '@opentelemetry/exporter-logs-otlp-http': '0.213.0',
  // NO incluye: @opentelemetry/auto-instrumentations-node (no funciona en Bun)
};

// src/presets/nextjs.ts — paquetes para Node + Next.js
const NEXTJS_DEPS: Record<string, string> = {
  '@vercel/otel': '2.1.1',                         // wrapper oficial Next.js
  '@opentelemetry/api': '1.9.0',
};
// @vercel/otel incluye auto-instrumentaciones internamente para Node runtime
```

---

### D-03: Archivos generados por preset `hono` — tres archivos especificos

**Eleccion:** El preset `hono` genera: (1) `instrumentation.ts` — inicializa el SDK OTel antes de cualquier import de Hono, (2) `.env.otel` — variables de entorno para el collector, y (3) una seccion en `package.json` con `--preload instrumentation.ts`.

**Justificacion:** Bun no tiene `--require` como Node. La forma de ejecutar codigo antes que el bundle es `bun --preload instrumentation.ts index.ts`. Este patron es el recomendado para OTel en Bun (fuente: oneuptime.com/blog OTel Bun Feb 2026). El archivo `instrumentation.ts` debe inicializarse antes que cualquier import para que los patchers funcionen incluso en Bun (aunque limitados vs Node).

**Ejemplo de archivos generados:**

```typescript
// instrumentation.ts (generado por vx init hono)
import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { SimpleLogRecordProcessor } from '@opentelemetry/sdk-logs';
import { Resource } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';

const sdk = new NodeSDK({
  resource: new Resource({
    [ATTR_SERVICE_NAME]: process.env.SERVICE_NAME ?? 'my-service',
  }),
  traceExporter: new OTLPTraceExporter({
    url: 'http://localhost:4318/v1/traces',
  }),
  metricReader: new PeriodicExportingMetricReader({
    exporter: new OTLPMetricExporter({
      url: 'http://localhost:4318/v1/metrics',
    }),
    exportIntervalMillis: 5_000,
  }),
  logRecordProcessors: [
    new SimpleLogRecordProcessor(
      new OTLPLogExporter({ url: 'http://localhost:4318/v1/logs' })
    ),
  ],
  // No incluye instrumentations: no funciona en Bun sin diagnostics_channel
});

sdk.start();

process.on('beforeExit', () => sdk.shutdown());
```

```typescript
// app.ts (ejemplo de uso con @hono/otel — no generado, documentado)
import './instrumentation.ts'; // DEBE ser el primer import
import { Hono } from 'hono';
import { instrument } from '@hono/otel';

const app = new Hono();
export default instrument(app); // wrappea todos los handlers con spans OTel
```

---

### D-04: Archivos generados por preset `nextjs` — `instrumentation.ts` de Next.js

**Eleccion:** El preset `nextjs` genera el archivo `instrumentation.ts` en el root del proyecto Next.js usando la convencion oficial de Next.js Instrumentation Hook. Este archivo exporta una funcion `register()` que Next.js llama automaticamente.

**Justificacion:** Next.js 14+ tiene soporte nativo para `instrumentation.ts` en el root del proyecto. La funcion `register()` es llamada por Next.js antes de levantar el servidor. `@vercel/otel` provee `registerOTel()` que configura todo en una linea. Este es el patron oficial documentado por Vercel y compatible con el App Router y Pages Router.

**Ejemplo:**

```typescript
// instrumentation.ts (generado por vx init nextjs)
import { registerOTel } from '@vercel/otel';

export function register() {
  registerOTel({
    serviceName: process.env.SERVICE_NAME ?? 'my-nextjs-app',
    // OTEL_EXPORTER_OTLP_ENDPOINT tomado de .env.local automaticamente
  });
}
```

```bash
# .env.local (generado o con instrucciones para agregar)
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
```

---

### D-05: Preset `generic` — instrumentacion manual minima sin framework assumptions

**Eleccion:** El preset `generic` genera un `instrumentation.ts` identico al de Hono pero sin la dependencia de `@hono/otel`. Documenta en comentarios que las instrumentaciones automaticas no estan incluidas intencionalmente y que el usuario debe agregar spans manualmente.

**Justificacion:** Para frameworks sin integracion OTel oficial (Express en Bun, ElysiaJS, Fastify en Bun), la unica instrumentacion confiable es manual. Generar codigo que pretende instrumentar automaticamente cuando no lo hace es peor que no generar nada. El preset generico es honesto: "aqui tienes el SDK configurado, los spans los agregas tu".

---

### D-06: Idempotencia de `vx init` — no sobreescribir si el archivo ya existe

**Eleccion:** Si `instrumentation.ts` ya existe en el directorio actual, `vx init` no lo sobreescribe. Reporta "file already exists, skipping" y continua con los otros pasos (dependencias, env vars). El usuario puede pasar `--force` para sobreescribir.

**Justificacion:** El agente puede llamar `vx init` multiples veces (al inicio de cada run, como verificacion). Si `vx init` sobreescribiera el archivo, destruiria las modificaciones que el usuario haya hecho al instrumentation code. La idempotencia conservadora (no tocar lo que ya existe) es segura. El `--force` existe para cuando el usuario quiere resetear a los defaults del preset.

**Ejemplo:**

```typescript
// src/lib/preset-writer.ts
export async function writeIfNotExists(
  path: string,
  content: string,
  force: boolean
): Promise<'created' | 'skipped'> {
  const file = Bun.file(path);
  const exists = await file.exists();

  if (exists && !force) {
    return 'skipped';
  }

  await Bun.write(path, content);
  return 'created';
}
```

---

### D-07: Inyeccion de dependencias — modificacion de `package.json` del usuario

**Eleccion:** `vx init` modifica el `package.json` del directorio actual agregando las dependencias del preset a `dependencies`. Si el `package.json` no existe, se crea uno minimo. Si una dependencia ya existe con una version diferente, se respeta la version existente y se informa al usuario.

**Justificacion:** El agente necesita que las dependencias OTel esten en `package.json` para que `npm install` o `pnpm install` las instale. Agregar las dependencias automaticamente es mas util que decirle al usuario que las instale manualmente. Respetar versiones existentes evita downgrades accidentales.

**Ejemplo:**

```typescript
// src/lib/package-json.ts
export async function injectDependencies(
  deps: Record<string, string>,
  dev = false
): Promise<{ added: string[]; skipped: string[] }> {
  const pkgPath = join(process.cwd(), 'package.json');
  const file = Bun.file(pkgPath);
  const exists = await file.exists();

  const pkg = exists
    ? (await file.json() as Record<string, unknown>)
    : { name: 'my-app', version: '1.0.0' };

  const field = dev ? 'devDependencies' : 'dependencies';
  const existing = (pkg[field] as Record<string, string>) ?? {};

  const added: string[] = [];
  const skipped: string[] = [];

  for (const [name, version] of Object.entries(deps)) {
    if (existing[name]) {
      skipped.push(`${name}@${existing[name]} (keeping existing)`);
    } else {
      existing[name] = version;
      added.push(`${name}@${version}`);
    }
  }

  pkg[field] = existing;
  await Bun.write(pkgPath, JSON.stringify(pkg, null, 2) + '\n');

  return { added, skipped };
}
```

---

### D-08: Variables de entorno — archivo `.env.otel` separado del `.env` del usuario

**Eleccion:** Las variables de entorno OTel (`OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_SERVICE_NAME`, etc.) se documentan en un archivo `.env.otel` separado, con instrucciones para copiar al `.env` o `.env.local` del usuario. NO se modifica el `.env` existente.

**Justificacion:** Modificar el `.env` del usuario es intrusivo y puede sobreescribir valores existentes. Un archivo `.env.otel` separado es una referencia que el usuario puede revisar y copiar selectivamente. El agente puede leer este archivo para saber que variables configurar en el entorno del sandbox. Este patron es menos automatico pero mas seguro.

**Ejemplo:**

```bash
# .env.otel (generado por vx init)
# OpenTelemetry configuration for vx observability stack
# Copy these values to your .env or .env.local file

OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
OTEL_SERVICE_NAME=my-service
# Optional: enable detailed OTel SDK logs
# OTEL_LOG_LEVEL=debug
```

---

### D-09: Formato de archivos generados — TypeScript, no JavaScript

**Eleccion:** Todos los archivos de instrumentacion generados son `.ts` (TypeScript). No se generan archivos `.js` ni `.mjs`.

**Justificacion:** El contexto de uso es proyectos que ya usan TypeScript (Hono en Bun, Next.js). Generar `.js` en un proyecto TypeScript require configuracion adicional y es menos seguro. TypeScript permite que el usuario vea los tipos de los SDKs OTel y entienda como extender la instrumentacion. Bun y Next.js ambos transpilan TypeScript nativo.

---

### D-10: Deteccion automatica de preset — basada en `package.json` del usuario

**Eleccion:** Si no se especifica preset, `vx init` lee el `package.json` del directorio actual y detecta el preset por la presencia de dependencias: `hono` → preset hono, `next` → preset nextjs. Si no detecta ninguno, usa `generic`. Si detecta multiples (monorepo), pregunta al usuario con un prompt simple en stderr.

**Justificacion:** La deteccion automatica hace que `vx init` sea mas amigable para el agente: puede ejecutarlo sin saber el preset exacto. La logica de deteccion es simple y determinista — buscar keys en `dependencies` y `devDependencies`. El fallback a `generic` garantiza que el comando nunca falla por falta de deteccion.

**Ejemplo:**

```typescript
// src/presets/detect.ts
import { join } from 'path';

type PresetName = 'hono' | 'nextjs' | 'generic';

export async function detectPreset(): Promise<PresetName> {
  const pkgPath = join(process.cwd(), 'package.json');
  const file = Bun.file(pkgPath);

  if (!(await file.exists())) {
    return 'generic';
  }

  const pkg = await file.json() as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };

  const allDeps = {
    ...pkg.dependencies,
    ...pkg.devDependencies,
  };

  if ('hono' in allDeps) return 'hono';
  if ('next' in allDeps) return 'nextjs';
  return 'generic';
}
```

---

### D-11: Output de `vx init` — lista de archivos creados/saltados y siguiente paso

**Eleccion:** El output de `vx init` incluye: lista de archivos creados o saltados, lista de dependencias agregadas, y el siguiente paso exacto que el usuario debe ejecutar (`pnpm install` o `npm install`).

**Justificacion:** El agente necesita saber que acciones tomo `vx init` para decidir sus proximos pasos. Si el agente sabe que las dependencias fueron agregadas, sabe que debe ejecutar el package manager antes de intentar importar los SDKs OTel. El output estructurado en JSON (modo no-TTY) permite que el agente lo parsee sin regex.

**Ejemplo:**

```typescript
// Output JSON del agente:
{
  "preset": "hono",
  "files": [
    { "path": "instrumentation.ts", "action": "created" },
    { "path": ".env.otel", "action": "created" }
  ],
  "dependencies": {
    "added": ["@hono/otel@1.1.1", "@opentelemetry/api@1.9.0"],
    "skipped": []
  },
  "next_steps": [
    "pnpm install",
    "Add OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318 to your .env",
    "Import instrumentation.ts as the first import in your entry file",
    "Wrap your Hono app with instrument() from @hono/otel"
  ]
}
```

---

## Interfaz

```typescript
// src/commands/init.ts
export async function runInit(ctx: CommandContext): Promise<void>;

// src/presets/detect.ts
export async function detectPreset(): Promise<'hono' | 'nextjs' | 'generic'>;

// src/presets/hono.ts
export async function initHono(ctx: CommandContext): Promise<void>;

// src/presets/nextjs.ts
export async function initNextjs(ctx: CommandContext): Promise<void>;

// src/presets/generic.ts
export async function initGeneric(ctx: CommandContext): Promise<void>;

// src/lib/preset-writer.ts
export async function writeIfNotExists(
  path: string,
  content: string,
  force: boolean
): Promise<'created' | 'skipped'>;

// src/lib/package-json.ts
export async function injectDependencies(
  deps: Record<string, string>,
  dev?: boolean
): Promise<{ added: string[]; skipped: string[] }>;
```

---

## Reglas

1. El preset `hono` NUNCA incluye `@opentelemetry/auto-instrumentations-node`. Bun no lo soporta.
2. `vx init` no sobreescribe archivos existentes sin el flag `--force`.
3. `vx init` no modifica el `.env` del usuario. Solo crea `.env.otel` como referencia.
4. La deteccion de preset es siempre por `package.json` del directorio actual, no por imports en el codigo.
5. Todos los archivos generados son `.ts`, nunca `.js` o `.mjs`.
6. `vx init` modifica `package.json` del usuario agregando dependencias, pero respeta versiones existentes.
7. El output siempre incluye `next_steps` con las acciones exactas que el usuario/agente debe ejecutar.
8. Si se detecta monorepo (presencia de `workspaces` en package.json), se reporta warning y se usa `generic`.
9. Los archivos generados se escriben en el directorio actual (`process.cwd()`), no en `.vx/`.
10. Las versiones de los paquetes OTel inyectados son exactamente las del `stack-manifest.json`.
11. `vx snippet` imprime el bloque CLAUDE.md que el agente debe agregar a su contexto — es de solo lectura, no genera archivos.

---

## Ejemplos

```bash
# Deteccion automatica (tiene hono en package.json)
$ vx init
# detectado: hono
# {"preset":"hono","files":[{"path":"instrumentation.ts","action":"created"},{"path":".env.otel","action":"created"}],"dependencies":{"added":["@hono/otel@1.1.1","@opentelemetry/api@1.9.0","@opentelemetry/sdk-node@0.213.0"],"skipped":[]},"next_steps":["pnpm install","Add OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318 to your .env","Import instrumentation.ts as first import in your entry file"]}

# Preset explicito
$ vx init nextjs
# {"preset":"nextjs","files":[{"path":"instrumentation.ts","action":"created"}],"dependencies":{"added":["@vercel/otel@2.1.1","@opentelemetry/api@1.9.0"],"skipped":[]},...}

# Re-run (idempotente)
$ vx init hono
# {"preset":"hono","files":[{"path":"instrumentation.ts","action":"skipped"},{"path":".env.otel","action":"skipped"}],...}

# Forzar sobreescritura
$ vx init hono --force
# {"preset":"hono","files":[{"path":"instrumentation.ts","action":"created"},{"path":".env.otel","action":"created"}],...}

# Preset desconocido
# stderr: {"error":"unknown preset: express","detail":"Available presets: hono, nextjs, generic","code":1}
# exit: 1
```
