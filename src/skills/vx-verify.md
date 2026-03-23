---
name: vx-verify
description: Verify that OpenTelemetry telemetry flows from the app to the vx observability stack
---

# vx-verify — Verify telemetry connection

Confirm that the app sends telemetry to the vx stack and that queries return data.

## Step 1: Check vx stack

```bash
npx vx status
```

- If all services show `healthy`: proceed to Step 2.
- If any service is `unreachable`: run `npx vx up` and wait for it to complete, then re-check.
- If `vx up` fails: report the error and stop.

## Step 2: Identify the app

- Read `package.json` for the start/dev command.
- For monorepos: identify which app(s) have OTel configured (check for `tracing.ts` or `instrumentation.ts`).
- Note the start command (e.g., `pnpm dev`, `bun run dev`, `npm run dev`).

## Step 3: Ensure the app is running

Ask the user:

> Please start your app in a separate terminal with `[detected start command]` and confirm when it's running.

If you can detect the app is already running (e.g., its port responds to HTTP), proceed directly.

## Step 4: Query for telemetry

Wait approximately 10 seconds after the app starts, then run:

```bash
# Check for traces
npx vx traces '*'

# Check for metrics
npx vx metrics 'up'

# Check for logs (if app sends OTel logs)
npx vx logs '*'
```

## Step 5: Report results

For each signal, report:

| Signal  | Result | Details |
|---------|--------|---------|
| Traces  | Found N spans / No data | Show sample trace if found |
| Metrics | Found N series / No data | Show sample metric if found |
| Logs    | Found N entries / No data | Show sample log if found |

If ALL signals return data: report SUCCESS.
If SOME signals return data: report PARTIAL — explain which signals are missing and why (not all frameworks export all signals by default).
If NO signals return data: proceed to Step 6.

## Step 6: Diagnose (only if no telemetry found)

Check these in order:

1. **Is the tracing file loaded?**
   - For NestJS/Node: check that `import "./tracing"` is the first import in the entry file, or that `-r ./tracing.ts` is in the start script.
   - For Hono/Bun: check that `--preload instrumentation.ts` is in the start script.
   - For Next.js: check that `instrumentation.ts` exists in the app root with an exported `register()` function.

2. **Is the exporter URL correct?**
   - Check that `OTEL_EXPORTER_OTLP_ENDPOINT` is set to `http://localhost:4318` in the env.
   - Or check that the exporter URL in code points to `http://localhost:4318`.

3. **Is the OTel Collector receiving connections?**
   - Run `npx vx status` — the otel-collector should be `healthy`.
   - Check collector health at `http://localhost:13133/`.

4. **Enable OTel debug logging:**
   - Suggest: set `OTEL_LOG_LEVEL=debug` in the app's environment and restart.
   - Check stderr for OTel SDK initialization messages.

Report findings and suggest fixes for each issue found.
