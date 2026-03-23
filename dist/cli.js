// @bun
// src/lib/args.ts
function parseGlobalFlags(args) {
  return {
    json: args.includes("--json"),
    quiet: args.includes("--quiet"),
    verbose: args.includes("--verbose"),
    help: args.includes("--help") || args.includes("-h"),
    version: args.includes("--version") || args.includes("-v")
  };
}
function stripFlags(args) {
  return args.filter((a) => !a.startsWith("--") && !a.startsWith("-"));
}
function parseFlag(args, name) {
  for (let i = 0;i < args.length; i++) {
    const arg = args[i];
    if (arg === name && i + 1 < args.length) {
      return args[i + 1];
    }
    if (arg.startsWith(`${name}=`)) {
      return arg.slice(name.length + 1);
    }
  }
  return;
}

// src/lib/exit.ts
var EXIT = {
  OK: 0,
  USER_ERROR: 1,
  STACK_ERROR: 2
};
function exitWith(code) {
  process.exit(code);
}

// src/lib/constants.ts
var VX_PROJECT_NAME = "vx";
var VX_NETWORK = "vx-net";
var IMAGES = {
  victoriaMetrics: "victoriametrics/victoria-metrics:v1.138.0",
  victoriaLogs: "victoriametrics/victoria-logs:v1.48.0",
  victoriaTraces: "victoriametrics/victoria-traces:v0.8.0",
  otelCollector: "otel/opentelemetry-collector-contrib:0.148.0"
};
var TIMEOUTS = {
  metrics: 1e4,
  logs: 15000,
  traces: 15000,
  health: 3000
};
var QUERY_LIMITS = {
  metrics: 1000,
  logs: 100,
  traces: 50
};
var REQUIRED_PORTS = [4317, 4318, 8428, 9428, 10428];
var HEALTH_ENDPOINTS = [
  { name: "victoria-metrics", url: "http://localhost:8428/health" },
  { name: "victoria-logs", url: "http://localhost:9428/health" },
  { name: "victoria-traces", url: "http://localhost:10428/health" },
  { name: "otel-collector", url: "http://localhost:13133/" }
];

// src/lib/health.ts
var TIMEOUT_MS = 60000;
var POLL_INTERVAL_MS = 1000;
async function waitForStack() {
  const deadline = Date.now() + TIMEOUT_MS;
  while (Date.now() < deadline) {
    const results = await Promise.allSettled(HEALTH_ENDPOINTS.map(({ url }) => fetch(url, { signal: AbortSignal.timeout(TIMEOUTS.health) })));
    const allHealthy = results.every((r) => r.status === "fulfilled" && r.value.ok);
    if (allHealthy)
      return;
    await Bun.sleep(POLL_INTERVAL_MS);
  }
  throw new Error(`stack not ready after ${TIMEOUT_MS / 1000}s`);
}
async function isStackRunning() {
  const results = await Promise.allSettled(HEALTH_ENDPOINTS.map(({ url }) => fetch(url, { signal: AbortSignal.timeout(TIMEOUTS.health) })));
  return results.every((r) => r.status === "fulfilled" && r.value.ok);
}

// src/lib/http.ts
class StackUnreachableError extends Error {
  constructor(url, cause) {
    super(`victoria backend unreachable at ${url}`);
    this.name = "StackUnreachableError";
    this.cause = cause;
  }
}

class QueryError extends Error {
  constructor(_query, detail) {
    super(`invalid query: ${detail}`);
    this.name = "QueryError";
  }
}
async function victoriaGet(url, timeoutMs = 1e4) {
  let res;
  try {
    res = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { Accept: "application/json" }
    });
  } catch (err) {
    throw new StackUnreachableError(url, err);
  }
  if (res.status === 400 || res.status === 422) {
    const body = await res.text();
    throw new QueryError(url, body);
  }
  if (!res.ok) {
    throw new StackUnreachableError(url, `HTTP ${res.status}`);
  }
  return res;
}
async function queryMetrics(query, time) {
  const url = new URL("http://localhost:8428/api/v1/query");
  url.searchParams.set("query", query);
  if (time)
    url.searchParams.set("time", time);
  const res = await victoriaGet(url.toString(), TIMEOUTS.metrics);
  const body = await res.json();
  if (body.status !== "success") {
    throw new QueryError(query, `victoria returned status: ${body.status}`);
  }
  return body.data;
}
function parseNdjson(text, fallback) {
  return text.split(`
`).filter((line) => line.trim().length > 0).map((line) => {
    try {
      return JSON.parse(line);
    } catch {
      return fallback(line);
    }
  });
}
async function queryLogs(query, limit = 100) {
  const url = new URL("http://localhost:9428/select/logsql/query");
  url.searchParams.set("query", query);
  url.searchParams.set("limit", String(limit));
  const res = await victoriaGet(url.toString(), TIMEOUTS.logs);
  const text = await res.text();
  return parseNdjson(text, (line) => ({
    _msg: line,
    _stream: "",
    _time: ""
  }));
}
async function queryTraces(query, limit = 50) {
  const url = new URL("http://localhost:10428/select/logsql/query");
  url.searchParams.set("query", query);
  url.searchParams.set("limit", String(limit));
  const res = await victoriaGet(url.toString(), TIMEOUTS.traces);
  const text = await res.text();
  return parseNdjson(text, (line) => ({
    traceID: "",
    spanID: "",
    operationName: line,
    duration: 0,
    _time: ""
  }));
}

// src/lib/style.ts
var enabled = process.stdout.isTTY ?? false;
function esc(code) {
  return enabled ? `\x1B[${code}m` : "";
}
var c = {
  reset: esc("0"),
  bold: esc("1"),
  dim: esc("2"),
  red: esc("31"),
  green: esc("32"),
  yellow: esc("33"),
  cyan: esc("36"),
  gray: esc("90")
};
var icon = {
  ok: enabled ? "\u2713" : "ok",
  fail: enabled ? "\u2717" : "fail",
  dot: enabled ? "\u25CF" : "*",
  circle: enabled ? "\u25CB" : "o",
  arrow: enabled ? "\u25B8" : ">",
  warn: enabled ? "\u26A0" : "!",
  skip: enabled ? "\u2298" : "-"
};
function st(style, text) {
  if (!enabled)
    return text;
  return `${style}${text}${c.reset}`;
}
var ANSI_PATTERN = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");
function visibleLength(text) {
  return text.replace(ANSI_PATTERN, "").length;
}

// src/commands/check.ts
async function runCheck(ctx) {
  const gate = ctx.args[0];
  if (!gate) {
    ctx.output.error("missing gate argument", "Usage: vx check <health|latency|errors> [query] [flags]");
    exitWith(EXIT.USER_ERROR);
  }
  switch (gate) {
    case "health":
      return checkHealth(ctx);
    case "latency":
      return checkLatency(ctx);
    case "errors":
      return checkErrors(ctx);
    default:
      ctx.output.error(`unknown gate: ${gate}`, "Available gates: health, latency, errors");
      exitWith(EXIT.USER_ERROR);
  }
}
function formatGate(passed, gate, detail) {
  const sym = passed ? st(c.green, icon.ok) : st(c.red, icon.fail);
  const status = passed ? "passed" : st(c.red, "failed");
  return `  ${sym} ${st(c.bold, gate)} ${st(c.dim, "\u2014")} ${status}  ${st(c.dim, detail)}`;
}
async function checkHealth(ctx) {
  const healthy = await isStackRunning();
  if (healthy) {
    if (ctx.output.isHuman) {
      ctx.output.printHuman(formatGate(true, "health", "all services healthy"));
    } else {
      ctx.output.print({ gate: "health", status: "passed", message: "all services healthy" });
    }
  } else {
    ctx.output.error("health check failed", "one or more services are not responding");
    exitWith(EXIT.USER_ERROR);
  }
}
async function checkLatency(ctx) {
  const query = ctx.args[1];
  if (!query) {
    ctx.output.error("missing metric query", "Usage: vx check latency <metric> --max=<duration>");
    exitWith(EXIT.USER_ERROR);
  }
  const maxStr = parseFlag([...ctx.args, ...process.argv.slice(2)], "--max");
  if (!maxStr) {
    ctx.output.error("missing --max flag", "Usage: vx check latency <metric> --max=<duration>");
    exitWith(EXIT.USER_ERROR);
  }
  const maxSeconds = parseDuration(maxStr);
  if (maxSeconds === null) {
    ctx.output.error("invalid --max value", "Expected format: 1s, 2s, 500ms, etc.");
    exitWith(EXIT.USER_ERROR);
  }
  const isP99 = ctx.args.includes("--p99") || process.argv.includes("--p99");
  const quantile = isP99 ? "0.99" : "0.95";
  const wrappedQuery = `histogram_quantile(${quantile}, ${query})`;
  try {
    const result = await queryMetrics(wrappedQuery);
    if (result.result.length === 0) {
      if (ctx.output.isHuman) {
        ctx.output.printHuman(formatGate(true, "latency", `no data (max ${maxStr})`));
      } else {
        ctx.output.print({ gate: "latency", status: "passed", message: "no data", value: null, max: maxStr });
      }
      return;
    }
    const value = Number.parseFloat(result.result[0].value[1]);
    const passed = value <= maxSeconds;
    if (ctx.output.isHuman) {
      ctx.output.printHuman(formatGate(passed, "latency", `${value.toFixed(2)}s (max ${maxSeconds}s)`));
    } else {
      ctx.output.print({
        gate: "latency",
        status: passed ? "passed" : "failed",
        value,
        max: maxSeconds,
        query: wrappedQuery
      });
    }
    if (!passed)
      exitWith(EXIT.USER_ERROR);
  } catch (err) {
    if (err instanceof QueryError) {
      ctx.output.error(err.message);
      exitWith(EXIT.USER_ERROR);
    }
    if (err instanceof StackUnreachableError) {
      ctx.output.error(err.message, err.cause);
      exitWith(EXIT.STACK_ERROR);
    }
    ctx.output.error("unexpected error", err instanceof Error ? err.message : String(err));
    exitWith(EXIT.STACK_ERROR);
  }
}
async function checkErrors(ctx) {
  const query = ctx.args[1];
  if (!query) {
    ctx.output.error("missing logs query", "Usage: vx check errors <logsql> --max=<count>");
    exitWith(EXIT.USER_ERROR);
  }
  const maxStr = parseFlag([...ctx.args, ...process.argv.slice(2)], "--max");
  if (!maxStr) {
    ctx.output.error("missing --max flag", "Usage: vx check errors <logsql> --max=<count>");
    exitWith(EXIT.USER_ERROR);
  }
  const maxCount = Number.parseInt(maxStr, 10);
  if (Number.isNaN(maxCount) || maxCount < 0) {
    ctx.output.error("--max must be a non-negative integer");
    exitWith(EXIT.USER_ERROR);
  }
  try {
    const entries = await queryLogs(query, maxCount + 1);
    const count = entries.length;
    const passed = count <= maxCount;
    if (ctx.output.isHuman) {
      ctx.output.printHuman(formatGate(passed, "errors", `${count} found (max ${maxCount})`));
    } else {
      ctx.output.print({ gate: "errors", status: passed ? "passed" : "failed", count, max: maxCount, query });
    }
    if (!passed)
      exitWith(EXIT.USER_ERROR);
  } catch (err) {
    if (err instanceof QueryError) {
      ctx.output.error(err.message);
      exitWith(EXIT.USER_ERROR);
    }
    if (err instanceof StackUnreachableError) {
      ctx.output.error(err.message, err.cause);
      exitWith(EXIT.STACK_ERROR);
    }
    ctx.output.error("unexpected error", err instanceof Error ? err.message : String(err));
    exitWith(EXIT.STACK_ERROR);
  }
}
function parseDuration(str) {
  const msMatch = str.match(/^(\d+(?:\.\d+)?)ms$/);
  if (msMatch)
    return Number.parseFloat(msMatch[1]) / 1000;
  const sMatch = str.match(/^(\d+(?:\.\d+)?)s$/);
  if (sMatch)
    return Number.parseFloat(sMatch[1]);
  const mMatch = str.match(/^(\d+(?:\.\d+)?)m$/);
  if (mMatch)
    return Number.parseFloat(mMatch[1]) * 60;
  return null;
}

// src/lib/docker.ts
function dockerRun(args) {
  const proc = Bun.spawnSync(["docker", ...args], {
    stdout: "pipe",
    stderr: "pipe"
  });
  return {
    exitCode: proc.exitCode ?? 1,
    stdout: new TextDecoder().decode(proc.stdout),
    stderr: new TextDecoder().decode(proc.stderr)
  };
}
function composeRun(args, composePath) {
  return dockerRun(["compose", "-f", composePath, ...args]);
}

// src/lib/paths.ts
import { mkdir } from "fs/promises";
import { join } from "path";
function getVxDir() {
  return join(process.cwd(), ".vx");
}
function getComposePath() {
  return join(getVxDir(), "docker-compose.yml");
}
function getOtelConfigPath() {
  return join(getVxDir(), "otel-collector.yaml");
}
async function ensureVxDir() {
  await mkdir(getVxDir(), { recursive: true });
}

// src/commands/down.ts
async function runDown(ctx) {
  const composePath = getComposePath();
  const composeExists = await Bun.file(composePath).exists();
  if (!composeExists) {
    if (ctx.output.isHuman) {
      ctx.output.printHuman(`  ${st(c.dim, icon.circle)} no stack to stop`);
    } else {
      ctx.output.print({ status: "not_running", message: "no stack to stop" });
    }
    return;
  }
  const result = composeRun(["down", "--volumes", "--remove-orphans"], composePath);
  if (result.exitCode !== 0) {
    ctx.output.error("docker compose down failed", result.stderr);
    exitWith(EXIT.STACK_ERROR);
  }
  if (ctx.output.isHuman) {
    ctx.output.printHuman(`  ${st(c.dim, icon.circle)} stack destroyed, all data removed`);
  } else {
    ctx.output.print({ status: "stopped", message: "stack destroyed, all data removed" });
  }
}

// src/commands/init.ts
import { mkdir as mkdir2 } from "fs/promises";
import { join as join2 } from "path";

// src/lib/preset-writer.ts
async function writeIfNotExists(path, content, force) {
  const file = Bun.file(path);
  const exists = await file.exists();
  if (exists && !force) {
    return "skipped";
  }
  await Bun.write(path, content);
  return "created";
}
var VX_MARKER = "## vx";
async function appendClaudeMd(path, block, force) {
  const file = Bun.file(path);
  const exists = await file.exists();
  if (!exists) {
    await Bun.write(path, `${block}
`);
    return "created";
  }
  const content = await file.text();
  if (content.includes(VX_MARKER) && !force) {
    return "skipped";
  }
  if (content.includes(VX_MARKER) && force) {
    const before = content.slice(0, content.indexOf(VX_MARKER));
    await Bun.write(path, `${before.trimEnd()}

${block}
`);
    return "appended";
  }
  const separator = content.endsWith(`
`) ? `
` : `

`;
  await Bun.write(path, `${content}${separator}${block}
`);
  return "appended";
}

// src/skills/content.ts
var VX_SETUP_SKILL = `---
name: vx-setup
description: Configure OpenTelemetry instrumentation for this project to work with vx observability stack
---

# vx-setup \u2014 Configure OpenTelemetry for vx

Configure the minimum viable OpenTelemetry setup so this project sends telemetry to the vx stack at \`http://localhost:4318\`.

## Phase 1: Analyze the project

1. Read root \`package.json\`. Check for \`workspaces\` field or \`pnpm-workspace.yaml\`.
2. If monorepo: identify app directories (typically \`apps/*\`).
3. For each app (or root if single-package):
   - Detect framework from dependencies: \`@nestjs/core\`, \`hono\`, \`next\`, \`express\`, \`fastify\`, \`@temporalio/worker\`
   - Detect runtime: check if \`bun\` is in devDependencies or if \`bunfig.toml\` exists \u2192 Bun. Otherwise \u2192 Node.
   - Search for existing OTel: grep for \`@opentelemetry\`, \`OTLPTraceExporter\`, \`NodeSDK\`, \`registerOTel\`, \`@hono/otel\` in \`src/\` files
   - Check for \`tracing.ts\`, \`instrumentation.ts\`, or \`telemetry.ts\` files
   - If found: read the file, note the OTLP exporter URL
4. Detect the env file pattern per app:
   - If \`.env.local\` exists \u2192 use \`.env.local\`
   - If \`.env.development\` exists \u2192 use \`.env.development\`
   - If \`.env\` exists with dev-specific vars \u2192 use \`.env\`
   - If none exist \u2192 create \`.env.local\`

## Phase 2: Decide per app

Apply the FIRST matching rule:

| Condition | Action |
|-----------|--------|
| OTel exists AND exports to \`:4318\` | Report: "Already compatible. No changes needed." |
| OTel exists AND uses env var defaulting to \`:4318\` | Report: "Already compatible via env default." |
| OTel exists AND exports to different URL | Set \`OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318\` in the detected env file. ONE change. |
| No OTel AND Node runtime (NestJS, Express, Fastify, Hono on Node, generic) | Apply template: **node-auto** |
| No OTel AND Hono on Bun runtime | Apply template: **hono-bun** |
| No OTel AND Next.js | Apply template: **nextjs** |

## Phase 3: Apply template (only if no OTel exists)

### Template: node-auto

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

#### Framework variations

| Framework | Default service name | Entry file | Import pattern |
|-----------|---------------------|------------|----------------|
| NestJS | \`my-nestjs-api\` | \`src/main.ts\` | \`import "./tracing";\` first line |
| Hono (Node) | \`my-hono-api\` | \`src/index.ts\` | \`import "./tracing";\` first line |
| Express | \`my-express-api\` | \`src/app.ts\` | \`import "./tracing";\` first line |
| Fastify | \`my-fastify-api\` | \`src/server.ts\` | \`import "./tracing";\` first line |
| Generic | \`my-service\` | Entry file | \`import "./tracing";\` first line |

#### Extra: Hono on Node

If the framework is Hono running on Node (not Bun), ALSO:

1. Install \`@hono/otel@1.1.1\` in the app directory
2. Wrap the Hono app with \`instrument()\`:
   \`\`\`typescript
   import { instrument } from "@hono/otel";
   export default instrument(app);
   \`\`\`

This gives both auto-instrumentation (HTTP, DB, etc.) AND middleware-level route tracing.

#### Install dependencies

Run inside the app directory:

\`\`\`bash
cd <app-dir>
pnpm add @opentelemetry/api@1.9.0 @opentelemetry/sdk-node@0.213.0 @opentelemetry/auto-instrumentations-node@0.71.0 @opentelemetry/exporter-trace-otlp-http@0.213.0 @opentelemetry/resources@2.0.0 @opentelemetry/semantic-conventions@1.35.0
\`\`\`

For Hono on Node, also: \`pnpm add @hono/otel@1.1.1\`

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

Run inside the app directory:

\`\`\`bash
cd <app-dir>
bun add @hono/otel@1.1.1 @opentelemetry/api@1.9.0 @opentelemetry/sdk-node@0.213.0 @opentelemetry/exporter-trace-otlp-http@0.213.0 @opentelemetry/resources@2.0.0 @opentelemetry/semantic-conventions@1.35.0
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

Run inside the app directory:

\`\`\`bash
cd <app-dir>
pnpm add @vercel/otel@2.1.1 @opentelemetry/api@1.9.0
\`\`\`

### After applying any template

Set env vars in the detected env file (from Phase 1 step 4):

\`\`\`
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
OTEL_SERVICE_NAME=<service-name>
\`\`\`

## Phase 4: After all changes

1. Run the project's type checker if available (\`tsc --noEmit\`, \`bun run check\`, etc.)
2. Tell the user: "Run \\\`/vx-verify\\\` to confirm telemetry flows correctly."

## Rules

1. NEVER overwrite an existing tracing/instrumentation file. If it exists, analyze it \u2014 don't replace it.
2. NEVER remove existing OTel configuration or dependencies.
3. If existing OTel already points to \`:4318\`, do NOTHING. Report success.
4. Prefer environment variables over hardcoded URLs.
5. Bun runtime NEVER gets \`@opentelemetry/auto-instrumentations-node\`.
6. The OTLP endpoint is always \`http://localhost:4318\` (HTTP, not gRPC).
7. For monorepos: report findings per workspace. Handle each independently.
8. Install dependencies inside each app workspace, never in the monorepo root. Use the project's package manager (\`pnpm add\`, \`bun add\`, \`npm install\`).
9. When adding dependencies, respect existing versions \u2014 never downgrade.
10. After any code change, verify it compiles (run type checker).
11. Detect and follow the project's env file pattern. Never hardcode which env file to use.`;
var VX_VERIFY_SKILL = `---
name: vx-verify
description: Verify that OpenTelemetry telemetry flows from the app to the vx observability stack
---

# vx-verify \u2014 Verify telemetry connection

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
If SOME signals return data: report PARTIAL \u2014 explain which signals are missing and why (not all frameworks export all signals by default).
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
   - Run \`npx vx status\` \u2014 the otel-collector should be \`healthy\`.
   - Check collector health at \`http://localhost:13133/\`.

4. **Enable OTel debug logging:**
   - Suggest: set \`OTEL_LOG_LEVEL=debug\` in the app's environment and restart.
   - Check stderr for OTel SDK initialization messages.

Report findings and suggest fixes for each issue found.`;
var CLAUDE_MD_BLOCK = `## vx

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

- \`/vx-setup\` \u2014 Configure OpenTelemetry instrumentation for this project
- \`/vx-verify\` \u2014 Verify telemetry is flowing from app to vx stack

### Endpoints

| Signal  | Port   | Query Language |
|---------|--------|----------------|
| Metrics | :8428  | MetricsQL      |
| Logs    | :9428  | LogsQL         |
| Traces  | :10428 | LogsQL         |
| OTLP    | :4318  | \u2014              |

### Workflow

1. Run \`vx up\` before starting the app
2. Run \`/vx-setup\` to configure OTel (once per project)
3. App emits telemetry to \`http://localhost:4318\` via OpenTelemetry
4. Query with \`vx metrics\`, \`vx logs\`, \`vx traces\`
5. Use \`vx check\` as quality gates before completing a task
6. Run \`/vx-verify\` to confirm everything works
7. Run \`vx down\` when done`;

// src/commands/init.ts
function formatInitHuman(files, skills, nextSteps) {
  const lines = [];
  lines.push(`  ${st(c.bold, "FILES")}`);
  for (const f of files) {
    const actionStyle = f.action === "created" ? c.green : f.action === "appended" ? c.cyan : c.dim;
    lines.push(`    ${st(actionStyle, f.action.padEnd(10))} ${f.path}`);
  }
  lines.push("");
  lines.push(`  ${st(c.bold, "SKILLS")}`);
  for (const s of skills) {
    lines.push(`    ${st(c.cyan, icon.arrow)} ${s}`);
  }
  lines.push("");
  lines.push(`  ${st(c.bold, "NEXT STEPS")}`);
  for (let i = 0;i < nextSteps.length; i++) {
    lines.push(`    ${st(c.dim, `${i + 1}.`)} ${nextSteps[i]}`);
  }
  return lines.join(`
`);
}
async function runInit(ctx) {
  const force = ctx.args.includes("--force") || parseFlag(ctx.args, "--force") !== undefined;
  const cwd = process.cwd();
  const setupDir = join2(cwd, ".claude", "skills", "vx-setup");
  const verifyDir = join2(cwd, ".claude", "skills", "vx-verify");
  await mkdir2(setupDir, { recursive: true });
  await mkdir2(verifyDir, { recursive: true });
  const setupResult = await writeIfNotExists(join2(setupDir, "SKILL.md"), VX_SETUP_SKILL, force);
  const verifyResult = await writeIfNotExists(join2(verifyDir, "SKILL.md"), VX_VERIFY_SKILL, force);
  const claudeMdPath = join2(cwd, "CLAUDE.md");
  const claudeMdResult = await appendClaudeMd(claudeMdPath, CLAUDE_MD_BLOCK, force);
  const files = [
    { path: ".claude/skills/vx-setup/SKILL.md", action: setupResult },
    { path: ".claude/skills/vx-verify/SKILL.md", action: verifyResult },
    { path: "CLAUDE.md", action: claudeMdResult }
  ];
  const skills = ["vx-setup", "vx-verify"];
  const nextSteps = [
    "Run /vx-setup to configure OpenTelemetry for this project",
    "Run /vx-verify after setup to confirm telemetry is flowing"
  ];
  if (ctx.output.isHuman) {
    ctx.output.printHuman(formatInitHuman(files, skills, nextSteps));
  } else {
    ctx.output.print({ files, skills, next_steps: nextSteps });
  }
}

// src/lib/format.ts
function formatQueryResult(query, results) {
  return { query, count: results.length, results };
}

// src/lib/table.ts
function alignColumns(rows, gap = 2) {
  if (rows.length === 0)
    return [];
  const colCount = Math.max(...rows.map((r) => r.length));
  const widths = Array(colCount).fill(0);
  for (const row of rows) {
    for (let i = 0;i < row.length; i++) {
      widths[i] = Math.max(widths[i], visibleLength(row[i]));
    }
  }
  return rows.map((row) => {
    const cells = row.map((cell, i) => {
      if (i === row.length - 1)
        return cell;
      const vLen = visibleLength(cell);
      return cell + " ".repeat(Math.max(0, widths[i] - vLen + gap));
    });
    return `  ${cells.join("")}`;
  });
}

// src/commands/logs.ts
function formatLogsHuman(query, entries) {
  const lines = [];
  lines.push(`  ${st(c.bold, "QUERY")}  ${st(c.dim, query)}`);
  lines.push(`  ${st(c.bold, "COUNT")}  ${entries.length} results`);
  if (entries.length > 0) {
    lines.push("");
    const header = [st(c.bold + c.dim, "TIME"), st(c.bold + c.dim, "STREAM"), st(c.bold + c.dim, "MESSAGE")];
    const rows = entries.map((e) => [st(c.dim, e._time), e._stream, e._msg]);
    lines.push(...alignColumns([header, ...rows]));
  }
  return lines.join(`
`);
}
async function runLogs(ctx) {
  const query = ctx.args[0];
  if (!query) {
    ctx.output.error("missing query argument", "Usage: vx logs <LogsQL query>");
    exitWith(EXIT.USER_ERROR);
  }
  const limitStr = parseFlag([...ctx.args, ...process.argv.slice(2)], "--limit");
  const limit = limitStr ? Number.parseInt(limitStr, 10) : QUERY_LIMITS.logs;
  if (Number.isNaN(limit) || limit < 1) {
    ctx.output.error("--limit must be a positive integer");
    exitWith(EXIT.USER_ERROR);
  }
  try {
    const entries = await queryLogs(query, limit);
    if (ctx.output.isHuman) {
      ctx.output.printHuman(formatLogsHuman(query, entries));
    } else {
      ctx.output.print(formatQueryResult(query, entries));
    }
  } catch (err) {
    if (err instanceof QueryError) {
      ctx.output.error(err.message);
      exitWith(EXIT.USER_ERROR);
    }
    if (err instanceof StackUnreachableError) {
      ctx.output.error(err.message, err.cause);
      exitWith(EXIT.STACK_ERROR);
    }
    ctx.output.error("unexpected error", err instanceof Error ? err.message : String(err));
    exitWith(EXIT.STACK_ERROR);
  }
}

// src/commands/metrics.ts
function formatMetricLabel(metric) {
  const pairs = Object.entries(metric).filter(([k]) => k !== "__name__").map(([k, v]) => `${k}=${st(c.cyan, `"${v}"`)}`);
  const name = metric.__name__ ?? "";
  if (pairs.length === 0)
    return name || "{}";
  return `${name}{${pairs.join(",")}}`;
}
function formatMetricsHuman(query, samples) {
  const lines = [];
  lines.push(`  ${st(c.bold, "QUERY")}  ${st(c.dim, query)}`);
  lines.push(`  ${st(c.bold, "COUNT")}  ${samples.length} results`);
  if (samples.length > 0) {
    lines.push("");
    const header = [st(c.bold + c.dim, "METRIC"), st(c.bold + c.dim, "VALUE")];
    const rows = samples.map((s) => [formatMetricLabel(s.metric), s.value[1]]);
    lines.push(...alignColumns([header, ...rows]));
  }
  return lines.join(`
`);
}
async function runMetrics(ctx) {
  const query = ctx.args[0];
  if (!query) {
    ctx.output.error("missing query argument", "Usage: vx metrics <MetricsQL query>");
    exitWith(EXIT.USER_ERROR);
  }
  const limitStr = parseFlag([...ctx.args, ...process.argv.slice(2)], "--limit");
  const limit = limitStr ? Number.parseInt(limitStr, 10) : QUERY_LIMITS.metrics;
  if (Number.isNaN(limit) || limit < 1) {
    ctx.output.error("--limit must be a positive integer");
    exitWith(EXIT.USER_ERROR);
  }
  try {
    const result = await queryMetrics(query);
    const limited = { ...result, result: result.result.slice(0, limit) };
    if (ctx.output.isHuman) {
      ctx.output.printHuman(formatMetricsHuman(query, limited.result));
    } else {
      ctx.output.print(formatQueryResult(query, limited.result));
    }
  } catch (err) {
    if (err instanceof QueryError) {
      ctx.output.error(err.message);
      exitWith(EXIT.USER_ERROR);
    }
    if (err instanceof StackUnreachableError) {
      ctx.output.error(err.message, err.cause);
      exitWith(EXIT.STACK_ERROR);
    }
    ctx.output.error("unexpected error", err instanceof Error ? err.message : String(err));
    exitWith(EXIT.STACK_ERROR);
  }
}

// src/commands/status.ts
async function runStatus(ctx) {
  const checks = await Promise.allSettled(HEALTH_ENDPOINTS.map(async ({ name, url }) => {
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUTS.health) });
    return { name, healthy: res.ok, port: Number(new URL(url).port) };
  }));
  const services = checks.map((result, i) => {
    const { name } = HEALTH_ENDPOINTS[i];
    const port = Number(new URL(HEALTH_ENDPOINTS[i].url).port);
    if (result.status === "fulfilled") {
      return {
        name,
        status: result.value.healthy ? "healthy" : "degraded",
        port
      };
    }
    return { name, status: "unreachable", port };
  });
  if (ctx.output.isHuman) {
    const statusCell = (s) => {
      if (s === "healthy")
        return `${st(c.green, icon.ok)} ${s}`;
      if (s === "degraded")
        return `${st(c.yellow, icon.warn)} ${s}`;
      return `${st(c.red, icon.fail)} ${s}`;
    };
    const header = [st(c.bold + c.dim, "SERVICE"), st(c.bold + c.dim, "PORT"), st(c.bold + c.dim, "STATUS")];
    const rows = services.map((svc) => [svc.name, st(c.dim, `:${svc.port}`), statusCell(svc.status)]);
    ctx.output.printHuman(alignColumns([header, ...rows]).join(`
`));
  } else {
    ctx.output.print({ services });
  }
}

// src/commands/traces.ts
function formatDuration(us) {
  if (us < 1000)
    return `${us}\xB5s`;
  if (us < 1e6)
    return `${(us / 1000).toFixed(1)}ms`;
  return `${(us / 1e6).toFixed(2)}s`;
}
function formatTracesHuman(query, entries) {
  const lines = [];
  lines.push(`  ${st(c.bold, "QUERY")}  ${st(c.dim, query)}`);
  lines.push(`  ${st(c.bold, "COUNT")}  ${entries.length} results`);
  if (entries.length > 0) {
    lines.push("");
    const header = [
      st(c.bold + c.dim, "TIME"),
      st(c.bold + c.dim, "TRACE"),
      st(c.bold + c.dim, "OPERATION"),
      st(c.bold + c.dim, "DURATION")
    ];
    const rows = entries.map((e) => [
      st(c.dim, e._time),
      st(c.cyan, e.traceID.slice(0, 8)),
      e.operationName,
      formatDuration(e.duration)
    ]);
    lines.push(...alignColumns([header, ...rows]));
  }
  return lines.join(`
`);
}
async function runTraces(ctx) {
  const query = ctx.args[0];
  if (!query) {
    ctx.output.error("missing query argument", "Usage: vx traces <query>");
    exitWith(EXIT.USER_ERROR);
  }
  const limitStr = parseFlag([...ctx.args, ...process.argv.slice(2)], "--limit");
  const limit = limitStr ? Number.parseInt(limitStr, 10) : QUERY_LIMITS.traces;
  if (Number.isNaN(limit) || limit < 1) {
    ctx.output.error("--limit must be a positive integer");
    exitWith(EXIT.USER_ERROR);
  }
  try {
    const entries = await queryTraces(query, limit);
    if (ctx.output.isHuman) {
      ctx.output.printHuman(formatTracesHuman(query, entries));
    } else {
      ctx.output.print(formatQueryResult(query, entries));
    }
  } catch (err) {
    if (err instanceof QueryError) {
      ctx.output.error(err.message);
      exitWith(EXIT.USER_ERROR);
    }
    if (err instanceof StackUnreachableError) {
      ctx.output.error(err.message, err.cause);
      exitWith(EXIT.STACK_ERROR);
    }
    ctx.output.error("unexpected error", err instanceof Error ? err.message : String(err));
    exitWith(EXIT.STACK_ERROR);
  }
}

// src/lib/ports.ts
async function checkPortsAvailable() {
  const conflicts = [];
  for (const port of REQUIRED_PORTS) {
    try {
      const res = await fetch(`http://localhost:${port}`, {
        signal: AbortSignal.timeout(500)
      });
      if (res)
        conflicts.push(port);
    } catch {}
  }
  if (conflicts.length > 0) {
    throw new Error(`ports already in use: ${conflicts.join(", ")}. Stop the conflicting services before running vx up`);
  }
}

// src/lib/yaml.ts
function toYaml(obj, indent = 0) {
  if (obj === null || obj === undefined) {
    return "null";
  }
  if (typeof obj === "string") {
    if (obj === "" || obj.includes(":") || obj.includes("#") || obj.includes("{") || obj.includes("}") || obj.includes("[") || obj.includes("]") || obj.includes(",") || obj.includes("&") || obj.includes("*") || obj.includes("?") || obj.includes("|") || obj.includes(">") || obj.includes("!") || obj.includes("%") || obj.includes("@") || obj.includes("`") || obj.includes("'") || obj.includes('"') || obj.startsWith(" ") || obj.endsWith(" ") || obj === "true" || obj === "false" || obj === "null" || obj === "yes" || obj === "no" || /^\d+$/.test(obj)) {
      return `"${obj.replace(/\\/g, "\\\\").replace(/"/g, "\\\"")}"`;
    }
    return obj;
  }
  if (typeof obj === "number" || typeof obj === "boolean") {
    return String(obj);
  }
  const pad = "  ".repeat(indent);
  if (Array.isArray(obj)) {
    if (obj.length === 0)
      return "[]";
    const allSimple = obj.every((item) => typeof item !== "object" || item === null);
    if (allSimple) {
      return obj.map((item) => `${pad}- ${toYaml(item, 0)}`).join(`
`);
    }
    return obj.map((item) => {
      if (typeof item === "object" && item !== null && !Array.isArray(item)) {
        const entries = Object.entries(item);
        if (entries.length === 0)
          return `${pad}-`;
        const [firstKey, firstVal] = entries[0];
        const firstLine = `${pad}- ${firstKey}: ${typeof firstVal === "object" && firstVal !== null ? "" : toYaml(firstVal, 0)}`;
        const rest = entries.slice(1).map(([k, v]) => {
          if (typeof v === "object" && v !== null) {
            return `${pad}  ${k}:
${toYaml(v, indent + 2)}`;
          }
          return `${pad}  ${k}: ${toYaml(v, 0)}`;
        });
        if (typeof firstVal === "object" && firstVal !== null) {
          return `${pad}- ${firstKey}:
${toYaml(firstVal, indent + 2)}${rest.length > 0 ? `
${rest.join(`
`)}` : ""}`;
        }
        return [firstLine, ...rest].join(`
`);
      }
      return `${pad}- ${toYaml(item, 0)}`;
    }).join(`
`);
  }
  if (typeof obj === "object") {
    const entries = Object.entries(obj);
    if (entries.length === 0)
      return "{}";
    return entries.map(([key, val]) => {
      if (val === null || val === undefined) {
        return `${pad}${key}:`;
      }
      if (typeof val === "object") {
        if (!Array.isArray(val) && Object.keys(val).length === 0) {
          return `${pad}${key}: {}`;
        }
        const nested = toYaml(val, indent + 1);
        return `${pad}${key}:
${nested}`;
      }
      return `${pad}${key}: ${toYaml(val, 0)}`;
    }).join(`
`);
  }
  return String(obj);
}

// src/stack/compose.ts
function buildVictoriaMetrics() {
  return {
    image: IMAGES.victoriaMetrics,
    ports: ["8428:8428"],
    command: ["-retentionPeriod=1d", "-memory.allowedPercent=30", "-storageDataPath=/victoria-metrics-data"],
    volumes: ["vx-vm-data:/victoria-metrics-data"],
    networks: [VX_NETWORK],
    healthcheck: {
      test: ["CMD", "wget", "--no-verbose", "--tries=1", "--spider", "http://127.0.0.1:8428/health"],
      interval: "5s",
      timeout: "3s",
      retries: 10,
      start_period: "10s"
    },
    restart: "no"
  };
}
function buildVictoriaLogs() {
  return {
    image: IMAGES.victoriaLogs,
    ports: ["9428:9428"],
    command: ["-retentionPeriod=1d", "-memory.allowedPercent=30", "-storageDataPath=/victoria-logs-data"],
    volumes: ["vx-vl-data:/victoria-logs-data"],
    networks: [VX_NETWORK],
    healthcheck: {
      test: ["CMD", "wget", "--no-verbose", "--tries=1", "--spider", "http://127.0.0.1:9428/health"],
      interval: "5s",
      timeout: "3s",
      retries: 10,
      start_period: "10s"
    },
    restart: "no"
  };
}
function buildVictoriaTraces() {
  return {
    image: IMAGES.victoriaTraces,
    ports: ["10428:10428"],
    command: ["-retentionPeriod=1d", "-memory.allowedPercent=30", "-storageDataPath=/victoria-traces-data"],
    volumes: ["vx-vt-data:/victoria-traces-data"],
    networks: [VX_NETWORK],
    healthcheck: {
      test: ["CMD", "wget", "--no-verbose", "--tries=1", "--spider", "http://127.0.0.1:10428/health"],
      interval: "5s",
      timeout: "3s",
      retries: 10,
      start_period: "10s"
    },
    restart: "no"
  };
}
function buildOtelCollector() {
  return {
    image: IMAGES.otelCollector,
    ports: ["4317:4317", "4318:4318", "13133:13133"],
    volumes: ["./otel-collector.yaml:/etc/otelcol-contrib/config.yaml:ro"],
    networks: [VX_NETWORK],
    healthcheck: {
      test: ["CMD", "wget", "--no-verbose", "--tries=1", "--spider", "http://127.0.0.1:13133/"],
      interval: "5s",
      timeout: "3s",
      retries: 10,
      start_period: "10s"
    },
    restart: "no",
    depends_on: {
      "victoria-metrics": { condition: "service_healthy" },
      "victoria-logs": { condition: "service_healthy" },
      "victoria-traces": { condition: "service_healthy" }
    }
  };
}
function buildComposeConfig() {
  return {
    name: VX_PROJECT_NAME,
    services: {
      "victoria-metrics": buildVictoriaMetrics(),
      "victoria-logs": buildVictoriaLogs(),
      "victoria-traces": buildVictoriaTraces(),
      "otel-collector": buildOtelCollector()
    },
    volumes: {
      "vx-vm-data": null,
      "vx-vl-data": null,
      "vx-vt-data": null
    },
    networks: {
      [VX_NETWORK]: { driver: "bridge" }
    }
  };
}
async function generateComposeFile() {
  const config = buildComposeConfig();
  const yaml = toYaml(config);
  await Bun.write(getComposePath(), `${yaml}
`);
}

// src/stack/otel.ts
function buildOtelConfig() {
  return {
    receivers: {
      otlp: {
        protocols: {
          grpc: { endpoint: "0.0.0.0:4317" },
          http: { endpoint: "0.0.0.0:4318" }
        }
      }
    },
    exporters: {
      "otlphttp/metrics": {
        endpoint: "http://victoria-metrics:8428",
        tls: { insecure: true }
      },
      "otlphttp/logs": {
        endpoint: "http://victoria-logs:9428/insert/opentelemetry",
        tls: { insecure: true }
      },
      "otlphttp/traces": {
        endpoint: "http://victoria-traces:10428/insert/opentelemetry",
        tls: { insecure: true }
      }
    },
    processors: {
      batch: {}
    },
    extensions: {
      health_check: {
        endpoint: "0.0.0.0:13133"
      }
    },
    service: {
      extensions: ["health_check"],
      pipelines: {
        metrics: {
          receivers: ["otlp"],
          processors: ["batch"],
          exporters: ["otlphttp/metrics"]
        },
        logs: {
          receivers: ["otlp"],
          processors: ["batch"],
          exporters: ["otlphttp/logs"]
        },
        traces: {
          receivers: ["otlp"],
          processors: ["batch"],
          exporters: ["otlphttp/traces"]
        }
      }
    }
  };
}
async function generateOtelConfig() {
  const config = buildOtelConfig();
  const yaml = toYaml(config);
  await Bun.write(getOtelConfigPath(), `${yaml}
`);
}

// src/commands/up.ts
async function runUp(ctx) {
  const running = await isStackRunning();
  if (running) {
    if (ctx.output.isHuman) {
      ctx.output.printHuman(`  ${st(c.yellow, icon.dot)} stack is already running`);
    } else {
      ctx.output.print({ status: "already_running", message: "stack is already running" });
    }
    return;
  }
  try {
    await checkPortsAvailable();
  } catch (err) {
    ctx.output.error("port conflict", err instanceof Error ? err.message : String(err));
    exitWith(EXIT.STACK_ERROR);
  }
  await ensureVxDir();
  await generateComposeFile();
  await generateOtelConfig();
  const result = composeRun(["up", "-d"], getComposePath());
  if (result.exitCode !== 0) {
    ctx.output.error("docker compose up failed", result.stderr);
    exitWith(EXIT.STACK_ERROR);
  }
  try {
    await waitForStack();
  } catch (err) {
    ctx.output.error("stack health check timeout", err instanceof Error ? err.message : String(err));
    exitWith(EXIT.STACK_ERROR);
  }
  if (ctx.output.isHuman) {
    ctx.output.printHuman(`  ${st(c.green, icon.dot)} stack is ready`);
  } else {
    ctx.output.print({ status: "running", message: "stack is ready" });
  }
}

// src/lib/output.ts
function buildOutputHelper(flags) {
  const isJson = flags.json || !process.stdout.isTTY;
  const isHuman = !flags.json && !flags.quiet && (process.stdout.isTTY ?? false);
  return {
    isHuman,
    print(data) {
      if (isJson) {
        process.stdout.write(`${JSON.stringify(data)}
`);
      } else {
        process.stdout.write(`${JSON.stringify(data, null, 2)}
`);
      }
    },
    printHuman(text) {
      if (!flags.quiet) {
        process.stdout.write(`${text}
`);
      }
    },
    error(message, detail) {
      if (isJson) {
        process.stderr.write(`${JSON.stringify({ error: message, detail })}
`);
      } else {
        process.stderr.write(`  ${st(c.bold + c.red, "error")}  ${message}
`);
        if (detail && flags.verbose) {
          process.stderr.write(`${st(c.dim, `         ${String(detail)}`)}
`);
        }
      }
    }
  };
}

// src/lib/context.ts
function buildContext(rawArgs) {
  const command = rawArgs[0] ?? "";
  const rest = rawArgs.slice(1);
  const flags = parseGlobalFlags(rest);
  const args = stripFlags(rest);
  return { command, args, flags, output: buildOutputHelper(flags) };
}

// src/lib/help.ts
var h = (label) => st(c.bold, label);
var cmd = (name, desc) => `    ${st(c.cyan, name.padEnd(16))}${desc}`;
var flag = (name, desc) => `    ${st(c.dim, name.padEnd(16))}${desc}`;
var HELP_TEXT = `  ${st(c.bold + c.cyan, "vx")} ${st(c.dim, "\u2014")} ephemeral observability for coding agents

  ${h("USAGE")}
    vx <command> [flags] [args]

  ${h("COMMANDS")}
${cmd("up", "Start the Victoria observability stack")}
${cmd("down", "Destroy the stack and all data")}
${cmd("status", "Health check of all services")}
${cmd("init", "Install vx skills and configure CLAUDE.md")}
${cmd("metrics <query>", "Query Victoria Metrics (MetricsQL)")}
${cmd("logs <query>", "Query Victoria Logs (LogsQL)")}
${cmd("traces <query>", "Query Victoria Traces")}
${cmd("check <gate>", "Evaluate a quality gate \u2192 exit 0/1")}

  ${h("GLOBAL FLAGS")}
${flag("--json", "Force JSON output (default when not TTY)")}
${flag("--quiet", "Suppress informational output")}
${flag("--verbose", "Show additional diagnostic detail")}
${flag("--help, -h", "Show help")}
${flag("--version, -v", "Show version")}

  ${h("EXAMPLES")}
    ${st(c.dim, "$")} vx up
    ${st(c.dim, "$")} vx init
    ${st(c.dim, "$")} vx metrics 'rate(http_requests_total[5m])'
    ${st(c.dim, "$")} vx logs '{app="api"} error _time:5m'
    ${st(c.dim, "$")} vx check latency 'http_request_duration_seconds' --p99 --max=2s
    ${st(c.dim, "$")} vx down`;
// package.json
var package_default = {
  name: "@appranks/vx",
  version: "0.0.8",
  description: "Ephemeral observability for coding agents",
  type: "module",
  license: "MIT",
  repository: {
    type: "git",
    url: "https://github.com/appranks/vx.git"
  },
  bin: {
    vx: "./bin/vx.js"
  },
  files: [
    "bin",
    "dist"
  ],
  publishConfig: {
    registry: "https://npm.pkg.github.com",
    access: "public"
  },
  scripts: {
    dev: "bun run src/cli.ts",
    build: "bun build src/cli.ts --outdir dist --target bun",
    check: "tsc --noEmit",
    format: "biome format --write .",
    lint: "biome check .",
    "lint:fix": "biome check --write .",
    test: "vitest run",
    "test:watch": "vitest",
    validate: "bash scripts/validate.sh",
    "publish:gpr": "npm publish",
    prepare: "husky"
  },
  engines: {
    node: ">=22",
    bun: ">=1.2"
  },
  devDependencies: {
    "@biomejs/biome": "2.4.8",
    "@types/bun": "1.3.11",
    "@vitest/coverage-v8": "^4.1.0",
    husky: "9.1.7",
    typescript: "5.9.3",
    vitest: "4.1.0"
  }
};

// src/lib/version.ts
var VERSION = package_default.version;

// src/cli.ts
var COMMANDS = {
  up: runUp,
  down: runDown,
  status: runStatus,
  metrics: runMetrics,
  logs: runLogs,
  traces: runTraces,
  check: runCheck,
  init: runInit
};
process.on("SIGINT", () => {
  process.stderr.write(`
interrupted
`);
  process.exit(EXIT.OK);
});
process.on("SIGTERM", () => {
  process.stderr.write(`terminated
`);
  process.exit(EXIT.OK);
});
async function main() {
  const rawArgs = process.argv.slice(2);
  const flags = parseGlobalFlags(rawArgs);
  if (flags.version) {
    process.stdout.write(`  ${st(c.bold + c.cyan, "vx")} ${st(c.dim, VERSION)}
`);
    process.exit(EXIT.OK);
  }
  const commandName = rawArgs.find((a) => !a.startsWith("-"));
  const handler = commandName ? COMMANDS[commandName] : undefined;
  if (flags.help && !handler) {
    process.stdout.write(`${HELP_TEXT}
`);
    process.exit(EXIT.OK);
  }
  if (!handler) {
    const output = buildOutputHelper(flags);
    output.error(`unknown command: ${commandName ?? "(none)"}`, "Run vx --help for available commands");
    process.exit(EXIT.USER_ERROR);
  }
  const ctx = buildContext(rawArgs);
  await handler(ctx);
}
main().catch((err) => {
  process.stderr.write(`  ${st(c.bold + c.red, "fatal")}  ${err instanceof Error ? err.message : String(err)}
`);
  process.exit(EXIT.STACK_ERROR);
});
