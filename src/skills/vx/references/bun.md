# Bun Template

Setup for Bun runtime apps. Key limitation: **no auto-instrumentations**.

## Why Bun is different

Bun does not support Node.js `diagnostics_channel`, which is the mechanism `@opentelemetry/auto-instrumentations-node` uses to monkey-patch libraries. This means:

- No automatic HTTP instrumentation
- No automatic DB instrumentation
- No automatic logger bridging

You must use explicit instrumentation (e.g., `@hono/otel` for Hono) and manual spans for business logic.

## Template: `instrumentation.ts` (app root)

```typescript
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
  // No auto-instrumentations — Bun lacks diagnostics_channel support
});

sdk.start();
process.on("beforeExit", () => sdk.shutdown());
```

**Note:** Use `beforeExit` instead of `SIGTERM` for Bun's lifecycle.

## Hono on Bun

For Hono apps on Bun, install `@hono/otel` for route-level tracing:

```typescript
import { instrument } from "@hono/otel";

const app = new Hono();
// ... routes ...

export default instrument(app);
```

This is the primary source of trace spans on Bun since auto-instrumentation is unavailable.

## Preload the instrumentation file

Bun uses `--preload` to load the instrumentation before the app:

```bash
bun run --preload ./instrumentation.ts src/index.ts
```

Or in `bunfig.toml`:

```toml
preload = ["./instrumentation.ts"]
```

Or in `package.json` scripts:

```json
{
  "scripts": {
    "dev": "bun run --preload ./instrumentation.ts src/index.ts"
  }
}
```

## Install dependencies

Before installing, look up the latest stable version of each package on npm. Do NOT use hardcoded versions — they go stale quickly. Use `npm view <package> version` or check the package's npm page.

```bash
bun add @hono/otel \
  @opentelemetry/api \
  @opentelemetry/sdk-node \
  @opentelemetry/exporter-trace-otlp-http \
  @opentelemetry/exporter-metrics-otlp-http \
  @opentelemetry/exporter-logs-otlp-http \
  @opentelemetry/resources \
  @opentelemetry/sdk-metrics \
  @opentelemetry/sdk-logs \
  @opentelemetry/semantic-conventions
```

**IMPORTANT:** NEVER add `@opentelemetry/auto-instrumentations-node` for Bun projects. It will fail at runtime.

## Logs on Bun

Since auto-instrumentation log bridges (Pino, Winston) don't work on Bun, you have two options for logs:

1. **Use `@opentelemetry/api` logs directly** — create a `LoggerProvider` and emit log records manually.
2. **Use a Pino transport** — `pino-opentelemetry-transport` runs in a worker thread and exports logs independently (does not require auto-instrumentation).

For option 2, see [log-bridges.md](log-bridges.md) under the "Bun alternative" section.
