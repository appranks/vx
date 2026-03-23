# Node.js Template

Two files to configure for Node.js apps: `tracing.ts` (OTel SDK — traces, metrics, log pipeline) and `logger.ts` (Pino transport — sends application logs to OTel).

**Both files are required for full observability.** The SDK alone configures the pipeline but produces no application logs. The logger produces logs but needs the pipeline to export them.

## Template: `src/tracing.ts`

```typescript
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { BatchLogRecordProcessor } from "@opentelemetry/sdk-logs";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";

const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? "http://localhost:4318";

const sdk = new NodeSDK({
  resource: resourceFromAttributes({
    [ATTR_SERVICE_NAME]: process.env.OTEL_SERVICE_NAME ?? "my-service",
  }),
  traceExporter: new OTLPTraceExporter({
    url: `${endpoint}/v1/traces`,
  }),
  metricReaders: [
    new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter({
        url: `${endpoint}/v1/metrics`,
      }),
      exportIntervalMillis: 15_000,
    }),
  ],
  logRecordProcessors: [
    new BatchLogRecordProcessor(
      new OTLPLogExporter({
        url: `${endpoint}/v1/logs`,
      }),
    ),
  ],
  instrumentations: [
    getNodeAutoInstrumentations({
      "@opentelemetry/instrumentation-fs": { enabled: false },
      "@opentelemetry/instrumentation-dns": { enabled: false },
      "@opentelemetry/instrumentation-net": { enabled: false },
      // Disable auto log sending — we use pino-opentelemetry-transport instead
      "@opentelemetry/instrumentation-pino": { disableLogSending: true },
    }),
  ],
});

sdk.start();
process.on("SIGTERM", () => sdk.shutdown());
```

## Template: `src/logger.ts`

Configures Pino to send logs to the OTel collector via `pino-opentelemetry-transport`. Uses `multistream` for dual output (stdout + OTel).

```typescript
import { context, trace } from "@opentelemetry/api";
import pino from "pino";

const otelTransport = pino.transport({
  target: "pino-opentelemetry-transport",
  options: {
    resourceAttributes: {
      "service.name": process.env.OTEL_SERVICE_NAME ?? "my-service",
    },
  },
});

export const logger = pino(
  {
    level: process.env.LOG_LEVEL ?? "info",
    // Inject trace context into every log record for correlation
    mixin() {
      const span = trace.getSpan(context.active());
      if (!span) return {};
      const { traceId, spanId, traceFlags } = span.spanContext();
      return { trace_id: traceId, span_id: spanId, trace_flags: traceFlags };
    },
  },
  pino.multistream([
    { stream: process.stdout },
    { stream: otelTransport },
  ]),
);
```

### How it works

1. **`pino-opentelemetry-transport`** runs in a Pino worker thread. It reads `OTEL_EXPORTER_OTLP_ENDPOINT` from the process environment and sends logs via OTLP HTTP to the collector. It does NOT use the NodeSDK's configuration — it connects independently.
2. **`mixin()`** reads the active span from `@opentelemetry/api` context (uses AsyncLocalStorage). Every log record emitted within a traced request gets `trace_id` and `span_id` fields. This enables log-to-trace correlation in vx.
3. **`pino.multistream()`** sends logs to both stdout (for terminal output) and the OTel transport (for vx).

### Why NOT auto-instrumentation for logs

`@opentelemetry/instrumentation-pino` (included in auto-instrumentations) works by monkey-patching Pino at import time. This silently fails when:
- The project uses ESM (`"type": "module"` in package.json)
- The project uses tsx as the TypeScript runner
- The project uses pnpm (symlink resolution breaks module name matching)

Since most modern TypeScript projects use some combination of these, the transport approach is the only reliable method. See [log-bridges.md](log-bridges.md) for details.

### Required env vars for the transport

The transport worker thread reads these from the process environment:

```bash
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318   # Where to send logs
OTEL_SERVICE_NAME=my-service                         # Service identity in log records
```

**CRITICAL:** These MUST be set in the app's env file. The transport runs in a separate worker thread and does NOT inherit configuration from the NodeSDK instance.

## Framework variations

| Framework | Service name | Entry file | Tracing import | Logger import |
|-----------|-------------|------------|----------------|---------------|
| Hono (Node) | `my-hono-api` | `src/index.ts` | `import "./tracing.js";` first line | `import { logger } from "./logger.js";` |
| NestJS | `my-nestjs-api` | `src/main.ts` | `import "./tracing.js";` first line | `import { logger } from "./logger.js";` |
| Express | `my-express-api` | `src/app.ts` | `import "./tracing.js";` first line | `import { logger } from "./logger.js";` |
| Fastify | `my-fastify-api` | `src/server.ts` | `import "./tracing.js";` first line | `import { logger } from "./logger.js";` |
| Generic | `my-service` | Entry file | `import "./tracing.js";` first line | `import { logger } from "./logger.js";` |

Replace `my-service` with the actual service name. The tracing import MUST be the first line in the entry file. The logger import can be anywhere after.

## Extra: Hono on Node

If the framework is Hono running on Node, also install `@hono/otel` and wrap the app:

```typescript
import { instrument } from "@hono/otel";

const app = new Hono();
// ... routes ...

export default instrument(app);
```

This adds middleware-level route tracing on top of the auto-instrumentation (HTTP, DB, etc.).

## Install dependencies

Run inside the app directory using the project's package manager:

```bash
# pnpm (monorepo)
pnpm add @opentelemetry/api@1.9.0 \
  @opentelemetry/sdk-node@0.213.0 \
  @opentelemetry/auto-instrumentations-node@0.71.0 \
  @opentelemetry/exporter-trace-otlp-http@0.213.0 \
  @opentelemetry/exporter-metrics-otlp-http@0.213.0 \
  @opentelemetry/exporter-logs-otlp-http@0.213.0 \
  @opentelemetry/resources@2.0.0 \
  @opentelemetry/sdk-metrics@2.0.0 \
  @opentelemetry/sdk-logs@0.213.0 \
  @opentelemetry/semantic-conventions@1.35.0

# If app uses Pino (required for logger.ts):
pnpm add pino-opentelemetry-transport

# For Hono on Node, also:
pnpm add @hono/otel@1.1.1
```

For npm: replace `pnpm add` with `npm install`.
For yarn: replace `pnpm add` with `yarn add`.

## Critical: import order

`tracing.ts` must be imported **before** any instrumented library (HTTP, pg, etc.). This ensures the monkey-patching hooks are registered before the libraries load.

`logger.ts` can be imported after `tracing.ts` — the transport connects independently, not through auto-instrumentation hooks.

```typescript
// src/index.ts
import "./tracing.js";                // FIRST — registers all instrumentations
import { Hono } from "hono";          // After — gets instrumented
import { logger } from "./logger.js"; // After — connects via transport, not monkey-patching
```

## If the app already has a Pino logger

Do NOT create a new `logger.ts`. Instead, modify the existing logger to add the OTel transport and mixin:

1. Add `pino-opentelemetry-transport` as a dependency
2. Add the `mixin()` function for trace correlation
3. Change the stream to `pino.multistream()` with both stdout and the OTel transport

If the existing logger uses `pino.transport()` already (single transport), switch to `pino.multistream()` to add the OTel transport alongside.

If the existing logger uses a custom destination (e.g., `pino.destination('./app.log')`), add the OTel transport as a second stream via multistream.
