---
name: vx
description: Configure and verify OpenTelemetry instrumentation so this project sends traces, metrics, and logs to the vx observability stack. Use when setting up observability or when telemetry is not flowing.
---

# vx — OpenTelemetry Setup & Verification

Configure OpenTelemetry to send **all three signals** (traces, metrics, logs) to the vx stack at `http://localhost:4318`, then verify telemetry flows correctly.

## Phase 1: Analyze the project

1. Detect project type:
   - `package.json` → JavaScript/TypeScript
   - `go.mod` → Go (see note below)
   - `pyproject.toml` or `requirements.txt` → Python (see note below)
   - If not JS/TS: report "Only JavaScript/TypeScript is supported. Manual setup required." and stop.
2. Check for monorepo: `workspaces` in `package.json`, `pnpm-workspace.yaml`, or `lerna.json`.
3. If monorepo: identify app directories (typically `apps/*`, `services/*`, or `packages/` with servers).
4. For each app (or root if single-package):
   - **Framework**: detect from dependencies — `@nestjs/core`, `hono`, `next`, `express`, `fastify`, `@temporalio/worker`
   - **Runtime**: `bun` in devDependencies or `bunfig.toml` exists → Bun. Otherwise → Node.
   - **Logger**: detect from dependencies — `pino`, `winston`, `bunyan`
   - **Existing OTel**: grep for `@opentelemetry`, `OTLPTraceExporter`, `NodeSDK`, `registerOTel`, `@hono/otel` in source files. Check for `tracing.ts`, `instrumentation.ts`, or `telemetry.ts` files.
   - If found: read the file and note which signals are configured (trace exporter, metric reader, log processor).
5. Detect env file pattern per app:
   - `.env.local` exists → use `.env.local`
   - `.env.development` exists → use `.env.development`
   - `.env` exists → use `.env`
   - None exist → create `.env.local`
6. Detect packages/libraries in the monorepo that are NOT apps but contain business logic (SDK wrappers, DB layers, etc.).

## Phase 2: Configure per app

### Step 1: Apply OTel SDK template

Apply the FIRST matching rule:

| Condition                                           | Action                                                                                  |
| --------------------------------------------------- | --------------------------------------------------------------------------------------- |
| OTel exists with all 3 signals exporting to `:4318` | Report: "Fully configured. No changes needed."                                          |
| OTel exists but missing signals (e.g., only traces) | Complete the setup — see [references/signals.md](references/signals.md) for what to add |
| OTel exists but exports to different URL            | Set `OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318` in the detected env file        |
| No OTel AND Next.js                                 | Apply template from [references/nextjs.md](references/nextjs.md)                        |
| No OTel AND Bun runtime                             | Apply template from [references/bun.md](references/bun.md)                              |
| No OTel AND Node runtime                            | Apply template from [references/node.md](references/node.md)                            |

### Step 2: Configure the application logger for log sending

After applying the SDK template, if the app uses a logger, the logger MUST be configured to send logs to OTel. The SDK's `tracing.ts` alone does NOT produce application logs — it only configures the log pipeline. The logger itself needs a transport.

| Condition                       | Action                                                                                                             |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| App uses Pino                   | **Configure `pino-opentelemetry-transport`** — see the logger template in [references/node.md](references/node.md) |
| App uses Winston                | Configure Winston OTel transport — see [references/log-bridges.md](references/log-bridges.md)                      |
| App uses Bunyan                 | Configure Bunyan OTel transport — see [references/log-bridges.md](references/log-bridges.md)                       |
| App has NO logger               | `logRecordProcessors` in the SDK is sufficient — only OTel-native log records will flow                            |
| Next.js without explicit logger | Logs from `console.log` are NOT captured. This is expected — see [references/nextjs.md](references/nextjs.md)      |

**CRITICAL:** Do NOT rely on `@opentelemetry/instrumentation-pino` for log bridging. It fails silently with ESM + tsx + pnpm. Always use the explicit transport approach shown in node.md.

### Step 3: Additional recommendations

| Condition                              | Action                                                                                |
| -------------------------------------- | ------------------------------------------------------------------------------------- |
| Monorepo has library packages with I/O | Recommend manual spans — see [references/manual-spans.md](references/manual-spans.md) |

### After applying changes

1. Set env vars in the detected env file — see [references/env-vars.md](references/env-vars.md)
2. **If using Pino:** verify that `OTEL_EXPORTER_OTLP_ENDPOINT` is set in the env file (required by the transport worker thread — it does NOT inherit from the NodeSDK)
3. Install all added dependencies (both OTel SDK packages AND `pino-opentelemetry-transport` if applicable)
4. Run the project's type checker (`tsc --noEmit`, `bun run check`, etc.)
5. Proceed to Phase 3 (Verify).

## Phase 3: Verify

### Step 1 — Check vx stack

```bash
npx vx status
```

- All services `healthy` → proceed.
- Any `unreachable` → run `npx vx up`, wait, re-check.
- `vx up` fails → report error and stop.

### Step 2 — Ensure app is running

- Detect start command from `package.json` scripts (`dev`, `start`).
- Check if the app's port responds to HTTP.
- If not running: ask the user to start it in a separate terminal.

### Step 3 — Query telemetry

Wait ~20 seconds after the app starts (metrics flush every 15s, log batches every 5s), then:

```bash
npx vx traces '*'
npx vx metrics '{__name__=~".+"}'
npx vx logs '*'
```

### Step 4 — Report

For each signal, report:

| Signal  | Result                    | Details                          |
| ------- | ------------------------- | -------------------------------- |
| Traces  | Found N spans / No data   | Show sample span if found        |
| Metrics | Found N series / No data  | Show sample metric name if found |
| Logs    | Found N entries / No data | Show sample log message if found |

Evaluate result:

- **All 3 signals return data** → SUCCESS
- **Some signals return data** → PARTIAL — explain which are missing and run diagnostics for the missing signal from [references/diagnostics.md](references/diagnostics.md)
- **No signals return data** → FAIL — run full diagnostics from [references/diagnostics.md](references/diagnostics.md)

### Step 5 — Coverage checklist

Present a final summary table per app:

```
| Check                              | Status |
|------------------------------------|--------|
| tracing.ts / instrumentation.ts    | ✓ / ✗  |
| Trace exporter configured          | ✓ / ✗  |
| Metric reader configured           | ✓ / ✗  |
| Log processor configured           | ✓ / ✗  |
| Logger transport (Pino/Winston)    | ✓ / ✗ / N/A |
| Trace correlation (mixin)          | ✓ / ✗ / N/A |
| Env vars set                       | ✓ / ✗  |
| Type check passes                  | ✓ / ✗  |
| Traces verified in vx              | ✓ / ✗  |
| Metrics verified in vx             | ✓ / ✗  |
| Logs verified in vx                | ✓ / ✗  |
```

**Coverage score:** Count ✓ items / total applicable items (exclude N/A). Report as percentage.

## Rules

1. NEVER overwrite an existing tracing/instrumentation file. Analyze it — don't replace it.
2. NEVER remove existing OTel configuration or dependencies.
3. If existing OTel already has all 3 signals pointing to `:4318`, do NOTHING.
4. Prefer environment variables over hardcoded URLs.
5. Bun runtime NEVER gets `@opentelemetry/auto-instrumentations-node`.
6. The OTLP endpoint is always `http://localhost:4318` (HTTP, not gRPC).
7. For monorepos: handle each app independently. Report findings per workspace.
8. Install dependencies inside each app workspace, not in the monorepo root.
9. When adding dependencies, respect existing versions — never downgrade.
10. After any code change, verify it compiles (run type checker).
11. Detect and follow the project's env file pattern. Never hardcode which env file to use.
12. All three signals must be configured. Traces-only is incomplete.
13. Library packages use `@opentelemetry/api` only — never the SDK.
14. When an app uses Pino, always configure `pino-opentelemetry-transport`. Do NOT assume auto-instrumentation will handle logs.
15. The logger template (`logger.ts`) is as critical as `tracing.ts`. Both must be created for apps with Pino.

## References

- [The three signals](references/signals.md) — What traces, metrics, and logs provide and how to configure each
- [Node.js template](references/node.md) — NodeSDK + Pino logger with all 3 signals (Hono, Express, NestJS, Fastify)
- [Next.js template](references/nextjs.md) — @vercel/otel with all 3 signals
- [Bun template](references/bun.md) — Bun-specific setup and limitations
- [Log bridges](references/log-bridges.md) — Pino transport setup (recommended) and auto-instrumentation fallback
- [Manual spans](references/manual-spans.md) — When and how library packages add custom spans
- [Diagnostics](references/diagnostics.md) — Troubleshooting when telemetry is not flowing
- [Environment variables](references/env-vars.md) — Complete OTel env var reference
