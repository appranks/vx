# Log Bridges

How application loggers (Pino, Winston, Bunyan) forward logs to OpenTelemetry.

> **DEFAULT APPROACH:** Always use `pino-opentelemetry-transport` for Pino. Auto-instrumentation (`@opentelemetry/instrumentation-pino`) silently fails with ESM + tsx + pnpm, which covers most modern TypeScript projects. Only use auto-instrumentation if the project is confirmed CJS-only AND uses plain `node` (not tsx/ts-node).

## Two approaches

| Approach | How it works | When to use | Reliability |
|----------|-------------|-------------|-------------|
| **pino-opentelemetry-transport** (recommended) | Pino transport in a worker thread, sends to OTLP directly | ALL environments: ESM, CJS, tsx, Bun, pnpm, npm | Works everywhere |
| **Auto-instrumentation** (fallback) | `instrumentation-pino` monkey-patches Pino at import time | CJS-only projects using plain `node` (not tsx) | Breaks with ESM + tsx + pnpm |

## Approach 1: pino-opentelemetry-transport (recommended)

Works with ESM, tsx, Bun, pnpm — no dependency on auto-instrumentation hooks.

### Install

```bash
pnpm add pino-opentelemetry-transport
```

### Configure the logger

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

const logger = pino(
  {
    level: process.env.LOG_LEVEL ?? "info",
    // Trace correlation: inject trace_id/span_id from active span
    mixin() {
      const span = trace.getSpan(context.active());
      if (!span) return {};
      const { traceId, spanId, traceFlags } = span.spanContext();
      return { trace_id: traceId, span_id: spanId, trace_flags: traceFlags };
    },
  },
  // Send to both stdout and OTel
  pino.multistream([{ stream: process.stdout }, { stream: otelTransport }]),
);
```

### How it works

1. **Log sending**: The transport runs in a Pino worker thread. It reads `OTEL_EXPORTER_OTLP_ENDPOINT` automatically and sends logs via OTLP HTTP/protobuf to the collector.
2. **Trace correlation**: The `mixin()` function reads the active span from `@opentelemetry/api` (which uses AsyncLocalStorage). The `trace_id` and `span_id` are added to every log record emitted within a traced request. The transport reads these fields and attaches them to the OTel LogRecord context.
3. **Dual output**: `pino.multistream()` sends logs to both stdout (for local dev) and the OTel transport (for vx).

### Required env vars

The transport worker thread reads these automatically:

```bash
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318   # Collector endpoint
OTEL_SERVICE_NAME=my-service                         # Service identity
```

**Why the transport needs its own env vars:** The transport runs in a Pino worker thread — a separate Node.js worker. It does not share memory with the main thread's NodeSDK instance. It discovers the collector endpoint by reading `OTEL_EXPORTER_OTLP_ENDPOINT` from `process.env` inside the worker. If this variable is not set, the transport defaults to `http://localhost:4318` which is correct for vx, but if the app's env loading mechanism (like `dotenv`) runs only in the main thread, the worker thread won't see custom env values. Always set OTel env vars in the actual env file, not programmatically.

### Severity mapping

| Pino Level | Pino Number | OTel Severity |
|------------|-------------|---------------|
| trace | 10 | TRACE |
| debug | 20 | DEBUG |
| info | 30 | INFO |
| warn | 40 | WARN |
| error | 50 | ERROR |
| fatal | 60 | FATAL |

## Disabling auto-instrumentation log sending when using the transport

If you use `pino-opentelemetry-transport` AND the project has `@opentelemetry/auto-instrumentations-node`, disable `instrumentation-pino`'s log sending to avoid duplicate logs:

```typescript
// In tracing.ts
getNodeAutoInstrumentations({
  "@opentelemetry/instrumentation-fs": { enabled: false },
  "@opentelemetry/instrumentation-dns": { enabled: false },
  "@opentelemetry/instrumentation-net": { enabled: false },
  "@opentelemetry/instrumentation-pino": { disableLogSending: true },
}),
```

This is already handled in the [node.md](node.md) template. If modifying an existing tracing file, add `disableLogSending: true` for the pino instrumentation.

## Approach 2: Auto-instrumentation (CJS only)

`@opentelemetry/auto-instrumentations-node` includes logger instrumentations enabled by default:

| Logger | Instrumentation |
|--------|----------------|
| Pino | `@opentelemetry/instrumentation-pino` |
| Winston | `@opentelemetry/instrumentation-winston` |
| Bunyan | `@opentelemetry/instrumentation-bunyan` |

### Requirements

1. `logRecordProcessors` configured in the NodeSDK (see [signals.md](signals.md))
2. The tracing file imported **before** the logger
3. **CJS module system** (CommonJS) — NOT ESM

No changes to the logger code are needed with this approach.

### Why auto-instrumentation fails with ESM + tsx + pnpm

Three independent issues combine to break it:

1. **ESM skips `require()`** — `instrumentation-pino` hooks into `require()` via `require-in-the-middle`. ESM imports don't trigger `require()`. Core modules (http, https) always use `require()` internally, which is why `instrumentation-http` works but `instrumentation-pino` doesn't.

2. **tsx conflicts with `import-in-the-middle`** — Both tsx and OTel's ESM support register `module.register()` hooks. These hooks run in LIFO order and conflict. tsx transforms `.ts` → `.js` before OTel's hook can intercept the module by name.

3. **pnpm symlinks affect module name matching** — `import-in-the-middle` matches by module name (`"pino"`), but pnpm resolves to real paths inside `.pnpm/` store. The name matching can fail.

**Bottom line:** If you use ESM + tsx, auto-instrumentation for user-land packages (pino, express, pg) will silently fail. Use the transport approach instead.

## Common issues

| Issue | Cause | Fix |
|-------|-------|-----|
| Logs not appearing in vx | Transport can't reach collector | Set `OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318` in env |
| Logs appear but no `trace_id` | Missing `mixin()` in Pino config | Add the `mixin()` function that reads active span context |
| Duplicate logs in vx | Both auto-instrumentation AND transport active | Disable auto-instrumentation: `"@opentelemetry/instrumentation-pino": { disableLogSending: true }` |
| No logs with ESM + tsx | Auto-instrumentation doesn't work with ESM | Switch to `pino-opentelemetry-transport` approach |
