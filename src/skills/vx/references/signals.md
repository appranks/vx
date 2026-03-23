# The Three Signals

OpenTelemetry defines three observability signals. The vx stack receives and stores all three. A complete setup exports **all of them**.

## What each signal provides

| Signal | What it captures | Example data |
|--------|-----------------|--------------|
| **Traces** | Request flow across services, latency per operation | `GET /api/projects → 45ms`, `db.query → 12ms` |
| **Metrics** | Numeric measurements over time | `http.server.request.duration`, `nodejs.event_loop.utilization` |
| **Logs** | Structured application log records | `{"level":"info","msg":"Run completed","runId":"abc"}` |

## How each signal is configured in NodeSDK

The `NodeSDK` constructor accepts properties for each signal:

```typescript
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { BatchLogRecordProcessor } from "@opentelemetry/sdk-logs";

const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? "http://localhost:4318";

new NodeSDK({
  // Signal 1: Traces
  traceExporter: new OTLPTraceExporter({
    url: `${endpoint}/v1/traces`,
  }),

  // Signal 2: Metrics
  metricReaders: [
    new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter({
        url: `${endpoint}/v1/metrics`,
      }),
      exportIntervalMillis: 15_000,
    }),
  ],

  // Signal 3: Logs
  logRecordProcessors: [
    new BatchLogRecordProcessor(
      new OTLPLogExporter({
        url: `${endpoint}/v1/logs`,
      }),
    ),
  ],
});
```

**Note:** Use the plural properties (`metricReaders`, `logRecordProcessors`) — the singular forms are deprecated.

## How each signal is configured in @vercel/otel

The `registerOTel()` function accepts the same metric/log properties (undocumented but functional):

```typescript
import { registerOTel } from "@vercel/otel";

registerOTel({
  serviceName: "my-app",
  metricReaders: [/* same as NodeSDK */],
  logRecordProcessors: [/* same as NodeSDK */],
});
```

See [nextjs.md](nextjs.md) for the complete Next.js template with dynamic imports.

## What auto-instrumentations produce

When using `@opentelemetry/auto-instrumentations-node`:

| Instrumentation | Traces | Metrics | Logs |
|----------------|--------|---------|------|
| `instrumentation-http` | HTTP server/client spans | `http.server.request.duration`, `http.client.request.duration` | — |
| `instrumentation-runtime-node` | — | Event loop utilization | — |
| `instrumentation-pino` | — | — | **CJS only** — fails with ESM + tsx + pnpm |
| `instrumentation-winston` | — | — | Forwards winston log records to OTel Logs SDK |
| `instrumentation-bunyan` | — | — | Forwards bunyan log records to OTel Logs SDK |
| `instrumentation-pg` | DB query spans | — | — |
| `instrumentation-undici` | fetch() spans | — | — |
| All others (30+) | Various spans | — | — |

**Key insight:** Metrics require the exporter config in the SDK AND auto-instrumentations that produce metrics. Logs require `logRecordProcessors` in the SDK AND a log source. For Pino logs, use `pino-opentelemetry-transport` (works everywhere) rather than `instrumentation-pino` (breaks with ESM + tsx + pnpm). See [node.md](node.md#template-srcloggerts) for the logger template and [log-bridges.md](log-bridges.md) for details.

## Completing an incomplete setup

If existing OTel only has traces, add the missing exporters:

### Adding metrics to existing NodeSDK

```typescript
// Add these imports
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";

// Add to NodeSDK config
metricReaders: [
  new PeriodicExportingMetricReader({
    exporter: new OTLPMetricExporter({
      url: `${endpoint}/v1/metrics`,
    }),
    exportIntervalMillis: 15_000,
  }),
],
```

### Adding logs to existing NodeSDK

```typescript
// Add these imports
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { BatchLogRecordProcessor } from "@opentelemetry/sdk-logs";

// Add to NodeSDK config
logRecordProcessors: [
  new BatchLogRecordProcessor(
    new OTLPLogExporter({
      url: `${endpoint}/v1/logs`,
    }),
  ),
],
```

**Note:** Adding `logRecordProcessors` to the SDK is only half of the log setup. You also need to configure the application logger (Pino) to send logs through the transport. See [node.md](node.md#template-srcloggerts) for the `logger.ts` template.

### Dependencies for all 3 signals

```bash
# Core (required for all)
@opentelemetry/api@1.9.0
@opentelemetry/sdk-node@0.213.0
@opentelemetry/resources@2.0.0
@opentelemetry/semantic-conventions@1.35.0

# Traces
@opentelemetry/exporter-trace-otlp-http@0.213.0

# Metrics
@opentelemetry/exporter-metrics-otlp-http@0.213.0
@opentelemetry/sdk-metrics@2.0.0

# Logs
@opentelemetry/exporter-logs-otlp-http@0.213.0
@opentelemetry/sdk-logs@0.213.0

# Auto-instrumentation (Node.js only, NOT Bun)
@opentelemetry/auto-instrumentations-node@0.71.0

# Pino log transport (if app uses Pino)
pino-opentelemetry-transport
```
