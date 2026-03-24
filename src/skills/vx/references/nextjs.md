# Next.js Template

Complete `instrumentation.ts` for Next.js apps with all three signals using `@vercel/otel`.

## Template: `instrumentation.ts` (app root)

```typescript
import { registerOTel } from "@vercel/otel";

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") {
    // Edge runtime: traces only (metrics/logs SDKs are Node-only)
    registerOTel({
      serviceName: process.env.OTEL_SERVICE_NAME ?? "my-nextjs-app",
    });
    return;
  }

  // Node runtime: all 3 signals
  const { OTLPMetricExporter } = await import(
    "@opentelemetry/exporter-metrics-otlp-http"
  );
  const { OTLPLogExporter } = await import(
    "@opentelemetry/exporter-logs-otlp-http"
  );
  const { PeriodicExportingMetricReader } = await import(
    "@opentelemetry/sdk-metrics"
  );
  const { BatchLogRecordProcessor } = await import("@opentelemetry/sdk-logs");

  const endpoint =
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? "http://localhost:4318";

  registerOTel({
    serviceName: process.env.OTEL_SERVICE_NAME ?? "my-nextjs-app",
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
  });
}
```

## Why dynamic imports?

Next.js has two runtimes: `nodejs` (default) and `edge`. The OTel SDK packages (`@opentelemetry/sdk-metrics`, `@opentelemetry/sdk-logs`) depend on Node.js APIs that don't exist in Edge.

Using `await import()` ensures the bundler only includes these modules in the Node.js bundle. The `NEXT_RUNTIME` env var is set automatically by Next.js.

## Why `register()` is async

Next.js `instrumentation.ts` supports async `register()` functions. The dynamic imports require `await`, so the function must be `async`.

## How @vercel/otel handles traces

`@vercel/otel` automatically configures the trace exporter using the `OTEL_EXPORTER_OTLP_ENDPOINT` environment variable. You don't need to create a `OTLPTraceExporter` manually — it's handled internally. The `metricReaders` and `logRecordProcessors` are the only additions needed.

## Install dependencies

Run inside the Next.js app directory. Before installing, look up the latest stable version of each package on npm. Do NOT use hardcoded versions — they go stale quickly. Use `npm view <package> version` or check the package's npm page.

```bash
pnpm add @vercel/otel \
  @opentelemetry/api \
  @opentelemetry/exporter-metrics-otlp-http \
  @opentelemetry/exporter-logs-otlp-http \
  @opentelemetry/sdk-metrics \
  @opentelemetry/sdk-logs
```

## What gets instrumented

- **Server Components**: Run in Node.js runtime — all 3 signals work.
- **Route Handlers**: Run in Node.js runtime — all 3 signals work.
- **Middleware**: Runs in Edge runtime — traces only.
- **Client Components**: No server-side telemetry (browser-side OTel is out of scope).
- **`fetch()` calls**: Automatically instrumented by `@vercel/otel` with span propagation.

## File location

`instrumentation.ts` must be in the **app root** (next to `next.config.ts`), NOT inside `src/`. Next.js auto-discovers it at startup.

## Logs in Next.js

Next.js apps typically use `console.log()` which is NOT captured by OpenTelemetry. This means:

- **No logger detected** (no Pino, Winston, Bunyan in dependencies) → logs in vx will only contain OTel-native log records (from `logRecordProcessors`). This is the expected behavior for most Next.js apps.
- **App uses Pino explicitly** (e.g., in Route Handlers or Server Actions) → configure `pino-opentelemetry-transport` as described in [node.md](node.md#template-srcloggerts). The `logger.ts` template applies.
- **App uses `@vercel/otel` + `console` instrumentation** → Not supported. Console calls don't produce structured log records compatible with OTel.

**Bottom line:** For Next.js apps, traces and metrics are the primary signals. Logs only flow if the app explicitly uses a structured logger like Pino with the OTel transport configured.
