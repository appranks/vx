# Diagnostics

Troubleshooting guide when telemetry is not appearing in vx.

## Quick checklist

Run these checks in order. Stop at the first failure.

### 1. Is the vx stack running?

```bash
npx vx status
```

Expected: all 4 services `healthy` (victoria-metrics, victoria-logs, victoria-traces, otel-collector).

If not:
```bash
npx vx up
```

If `vx up` fails, check Docker is running: `docker info`.

### 2. Is the OTel Collector reachable?

```bash
curl -s http://localhost:13133/ | head -1
```

Expected: HTTP 200. This is the collector's health endpoint.

If unreachable: the collector container may have crashed. Check logs:
```bash
docker logs vx-otel-collector-1
```

### 3. Is the tracing/instrumentation file loaded?

| Runtime | Check |
|---------|-------|
| Node.js | `import "./tracing.js"` or `import "./tracing"` is the **first line** in the entry file |
| Bun | `--preload ./instrumentation.ts` in the start script, or `preload` in `bunfig.toml` |
| Next.js | `instrumentation.ts` exists in the app root (next to `next.config.ts`) with an exported `register()` function |

Common mistake: importing `tracing.ts` AFTER other libraries. The import must be first.

### 4. Is the exporter URL correct?

Check that the OTLP endpoint resolves to `http://localhost:4318`:

- **Env var**: `OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318` in the app's env file
- **Code**: hardcoded URL or env var with default to `http://localhost:4318`

Common mistake: using gRPC port `:4317` instead of HTTP port `:4318`.

### 5. Are all 3 signals configured?

Read the tracing/instrumentation file and verify:

| Signal | NodeSDK property | Present? |
|--------|-----------------|----------|
| Traces | `traceExporter` | Check for `OTLPTraceExporter` |
| Metrics | `metricReaders` | Check for `PeriodicExportingMetricReader` + `OTLPMetricExporter` |
| Logs | `logRecordProcessors` | Check for `BatchLogRecordProcessor` + `OTLPLogExporter` |

If any are missing, add them. See [signals.md](signals.md) for the exact code.

### 6. Is the logger sending to OTel?

If the app uses Pino but logs don't appear in vx:

**If using `pino-opentelemetry-transport` (recommended):**

1. Verify `pino-opentelemetry-transport` is installed: check `package.json` dependencies
2. Verify `OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318` is set in the env file (the transport worker thread reads it from env, NOT from the NodeSDK)
3. Verify the logger uses `pino.multistream()` with the OTel transport as a stream
4. Verify `logRecordProcessors` exists in the NodeSDK config (in `tracing.ts`)
5. Check for duplicate log sending: if auto-instrumentations are also active, ensure `"@opentelemetry/instrumentation-pino": { disableLogSending: true }` is set

**If using auto-instrumentation (CJS only):**

1. Verify the project is NOT using ESM (`"type": "module"` in package.json means ESM)
2. Verify the project is NOT using tsx as the runner
3. Verify the logger is instantiated AFTER `tracing.ts` is imported
4. Verify `logRecordProcessors` exists in the NodeSDK config
5. If ANY of the above fail → switch to `pino-opentelemetry-transport` approach (see [node.md](node.md#template-srcloggerts))

### 7. Enable OTel debug logging

Set in the app's environment and restart:

```bash
OTEL_LOG_LEVEL=debug
```

Check stderr for messages like:
- `@opentelemetry/sdk-node - starting` — SDK initialized
- `@opentelemetry/exporter-trace-otlp-http - exporting` — traces being sent
- `@opentelemetry/exporter-metrics-otlp-http - exporting` — metrics being sent
- `@opentelemetry/sdk-logs - exporting` — logs being sent

If you see export errors, the collector may not be accepting the signal.

## Signal-specific diagnosis

### Traces present, metrics missing

Metrics are exported on a timer (`exportIntervalMillis`, default 15s). Wait at least 30 seconds after app start before checking.

If still missing:
- Verify `metricReaders` (plural) is set in NodeSDK config
- Check that `@opentelemetry/sdk-metrics` and `@opentelemetry/exporter-metrics-otlp-http` are installed

### Traces present, logs missing

This is the most common issue. Logs require ALL of:

1. `logRecordProcessors` in the SDK config (`tracing.ts`)
2. A log transport configured in the logger (`logger.ts` with `pino-opentelemetry-transport`)
3. `OTEL_EXPORTER_OTLP_ENDPOINT` set in the env file (for the transport worker thread)

**Most common cause:** The SDK was configured with `logRecordProcessors` but the Pino logger was NOT configured with the transport. The SDK log pipeline is ready but receives no application logs because the logger doesn't know about it.

**Fix:** Configure `pino-opentelemetry-transport` in the Pino logger as shown in [node.md](node.md#template-srcloggerts). Ensure the env var is set.

If the app has no logger (no Pino/Winston/Bunyan), logs will only appear from OTel-native sources. Most server apps need a structured logger to produce useful log data.

### No data at all

1. Generate traffic (e.g., `curl http://localhost:PORT/health`)
2. Wait 15 seconds
3. Re-query: `npx vx traces '*'`

If still nothing:
- The app may not be receiving requests (check port, network)
- The SDK may have failed to start (check stderr for errors)
- Dependencies may be missing or wrong version (check `node_modules`)
