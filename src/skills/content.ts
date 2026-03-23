export const VX_SETUP_SKILL = `---
name: vx-setup
description: Configure OpenTelemetry instrumentation for this project to work with vx observability stack
---

# vx-setup — Configure OpenTelemetry for vx

Configure the minimum viable OpenTelemetry setup so this project sends telemetry to the vx stack at \`http://localhost:4318\`.

## Phase 1: Analyze the project

1. Read root \`package.json\`. Check for \`workspaces\` field or \`pnpm-workspace.yaml\`.
2. If monorepo: identify app directories (typically \`apps/*\`).
3. For each app (or root if single-package):
   - Detect framework from dependencies: \`@nestjs/core\`, \`hono\`, \`next\`, \`express\`, \`fastify\`, \`@temporalio/worker\`
   - Search for existing OTel: grep for \`@opentelemetry\`, \`OTLPTraceExporter\`, \`NodeSDK\`, \`registerOTel\`, \`@hono/otel\` in \`src/\` files
   - Check for \`tracing.ts\`, \`instrumentation.ts\`, or \`telemetry.ts\` files
   - If found: read the file, note the OTLP exporter URL
   - Check env files (\`.env\`, \`.env.local\`, \`.env.development\`) for \`OTEL_COLLECTOR_URL\` or \`OTEL_EXPORTER_OTLP_ENDPOINT\`

## Phase 2: Decide per app

Apply the FIRST matching rule:

| Condition | Action |
|-----------|--------|
| OTel exists AND exports to \`:4318\` | Report: "Already compatible. No changes needed." |
| OTel exists AND uses env var defaulting to \`:4318\` | Report: "Already compatible via env default." |
| OTel exists AND exports to different URL | Add/update env var \`OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318\` in \`.env.local\` or equivalent. ONE change. |
| No OTel AND NestJS or Fastify (Node) | Apply template: **nestjs-node** |
| No OTel AND Hono (Bun runtime) | Apply template: **hono-bun** |
| No OTel AND Next.js | Apply template: **nextjs** |
| No OTel AND Express (Node) | Apply template: **nestjs-node** (same pattern) |
| No OTel AND unknown framework | Apply template: **generic-node** |

## Phase 3: Apply template (only if no OTel exists)

### Template: nestjs-node

Create \`src/tracing.ts\`:

\`\`\`typescript
import { NodeSDK } from "@opentelemetry/sdk-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { Resource } from "@opentelemetry/resources";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";

const sdk = new NodeSDK({
  resource: new Resource({
    [ATTR_SERVICE_NAME]: process.env.OTEL_SERVICE_NAME ?? "my-service",
  }),
  traceExporter: new OTLPTraceExporter({
    url: \\\`\\\${process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? "http://localhost:4318"}/v1/traces\\\`,
  }),
  instrumentations: [
    getNodeAutoInstrumentations({
      "@opentelemetry/instrumentation-fs": { enabled: false },
      "@opentelemetry/instrumentation-dns": { enabled: false },
      "@opentelemetry/instrumentation-net": { enabled: false },
    }),
  ],
});

sdk.start();
process.on("SIGTERM", () => sdk.shutdown());
\`\`\`

Add to entry point: \`import "./tracing";\` as the FIRST import in \`main.ts\` or equivalent.

Dependencies to add:
\`\`\`
@opentelemetry/api@1.9.0
@opentelemetry/sdk-node@0.213.0
@opentelemetry/auto-instrumentations-node@0.71.0
@opentelemetry/exporter-trace-otlp-http@0.213.0
@opentelemetry/resources@2.0.0
@opentelemetry/semantic-conventions@1.35.0
\`\`\`

### Template: hono-bun

Create \`instrumentation.ts\` in the app root:

\`\`\`typescript
import { NodeSDK } from "@opentelemetry/sdk-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { Resource } from "@opentelemetry/resources";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";

const sdk = new NodeSDK({
  resource: new Resource({
    [ATTR_SERVICE_NAME]: process.env.OTEL_SERVICE_NAME ?? "my-service",
  }),
  traceExporter: new OTLPTraceExporter({
    url: \\\`\\\${process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? "http://localhost:4318"}/v1/traces\\\`,
  }),
  // No auto-instrumentations: Bun lacks diagnostics_channel support
});

sdk.start();
process.on("beforeExit", () => sdk.shutdown());
\`\`\`

Wrap the Hono app: \`export default instrument(app)\` using \`import { instrument } from "@hono/otel"\`.

Dependencies to add:
\`\`\`
@hono/otel@1.1.1
@opentelemetry/api@1.9.0
@opentelemetry/sdk-node@0.213.0
@opentelemetry/exporter-trace-otlp-http@0.213.0
@opentelemetry/resources@2.0.0
@opentelemetry/semantic-conventions@1.35.0
\`\`\`

IMPORTANT: NEVER add \`@opentelemetry/auto-instrumentations-node\` for Bun projects.

### Template: nextjs

Create \`instrumentation.ts\` in the app root (Next.js discovers it automatically):

\`\`\`typescript
import { registerOTel } from "@vercel/otel";

export function register() {
  registerOTel({
    serviceName: process.env.OTEL_SERVICE_NAME ?? "my-nextjs-app",
  });
}
\`\`\`

Add to \`.env.local\`:
\`\`\`
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
\`\`\`

Dependencies to add:
\`\`\`
@vercel/otel@2.1.1
@opentelemetry/api@1.9.0
\`\`\`

### Template: generic-node

Same as **nestjs-node** template.

## Phase 4: After changes

1. Run the project's package manager install command (\`pnpm install\`, \`bun install\`, etc.)
2. Run the project's type checker if available (\`tsc --noEmit\`, \`bun run check\`, etc.)
3. Tell the user: "Run \\\`/vx-verify\\\` to confirm telemetry flows correctly."

## Rules

1. NEVER overwrite an existing tracing/instrumentation file. If it exists, analyze it — don't replace it.
2. NEVER remove existing OTel configuration or dependencies.
3. If existing OTel already points to \`:4318\`, do NOTHING. Report success.
4. Prefer environment variables over hardcoded URLs. Use \`OTEL_EXPORTER_OTLP_ENDPOINT\` when possible.
5. Bun runtime NEVER gets \`@opentelemetry/auto-instrumentations-node\`.
6. The OTLP endpoint is always \`http://localhost:4318\` (HTTP, not gRPC).
7. For monorepos: report findings per workspace. Handle each independently.
8. When adding dependencies, respect existing versions — never downgrade.
9. After any code change, verify it compiles (run type checker).`;

export const VX_VERIFY_SKILL = `---
name: vx-verify
description: Verify that OpenTelemetry telemetry flows from the app to the vx observability stack
---

# vx-verify — Verify telemetry connection

Confirm that the app sends telemetry to the vx stack and that queries return data.

## Step 1: Check vx stack

\`\`\`bash
npx vx status
\`\`\`

- If all services show \`healthy\`: proceed to Step 2.
- If any service is \`unreachable\`: run \`npx vx up\` and wait for it to complete, then re-check.
- If \`vx up\` fails: report the error and stop.

## Step 2: Identify the app

- Read \`package.json\` for the start/dev command.
- For monorepos: identify which app(s) have OTel configured (check for \`tracing.ts\` or \`instrumentation.ts\`).
- Note the start command (e.g., \`pnpm dev\`, \`bun run dev\`, \`npm run dev\`).

## Step 3: Ensure the app is running

Ask the user:

> Please start your app in a separate terminal with \`[detected start command]\` and confirm when it's running.

If you can detect the app is already running (e.g., its port responds to HTTP), proceed directly.

## Step 4: Query for telemetry

Wait approximately 10 seconds after the app starts, then run:

\`\`\`bash
# Check for traces
npx vx traces '*'

# Check for metrics
npx vx metrics 'up'

# Check for logs (if app sends OTel logs)
npx vx logs '*'
\`\`\`

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
   - For NestJS/Node: check that \`import "./tracing"\` is the first import in the entry file, or that \`-r ./tracing.ts\` is in the start script.
   - For Hono/Bun: check that \`--preload instrumentation.ts\` is in the start script.
   - For Next.js: check that \`instrumentation.ts\` exists in the app root with an exported \`register()\` function.

2. **Is the exporter URL correct?**
   - Check that \`OTEL_EXPORTER_OTLP_ENDPOINT\` is set to \`http://localhost:4318\` in the env.
   - Or check that the exporter URL in code points to \`http://localhost:4318\`.

3. **Is the OTel Collector receiving connections?**
   - Run \`npx vx status\` — the otel-collector should be \`healthy\`.
   - Check collector health at \`http://localhost:13133/\`.

4. **Enable OTel debug logging:**
   - Suggest: set \`OTEL_LOG_LEVEL=debug\` in the app's environment and restart.
   - Check stderr for OTel SDK initialization messages.

Report findings and suggest fixes for each issue found.`;

export const CLAUDE_MD_BLOCK = `## vx

This project uses \`vx\` for ephemeral runtime observability during development.

### Commands

\`\`\`bash
vx up                          # Start the observability stack (Docker)
vx down                        # Destroy the stack and all data
vx status                      # Health check all services
vx metrics '<MetricsQL>'       # Query metrics (PromQL superset)
vx logs '<LogsQL>'             # Query logs
vx traces '<query>'            # Query traces
vx check health                # Verify all services respond
vx check latency '<metric>' --p99 --max=2s
vx check errors '<logsql>' --max=0
\`\`\`

### Skills

- \`/vx-setup\` — Configure OpenTelemetry instrumentation for this project
- \`/vx-verify\` — Verify telemetry is flowing from app to vx stack

### Endpoints

| Signal  | Port   | Query Language |
|---------|--------|----------------|
| Metrics | :8428  | MetricsQL      |
| Logs    | :9428  | LogsQL         |
| Traces  | :10428 | LogsQL         |
| OTLP    | :4318  | —              |

### Workflow

1. Run \`vx up\` before starting the app
2. Run \`/vx-setup\` to configure OTel (once per project)
3. App emits telemetry to \`http://localhost:4318\` via OpenTelemetry
4. Query with \`vx metrics\`, \`vx logs\`, \`vx traces\`
5. Use \`vx check\` as quality gates before completing a task
6. Run \`/vx-verify\` to confirm everything works
7. Run \`vx down\` when done`;
