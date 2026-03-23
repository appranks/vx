---
name: vx-setup
description: Configure OpenTelemetry instrumentation for this project to work with vx observability stack
---

# vx-setup — Configure OpenTelemetry for vx

Configure the minimum viable OpenTelemetry setup so this project sends telemetry to the vx stack at `http://localhost:4318`.

## Phase 1: Analyze the project

1. Read root `package.json`. Check for `workspaces` field or `pnpm-workspace.yaml`.
2. If monorepo: identify app directories (typically `apps/*`).
3. For each app (or root if single-package):
   - Detect framework from dependencies: `@nestjs/core`, `hono`, `next`, `express`, `fastify`, `@temporalio/worker`
   - Detect runtime: check if `bun` is in devDependencies or if `bunfig.toml` exists → Bun. Otherwise → Node.
   - Search for existing OTel: grep for `@opentelemetry`, `OTLPTraceExporter`, `NodeSDK`, `registerOTel`, `@hono/otel` in `src/` files
   - Check for `tracing.ts`, `instrumentation.ts`, or `telemetry.ts` files
   - If found: read the file, note the OTLP exporter URL
4. Detect the env file pattern per app:
   - If `.env.local` exists → use `.env.local`
   - If `.env.development` exists → use `.env.development`
   - If `.env` exists with dev-specific vars → use `.env`
   - If none exist → create `.env.local`

## Phase 2: Decide per app

Apply the FIRST matching rule:

| Condition | Action |
|-----------|--------|
| OTel exists AND exports to `:4318` | Report: "Already compatible. No changes needed." |
| OTel exists AND uses env var defaulting to `:4318` | Report: "Already compatible via env default." |
| OTel exists AND exports to different URL | Set `OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318` in the detected env file. ONE change. |
| No OTel AND Node runtime (NestJS, Express, Fastify, Hono on Node, generic) | Apply template: **node-auto** |
| No OTel AND Hono on Bun runtime | Apply template: **hono-bun** |
| No OTel AND Next.js | Apply template: **nextjs** |

## Phase 3: Apply template (only if no OTel exists)

### Template: node-auto

Create `src/tracing.ts`:

```typescript
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
    url: `${process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? "http://localhost:4318"}/v1/traces`,
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
```

#### Framework variations

| Framework | Default service name | Entry file | Import pattern |
|-----------|---------------------|------------|----------------|
| NestJS | `my-nestjs-api` | `src/main.ts` | `import "./tracing";` first line |
| Hono (Node) | `my-hono-api` | `src/index.ts` | `import "./tracing";` first line |
| Express | `my-express-api` | `src/app.ts` | `import "./tracing";` first line |
| Fastify | `my-fastify-api` | `src/server.ts` | `import "./tracing";` first line |
| Generic | `my-service` | Entry file | `import "./tracing";` first line |

#### Extra: Hono on Node

If the framework is Hono running on Node (not Bun), ALSO:

1. Install `@hono/otel@1.1.1` in the app directory
2. Wrap the Hono app with `instrument()`:
   ```typescript
   import { instrument } from "@hono/otel";
   export default instrument(app);
   ```

This gives both auto-instrumentation (HTTP, DB, etc.) AND middleware-level route tracing.

#### Install dependencies

Run inside the app directory:

```bash
cd <app-dir>
pnpm add @opentelemetry/api@1.9.0 @opentelemetry/sdk-node@0.213.0 @opentelemetry/auto-instrumentations-node@0.71.0 @opentelemetry/exporter-trace-otlp-http@0.213.0 @opentelemetry/resources@2.0.0 @opentelemetry/semantic-conventions@1.35.0
```

For Hono on Node, also: `pnpm add @hono/otel@1.1.1`

### Template: hono-bun

Create `instrumentation.ts` in the app root:

```typescript
import { NodeSDK } from "@opentelemetry/sdk-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { Resource } from "@opentelemetry/resources";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";

const sdk = new NodeSDK({
  resource: new Resource({
    [ATTR_SERVICE_NAME]: process.env.OTEL_SERVICE_NAME ?? "my-service",
  }),
  traceExporter: new OTLPTraceExporter({
    url: `${process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? "http://localhost:4318"}/v1/traces`,
  }),
  // No auto-instrumentations: Bun lacks diagnostics_channel support
});

sdk.start();
process.on("beforeExit", () => sdk.shutdown());
```

Wrap the Hono app: `export default instrument(app)` using `import { instrument } from "@hono/otel"`.

Run inside the app directory:

```bash
cd <app-dir>
bun add @hono/otel@1.1.1 @opentelemetry/api@1.9.0 @opentelemetry/sdk-node@0.213.0 @opentelemetry/exporter-trace-otlp-http@0.213.0 @opentelemetry/resources@2.0.0 @opentelemetry/semantic-conventions@1.35.0
```

IMPORTANT: NEVER add `@opentelemetry/auto-instrumentations-node` for Bun projects.

### Template: nextjs

Create `instrumentation.ts` in the app root (Next.js discovers it automatically):

```typescript
import { registerOTel } from "@vercel/otel";

export function register() {
  registerOTel({
    serviceName: process.env.OTEL_SERVICE_NAME ?? "my-nextjs-app",
  });
}
```

Run inside the app directory:

```bash
cd <app-dir>
pnpm add @vercel/otel@2.1.1 @opentelemetry/api@1.9.0
```

### After applying any template

Set env vars in the detected env file (from Phase 1 step 4):

```
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
OTEL_SERVICE_NAME=<service-name>
```

## Phase 4: After all changes

1. Run the project's type checker if available (`tsc --noEmit`, `bun run check`, etc.)
2. Tell the user: "Run `/vx-verify` to confirm telemetry flows correctly."

## Rules

1. NEVER overwrite an existing tracing/instrumentation file. If it exists, analyze it — don't replace it.
2. NEVER remove existing OTel configuration or dependencies.
3. If existing OTel already points to `:4318`, do NOTHING. Report success.
4. Prefer environment variables over hardcoded URLs.
5. Bun runtime NEVER gets `@opentelemetry/auto-instrumentations-node`.
6. The OTLP endpoint is always `http://localhost:4318` (HTTP, not gRPC).
7. For monorepos: report findings per workspace. Handle each independently.
8. Install dependencies inside each app workspace, never in the monorepo root. Use the project's package manager (`pnpm add`, `bun add`, `npm install`).
9. When adding dependencies, respect existing versions — never downgrade.
10. After any code change, verify it compiles (run type checker).
11. Detect and follow the project's env file pattern. Never hardcode which env file to use.
