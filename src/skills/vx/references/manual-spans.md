# Manual Spans for Library Packages

When and how to add custom OpenTelemetry spans in shared libraries and packages.

## The rule

| Layer | What to use | Example |
|-------|------------|---------|
| **Apps** (servers, CLIs) | `@opentelemetry/sdk-node` + exporters | `apps/engine/src/tracing.ts` |
| **Libraries** (packages) | `@opentelemetry/api` ONLY | `packages/sdk/src/daytona.ts` |

Libraries NEVER import the SDK, exporters, or processors. They only use the API, which is a **no-op** when no SDK is registered. Zero overhead if consumed by an app without OTel.

## When a package needs manual spans

| Condition | Needs manual spans? | Why |
|-----------|:-------------------:|-----|
| Uses a library with auto-instrumentation (pg, undici, express) | No | Auto-instrumentation handles it |
| Uses a library WITHOUT auto-instrumentation (postgres.js, custom SDKs) | **Yes** | Operations are invisible |
| Wraps business-critical operations (provision sandbox, run agent) | **Yes** | Need domain context beyond "HTTP request" |
| Pure data transforms, schemas, types | No | No I/O, nothing to trace |

### Known libraries WITHOUT auto-instrumentation

These popular libraries are NOT covered by `@opentelemetry/auto-instrumentations-node`:

- `postgres` (postgres.js) — uses raw TCP sockets, not `pg`
- `@daytonaio/sdk` — proprietary SDK
- `better-auth` — HTTP calls are auto-instrumented, but auth operations are not
- Custom REST/gRPC clients
- File-based operations via custom abstractions

## Pattern: `tracer.startActiveSpan()`

```typescript
import { trace, SpanStatusCode } from "@opentelemetry/api";

// Create a tracer scoped to this package
const tracer = trace.getTracer("@myorg/my-package", "0.1.0");

export async function createSandbox(config: SandboxConfig): Promise<Sandbox> {
  return tracer.startActiveSpan("sandbox.create", async (span) => {
    try {
      // Add domain-specific attributes
      span.setAttribute("sandbox.repo_url", config.repoUrl);
      span.setAttribute("sandbox.target", config.target);

      const result = await client.create(config);

      span.setAttribute("sandbox.id", result.id);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: (error as Error).message,
      });
      span.recordException(error as Error);
      throw error;
    } finally {
      span.end();
    }
  });
}
```

### Key points

- `trace.getTracer()` returns a no-op tracer if no SDK is present — safe for any consumer.
- `startActiveSpan` creates a child span under the current context — automatic parent propagation.
- Always `span.end()` in `finally` to avoid leaked spans.
- Add attributes that provide domain context (`project.id`, `run.id`, `sandbox.status`).

## Pattern: Database wrapper

For database libraries without auto-instrumentation (e.g., postgres.js with Drizzle):

```typescript
import { trace, SpanStatusCode, SpanKind } from "@opentelemetry/api";

const tracer = trace.getTracer("@myorg/db", "0.1.0");

export function createTracedDatabase(connectionString: string) {
  const pool = postgres(connectionString);
  const db = drizzle(pool);

  // Option 1: Use Drizzle's logger to create spans
  const tracedDb = drizzle(pool, {
    logger: {
      logQuery(query, params) {
        const span = trace.getActiveSpan();
        if (span) {
          span.addEvent("db.query", {
            "db.statement": query,
            "db.system": "postgresql",
          });
        }
      },
    },
  });

  return tracedDb;
}
```

For more granular tracing, wrap individual operations:

```typescript
export async function findProjectById(db: Database, id: string) {
  return tracer.startActiveSpan("db.project.findById", {
    kind: SpanKind.CLIENT,
    attributes: {
      "db.system": "postgresql",
      "db.operation": "SELECT",
      "project.id": id,
    },
  }, async (span) => {
    try {
      const result = await db.query.projects.findFirst({
        where: eq(projects.id, id),
      });
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      span.setStatus({ code: SpanStatusCode.ERROR });
      span.recordException(error as Error);
      throw error;
    } finally {
      span.end();
    }
  });
}
```

## Dependency

The only dependency a library package needs (look up the latest stable version on npm before installing):

```bash
pnpm add @opentelemetry/api
```

This is the **only** OpenTelemetry package a library should depend on. Never add `@opentelemetry/sdk-node`, exporters, or processors to a library package.

## Decision table for monorepo packages

| Package type | Auto-instrumented? | Manual spans? | Priority |
|-------------|:------------------:|:-------------:|:--------:|
| DB layer (uses `pg`) | Yes | Optional | Low |
| DB layer (uses `postgres`/postgres.js) | **No** | **Yes** | High |
| SDK wrapper (external APIs) | HTTP: Yes, Business logic: No | **Yes** | High |
| Auth (uses HTTP internally) | Partially | Optional | Low |
| Types/schemas (no I/O) | N/A | No | — |
| Shared utilities (pure functions) | N/A | No | — |
