# Environment Variables

Complete reference for OpenTelemetry environment variables used with vx.

## Required

| Variable | Value | Purpose |
|----------|-------|---------|
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `http://localhost:4318` | Base URL for all OTLP HTTP exporters |
| `OTEL_SERVICE_NAME` | e.g., `my-api`, `my-web` | Identifies the service in traces, metrics, and logs |

## Worker thread considerations

`pino-opentelemetry-transport` runs in a Pino worker thread — a separate Node.js `Worker` instance. This worker thread:

1. **Does NOT inherit** configuration from the NodeSDK instance in the main thread
2. **Does inherit** environment variables from the parent process (`process.env`)
3. **Reads `OTEL_EXPORTER_OTLP_ENDPOINT`** to know where to send logs
4. **Reads `OTEL_SERVICE_NAME`** via `resourceAttributes` in the transport options

This means `OTEL_EXPORTER_OTLP_ENDPOINT` is doubly important when using Pino:
- The **main thread NodeSDK** uses it for traces and metrics
- The **worker thread transport** uses it for logs

If the env var is only set in code (e.g., `process.env.OTEL_EXPORTER_OTLP_ENDPOINT = "..."` at runtime), it may not propagate to the worker thread depending on when the transport is created. **Always set it in the env file** to guarantee both threads see it.

## Optional

| Variable | Default | Purpose |
|----------|---------|---------|
| `OTEL_LOG_LEVEL` | `info` | OTel SDK log level. Set to `debug` for troubleshooting |
| `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` | `${OTEL_EXPORTER_OTLP_ENDPOINT}/v1/traces` | Override traces endpoint |
| `OTEL_EXPORTER_OTLP_METRICS_ENDPOINT` | `${OTEL_EXPORTER_OTLP_ENDPOINT}/v1/metrics` | Override metrics endpoint |
| `OTEL_EXPORTER_OTLP_LOGS_ENDPOINT` | `${OTEL_EXPORTER_OTLP_ENDPOINT}/v1/logs` | Override logs endpoint |
| `OTEL_TRACES_SAMPLER` | `parentbased_always_on` | Sampling strategy. Use `always_on` for dev |
| `OTEL_METRICS_EXPORT_INTERVAL` | `60000` | Metric export interval in ms. Templates use `15000` for dev |
| `LOG_LEVEL` | `info` | App-level Pino log level (read by logger.ts independently) |

## Env file detection rules

The skill detects which env file to use per app, in this order:

1. `.env.local` exists → use it (common in Next.js projects)
2. `.env.development` exists → use it (common in multi-environment setups)
3. `.env` exists → use it (single env file projects)
4. None exist → create `.env.local`

## Template

Add these lines to the detected env file:

```bash
# OpenTelemetry — vx observability
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
OTEL_SERVICE_NAME=<service-name>
```

Replace `<service-name>` with the actual service name (e.g., `my-api`, `my-web`).

## Monorepo considerations

Each app in a monorepo should have:
- Its own `OTEL_SERVICE_NAME` (distinct per app)
- The same `OTEL_EXPORTER_OTLP_ENDPOINT` (all point to `localhost:4318`)

If apps share an env file (e.g., root `.env`), the service name should be set in code with a fallback:

```typescript
process.env.OTEL_SERVICE_NAME ?? "my-default-name"
```
