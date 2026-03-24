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

// src/skills/vx/references/bun.md
var bun_default = `# Bun Template

Setup for Bun runtime apps. Key limitation: **no auto-instrumentations**.

## Why Bun is different

Bun does not support Node.js \`diagnostics_channel\`, which is the mechanism \`@opentelemetry/auto-instrumentations-node\` uses to monkey-patch libraries. This means:

- No automatic HTTP instrumentation
- No automatic DB instrumentation
- No automatic logger bridging

You must use explicit instrumentation (e.g., \`@hono/otel\` for Hono) and manual spans for business logic.

## Template: \`instrumentation.ts\` (app root)

\`\`\`typescript
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { BatchLogRecordProcessor } from "@opentelemetry/sdk-logs";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";

const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? "http://localhost:4318";

const sdk = new NodeSDK({
  resource: resourceFromAttributes({
    [ATTR_SERVICE_NAME]: process.env.OTEL_SERVICE_NAME ?? "my-service",
  }),
  traceExporter: new OTLPTraceExporter({
    url: \`\${endpoint}/v1/traces\`,
  }),
  metricReaders: [
    new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter({
        url: \`\${endpoint}/v1/metrics\`,
      }),
      exportIntervalMillis: 15_000,
    }),
  ],
  logRecordProcessors: [
    new BatchLogRecordProcessor(
      new OTLPLogExporter({
        url: \`\${endpoint}/v1/logs\`,
      }),
    ),
  ],
  // No auto-instrumentations \u2014 Bun lacks diagnostics_channel support
});

sdk.start();
process.on("beforeExit", () => sdk.shutdown());
\`\`\`

**Note:** Use \`beforeExit\` instead of \`SIGTERM\` for Bun's lifecycle.

## Hono on Bun

For Hono apps on Bun, install \`@hono/otel\` for route-level tracing:

\`\`\`typescript
import { instrument } from "@hono/otel";

const app = new Hono();
// ... routes ...

export default instrument(app);
\`\`\`

This is the primary source of trace spans on Bun since auto-instrumentation is unavailable.

## Preload the instrumentation file

Bun uses \`--preload\` to load the instrumentation before the app:

\`\`\`bash
bun run --preload ./instrumentation.ts src/index.ts
\`\`\`

Or in \`bunfig.toml\`:

\`\`\`toml
preload = ["./instrumentation.ts"]
\`\`\`

Or in \`package.json\` scripts:

\`\`\`json
{
  "scripts": {
    "dev": "bun run --preload ./instrumentation.ts src/index.ts"
  }
}
\`\`\`

## Install dependencies

Before installing, look up the latest stable version of each package on npm. Do NOT use hardcoded versions \u2014 they go stale quickly. Use \`npm view <package> version\` or check the package's npm page.

\`\`\`bash
bun add @hono/otel \\
  @opentelemetry/api \\
  @opentelemetry/sdk-node \\
  @opentelemetry/exporter-trace-otlp-http \\
  @opentelemetry/exporter-metrics-otlp-http \\
  @opentelemetry/exporter-logs-otlp-http \\
  @opentelemetry/resources \\
  @opentelemetry/sdk-metrics \\
  @opentelemetry/sdk-logs \\
  @opentelemetry/semantic-conventions
\`\`\`

**IMPORTANT:** NEVER add \`@opentelemetry/auto-instrumentations-node\` for Bun projects. It will fail at runtime.

## Logs on Bun

Since auto-instrumentation log bridges (Pino, Winston) don't work on Bun, you have two options for logs:

1. **Use \`@opentelemetry/api\` logs directly** \u2014 create a \`LoggerProvider\` and emit log records manually.
2. **Use a Pino transport** \u2014 \`pino-opentelemetry-transport\` runs in a worker thread and exports logs independently (does not require auto-instrumentation).

For option 2, see [log-bridges.md](log-bridges.md) under the "Bun alternative" section.
`;

// src/skills/vx/references/diagnostics.md
var diagnostics_default = `# Diagnostics

Troubleshooting guide when telemetry is not appearing in vx.

## Quick checklist

Run these checks in order. Stop at the first failure.

### 1. Is the vx stack running?

\`\`\`bash
npx vx status
\`\`\`

Expected: all 4 services \`healthy\` (victoria-metrics, victoria-logs, victoria-traces, otel-collector).

If not:
\`\`\`bash
npx vx up
\`\`\`

If \`vx up\` fails, check Docker is running: \`docker info\`.

### 2. Is the OTel Collector reachable?

\`\`\`bash
curl -s http://localhost:13133/ | head -1
\`\`\`

Expected: HTTP 200. This is the collector's health endpoint.

If unreachable: the collector container may have crashed. Check logs:
\`\`\`bash
docker logs vx-otel-collector-1
\`\`\`

### 3. Is the tracing/instrumentation file loaded?

| Runtime | Check |
|---------|-------|
| Node.js | \`import "./tracing.js"\` or \`import "./tracing"\` is the **first line** in the entry file |
| Bun | \`--preload ./instrumentation.ts\` in the start script, or \`preload\` in \`bunfig.toml\` |
| Next.js | \`instrumentation.ts\` exists in the app root (next to \`next.config.ts\`) with an exported \`register()\` function |

Common mistake: importing \`tracing.ts\` AFTER other libraries. The import must be first.

### 4. Is the exporter URL correct?

Check that the OTLP endpoint resolves to \`http://localhost:4318\`:

- **Env var**: \`OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318\` in the app's env file
- **Code**: hardcoded URL or env var with default to \`http://localhost:4318\`

Common mistake: using gRPC port \`:4317\` instead of HTTP port \`:4318\`.

### 5. Are all 3 signals configured?

Read the tracing/instrumentation file and verify:

| Signal | NodeSDK property | Present? |
|--------|-----------------|----------|
| Traces | \`traceExporter\` | Check for \`OTLPTraceExporter\` |
| Metrics | \`metricReaders\` | Check for \`PeriodicExportingMetricReader\` + \`OTLPMetricExporter\` |
| Logs | \`logRecordProcessors\` | Check for \`BatchLogRecordProcessor\` + \`OTLPLogExporter\` |

If any are missing, add them. See [signals.md](signals.md) for the exact code.

### 6. Is the logger sending to OTel?

If the app uses Pino but logs don't appear in vx:

**If using \`pino-opentelemetry-transport\` (recommended):**

1. Verify \`pino-opentelemetry-transport\` is installed: check \`package.json\` dependencies
2. Verify \`OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318\` is set in the env file (the transport worker thread reads it from env, NOT from the NodeSDK)
3. Verify the logger uses \`pino.multistream()\` with the OTel transport as a stream
4. Verify \`logRecordProcessors\` exists in the NodeSDK config (in \`tracing.ts\`)
5. Check for duplicate log sending: if auto-instrumentations are also active, ensure \`"@opentelemetry/instrumentation-pino": { disableLogSending: true }\` is set

**If using auto-instrumentation (CJS only):**

1. Verify the project is NOT using ESM (\`"type": "module"\` in package.json means ESM)
2. Verify the project is NOT using tsx as the runner
3. Verify the logger is instantiated AFTER \`tracing.ts\` is imported
4. Verify \`logRecordProcessors\` exists in the NodeSDK config
5. If ANY of the above fail \u2192 switch to \`pino-opentelemetry-transport\` approach (see [node.md](node.md#template-srcloggerts))

### 7. Enable OTel debug logging

Set in the app's environment and restart:

\`\`\`bash
OTEL_LOG_LEVEL=debug
\`\`\`

Check stderr for messages like:
- \`@opentelemetry/sdk-node - starting\` \u2014 SDK initialized
- \`@opentelemetry/exporter-trace-otlp-http - exporting\` \u2014 traces being sent
- \`@opentelemetry/exporter-metrics-otlp-http - exporting\` \u2014 metrics being sent
- \`@opentelemetry/sdk-logs - exporting\` \u2014 logs being sent

If you see export errors, the collector may not be accepting the signal.

## Signal-specific diagnosis

### Traces present, metrics missing

Metrics are exported on a timer (\`exportIntervalMillis\`, default 15s). Wait at least 30 seconds after app start before checking.

If still missing:
- Verify \`metricReaders\` (plural) is set in NodeSDK config
- Check that \`@opentelemetry/sdk-metrics\` and \`@opentelemetry/exporter-metrics-otlp-http\` are installed

### Traces present, logs missing

This is the most common issue. Logs require ALL of:

1. \`logRecordProcessors\` in the SDK config (\`tracing.ts\`)
2. A log transport configured in the logger (\`logger.ts\` with \`pino-opentelemetry-transport\`)
3. \`OTEL_EXPORTER_OTLP_ENDPOINT\` set in the env file (for the transport worker thread)

**Most common cause:** The SDK was configured with \`logRecordProcessors\` but the Pino logger was NOT configured with the transport. The SDK log pipeline is ready but receives no application logs because the logger doesn't know about it.

**Fix:** Configure \`pino-opentelemetry-transport\` in the Pino logger as shown in [node.md](node.md#template-srcloggerts). Ensure the env var is set.

If the app has no logger (no Pino/Winston/Bunyan), logs will only appear from OTel-native sources. Most server apps need a structured logger to produce useful log data.

### No data at all

1. Generate traffic (e.g., \`curl http://localhost:PORT/health\`)
2. Wait 15 seconds
3. Re-query: \`npx vx traces '*'\`

If still nothing:
- The app may not be receiving requests (check port, network)
- The SDK may have failed to start (check stderr for errors)
- Dependencies may be missing or wrong version (check \`node_modules\`)
`;

// src/skills/vx/references/env-vars.md
var env_vars_default = "# Environment Variables\n\nComplete reference for OpenTelemetry environment variables used with vx.\n\n## Required\n\n| Variable | Value | Purpose |\n|----------|-------|---------|\n| `OTEL_EXPORTER_OTLP_ENDPOINT` | `http://localhost:4318` | Base URL for all OTLP HTTP exporters |\n| `OTEL_SERVICE_NAME` | e.g., `my-api`, `my-web` | Identifies the service in traces, metrics, and logs |\n\n## Worker thread considerations\n\n`pino-opentelemetry-transport` runs in a Pino worker thread \u2014 a separate Node.js `Worker` instance. This worker thread:\n\n1. **Does NOT inherit** configuration from the NodeSDK instance in the main thread\n2. **Does inherit** environment variables from the parent process (`process.env`)\n3. **Reads `OTEL_EXPORTER_OTLP_ENDPOINT`** to know where to send logs\n4. **Reads `OTEL_SERVICE_NAME`** via `resourceAttributes` in the transport options\n\nThis means `OTEL_EXPORTER_OTLP_ENDPOINT` is doubly important when using Pino:\n- The **main thread NodeSDK** uses it for traces and metrics\n- The **worker thread transport** uses it for logs\n\nIf the env var is only set in code (e.g., `process.env.OTEL_EXPORTER_OTLP_ENDPOINT = \"...\"` at runtime), it may not propagate to the worker thread depending on when the transport is created. **Always set it in the env file** to guarantee both threads see it.\n\n## Optional\n\n| Variable | Default | Purpose |\n|----------|---------|---------|\n| `OTEL_LOG_LEVEL` | `info` | OTel SDK log level. Set to `debug` for troubleshooting |\n| `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` | `${OTEL_EXPORTER_OTLP_ENDPOINT}/v1/traces` | Override traces endpoint |\n| `OTEL_EXPORTER_OTLP_METRICS_ENDPOINT` | `${OTEL_EXPORTER_OTLP_ENDPOINT}/v1/metrics` | Override metrics endpoint |\n| `OTEL_EXPORTER_OTLP_LOGS_ENDPOINT` | `${OTEL_EXPORTER_OTLP_ENDPOINT}/v1/logs` | Override logs endpoint |\n| `OTEL_TRACES_SAMPLER` | `parentbased_always_on` | Sampling strategy. Use `always_on` for dev |\n| `OTEL_METRICS_EXPORT_INTERVAL` | `60000` | Metric export interval in ms. Templates use `15000` for dev |\n| `LOG_LEVEL` | `info` | App-level Pino log level (read by logger.ts independently) |\n\n## Env file detection rules\n\nThe skill detects which env file to use per app, in this order:\n\n1. `.env.local` exists \u2192 use it (common in Next.js projects)\n2. `.env.development` exists \u2192 use it (common in multi-environment setups)\n3. `.env` exists \u2192 use it (single env file projects)\n4. None exist \u2192 create `.env.local`\n\n## Template\n\nAdd these lines to the detected env file:\n\n```bash\n# OpenTelemetry \u2014 vx observability\nOTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318\nOTEL_SERVICE_NAME=<service-name>\n```\n\nReplace `<service-name>` with the actual service name (e.g., `my-api`, `my-web`).\n\n## Monorepo considerations\n\nEach app in a monorepo should have:\n- Its own `OTEL_SERVICE_NAME` (distinct per app)\n- The same `OTEL_EXPORTER_OTLP_ENDPOINT` (all point to `localhost:4318`)\n\nIf apps share an env file (e.g., root `.env`), the service name should be set in code with a fallback:\n\n```typescript\nprocess.env.OTEL_SERVICE_NAME ?? \"my-default-name\"\n```\n";

// src/skills/vx/references/log-bridges.md
var log_bridges_default = `# Log Bridges

How application loggers (Pino, Winston, Bunyan) forward logs to OpenTelemetry.

> **DEFAULT APPROACH:** Always use \`pino-opentelemetry-transport\` for Pino. Auto-instrumentation (\`@opentelemetry/instrumentation-pino\`) silently fails with ESM + tsx + pnpm, which covers most modern TypeScript projects. Only use auto-instrumentation if the project is confirmed CJS-only AND uses plain \`node\` (not tsx/ts-node).

## Two approaches

| Approach | How it works | When to use | Reliability |
|----------|-------------|-------------|-------------|
| **pino-opentelemetry-transport** (recommended) | Pino transport in a worker thread, sends to OTLP directly | ALL environments: ESM, CJS, tsx, Bun, pnpm, npm | Works everywhere |
| **Auto-instrumentation** (fallback) | \`instrumentation-pino\` monkey-patches Pino at import time | CJS-only projects using plain \`node\` (not tsx) | Breaks with ESM + tsx + pnpm |

## Approach 1: pino-opentelemetry-transport (recommended)

Works with ESM, tsx, Bun, pnpm \u2014 no dependency on auto-instrumentation hooks.

### Install

\`\`\`bash
pnpm add pino-opentelemetry-transport
\`\`\`

### Configure the logger

\`\`\`typescript
import { context, trace } from "@opentelemetry/api";
import pino from "pino";

const otelTransport = pino.transport({
  target: "pino-opentelemetry-transport",
  options: {
    resourceAttributes: {
      "service.name": process.env.OTEL_SERVICE_NAME ?? "my-service",
    },
  },
});

const logger = pino(
  {
    level: process.env.LOG_LEVEL ?? "info",
    // Trace correlation: inject trace_id/span_id from active span
    mixin() {
      const span = trace.getSpan(context.active());
      if (!span) return {};
      const { traceId, spanId, traceFlags } = span.spanContext();
      return { trace_id: traceId, span_id: spanId, trace_flags: traceFlags };
    },
  },
  // Send to both stdout and OTel
  pino.multistream([{ stream: process.stdout }, { stream: otelTransport }]),
);
\`\`\`

### How it works

1. **Log sending**: The transport runs in a Pino worker thread. It reads \`OTEL_EXPORTER_OTLP_ENDPOINT\` automatically and sends logs via OTLP HTTP/protobuf to the collector.
2. **Trace correlation**: The \`mixin()\` function reads the active span from \`@opentelemetry/api\` (which uses AsyncLocalStorage). The \`trace_id\` and \`span_id\` are added to every log record emitted within a traced request. The transport reads these fields and attaches them to the OTel LogRecord context.
3. **Dual output**: \`pino.multistream()\` sends logs to both stdout (for local dev) and the OTel transport (for vx).

### Required env vars

The transport worker thread reads these automatically:

\`\`\`bash
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318   # Collector endpoint
OTEL_SERVICE_NAME=my-service                         # Service identity
\`\`\`

**Why the transport needs its own env vars:** The transport runs in a Pino worker thread \u2014 a separate Node.js worker. It does not share memory with the main thread's NodeSDK instance. It discovers the collector endpoint by reading \`OTEL_EXPORTER_OTLP_ENDPOINT\` from \`process.env\` inside the worker. If this variable is not set, the transport defaults to \`http://localhost:4318\` which is correct for vx, but if the app's env loading mechanism (like \`dotenv\`) runs only in the main thread, the worker thread won't see custom env values. Always set OTel env vars in the actual env file, not programmatically.

### Severity mapping

| Pino Level | Pino Number | OTel Severity |
|------------|-------------|---------------|
| trace | 10 | TRACE |
| debug | 20 | DEBUG |
| info | 30 | INFO |
| warn | 40 | WARN |
| error | 50 | ERROR |
| fatal | 60 | FATAL |

## Disabling auto-instrumentation log sending when using the transport

If you use \`pino-opentelemetry-transport\` AND the project has \`@opentelemetry/auto-instrumentations-node\`, disable \`instrumentation-pino\`'s log sending to avoid duplicate logs:

\`\`\`typescript
// In tracing.ts
getNodeAutoInstrumentations({
  "@opentelemetry/instrumentation-fs": { enabled: false },
  "@opentelemetry/instrumentation-dns": { enabled: false },
  "@opentelemetry/instrumentation-net": { enabled: false },
  "@opentelemetry/instrumentation-pino": { disableLogSending: true },
}),
\`\`\`

This is already handled in the [node.md](node.md) template. If modifying an existing tracing file, add \`disableLogSending: true\` for the pino instrumentation.

## Approach 2: Auto-instrumentation (CJS only)

\`@opentelemetry/auto-instrumentations-node\` includes logger instrumentations enabled by default:

| Logger | Instrumentation |
|--------|----------------|
| Pino | \`@opentelemetry/instrumentation-pino\` |
| Winston | \`@opentelemetry/instrumentation-winston\` |
| Bunyan | \`@opentelemetry/instrumentation-bunyan\` |

### Requirements

1. \`logRecordProcessors\` configured in the NodeSDK (see [signals.md](signals.md))
2. The tracing file imported **before** the logger
3. **CJS module system** (CommonJS) \u2014 NOT ESM

No changes to the logger code are needed with this approach.

### Why auto-instrumentation fails with ESM + tsx + pnpm

Three independent issues combine to break it:

1. **ESM skips \`require()\`** \u2014 \`instrumentation-pino\` hooks into \`require()\` via \`require-in-the-middle\`. ESM imports don't trigger \`require()\`. Core modules (http, https) always use \`require()\` internally, which is why \`instrumentation-http\` works but \`instrumentation-pino\` doesn't.

2. **tsx conflicts with \`import-in-the-middle\`** \u2014 Both tsx and OTel's ESM support register \`module.register()\` hooks. These hooks run in LIFO order and conflict. tsx transforms \`.ts\` \u2192 \`.js\` before OTel's hook can intercept the module by name.

3. **pnpm symlinks affect module name matching** \u2014 \`import-in-the-middle\` matches by module name (\`"pino"\`), but pnpm resolves to real paths inside \`.pnpm/\` store. The name matching can fail.

**Bottom line:** If you use ESM + tsx, auto-instrumentation for user-land packages (pino, express, pg) will silently fail. Use the transport approach instead.

## Common issues

| Issue | Cause | Fix |
|-------|-------|-----|
| Logs not appearing in vx | Transport can't reach collector | Set \`OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318\` in env |
| Logs appear but no \`trace_id\` | Missing \`mixin()\` in Pino config | Add the \`mixin()\` function that reads active span context |
| Duplicate logs in vx | Both auto-instrumentation AND transport active | Disable auto-instrumentation: \`"@opentelemetry/instrumentation-pino": { disableLogSending: true }\` |
| No logs with ESM + tsx | Auto-instrumentation doesn't work with ESM | Switch to \`pino-opentelemetry-transport\` approach |
`;

// src/skills/vx/references/manual-spans.md
var manual_spans_default = `# Manual Spans for Library Packages

When and how to add custom OpenTelemetry spans in shared libraries and packages.

## The rule

| Layer | What to use | Example |
|-------|------------|---------|
| **Apps** (servers, CLIs) | \`@opentelemetry/sdk-node\` + exporters | \`apps/engine/src/tracing.ts\` |
| **Libraries** (packages) | \`@opentelemetry/api\` ONLY | \`packages/sdk/src/daytona.ts\` |

Libraries NEVER import the SDK, exporters, or processors. They only use the API, which is a **no-op** when no SDK is registered. Zero overhead if consumed by an app without OTel.

## When a package needs manual spans

| Condition | Needs manual spans? | Why |
|-----------|:-------------------:|-----|
| Uses a library with auto-instrumentation (pg, undici, express) | No | Auto-instrumentation handles it |
| Uses a library WITHOUT auto-instrumentation (postgres.js, custom SDKs) | **Yes** | Operations are invisible |
| Wraps business-critical operations (provision sandbox, run agent) | **Yes** | Need domain context beyond "HTTP request" |
| Pure data transforms, schemas, types | No | No I/O, nothing to trace |

### Known libraries WITHOUT auto-instrumentation

These popular libraries are NOT covered by \`@opentelemetry/auto-instrumentations-node\`:

- \`postgres\` (postgres.js) \u2014 uses raw TCP sockets, not \`pg\`
- \`@daytonaio/sdk\` \u2014 proprietary SDK
- \`better-auth\` \u2014 HTTP calls are auto-instrumented, but auth operations are not
- Custom REST/gRPC clients
- File-based operations via custom abstractions

## Pattern: \`tracer.startActiveSpan()\`

\`\`\`typescript
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
\`\`\`

### Key points

- \`trace.getTracer()\` returns a no-op tracer if no SDK is present \u2014 safe for any consumer.
- \`startActiveSpan\` creates a child span under the current context \u2014 automatic parent propagation.
- Always \`span.end()\` in \`finally\` to avoid leaked spans.
- Add attributes that provide domain context (\`project.id\`, \`run.id\`, \`sandbox.status\`).

## Pattern: Database wrapper

For database libraries without auto-instrumentation (e.g., postgres.js with Drizzle):

\`\`\`typescript
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
\`\`\`

For more granular tracing, wrap individual operations:

\`\`\`typescript
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
\`\`\`

## Dependency

The only dependency a library package needs (look up the latest stable version on npm before installing):

\`\`\`bash
pnpm add @opentelemetry/api
\`\`\`

This is the **only** OpenTelemetry package a library should depend on. Never add \`@opentelemetry/sdk-node\`, exporters, or processors to a library package.

## Decision table for monorepo packages

| Package type | Auto-instrumented? | Manual spans? | Priority |
|-------------|:------------------:|:-------------:|:--------:|
| DB layer (uses \`pg\`) | Yes | Optional | Low |
| DB layer (uses \`postgres\`/postgres.js) | **No** | **Yes** | High |
| SDK wrapper (external APIs) | HTTP: Yes, Business logic: No | **Yes** | High |
| Auth (uses HTTP internally) | Partially | Optional | Low |
| Types/schemas (no I/O) | N/A | No | \u2014 |
| Shared utilities (pure functions) | N/A | No | \u2014 |
`;

// src/skills/vx/references/nextjs.md
var nextjs_default = `# Next.js Template

Complete \`instrumentation.ts\` for Next.js apps with all three signals using \`@vercel/otel\`.

## Template: \`instrumentation.ts\` (app root)

\`\`\`typescript
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
          url: \`\${endpoint}/v1/metrics\`,
        }),
        exportIntervalMillis: 15_000,
      }),
    ],
    logRecordProcessors: [
      new BatchLogRecordProcessor(
        new OTLPLogExporter({
          url: \`\${endpoint}/v1/logs\`,
        }),
      ),
    ],
  });
}
\`\`\`

## Why dynamic imports?

Next.js has two runtimes: \`nodejs\` (default) and \`edge\`. The OTel SDK packages (\`@opentelemetry/sdk-metrics\`, \`@opentelemetry/sdk-logs\`) depend on Node.js APIs that don't exist in Edge.

Using \`await import()\` ensures the bundler only includes these modules in the Node.js bundle. The \`NEXT_RUNTIME\` env var is set automatically by Next.js.

## Why \`register()\` is async

Next.js \`instrumentation.ts\` supports async \`register()\` functions. The dynamic imports require \`await\`, so the function must be \`async\`.

## How @vercel/otel handles traces

\`@vercel/otel\` automatically configures the trace exporter using the \`OTEL_EXPORTER_OTLP_ENDPOINT\` environment variable. You don't need to create a \`OTLPTraceExporter\` manually \u2014 it's handled internally. The \`metricReaders\` and \`logRecordProcessors\` are the only additions needed.

## Install dependencies

Run inside the Next.js app directory. Before installing, look up the latest stable version of each package on npm. Do NOT use hardcoded versions \u2014 they go stale quickly. Use \`npm view <package> version\` or check the package's npm page.

\`\`\`bash
pnpm add @vercel/otel \\
  @opentelemetry/api \\
  @opentelemetry/exporter-metrics-otlp-http \\
  @opentelemetry/exporter-logs-otlp-http \\
  @opentelemetry/sdk-metrics \\
  @opentelemetry/sdk-logs
\`\`\`

## What gets instrumented

- **Server Components**: Run in Node.js runtime \u2014 all 3 signals work.
- **Route Handlers**: Run in Node.js runtime \u2014 all 3 signals work.
- **Middleware**: Runs in Edge runtime \u2014 traces only.
- **Client Components**: No server-side telemetry (browser-side OTel is out of scope).
- **\`fetch()\` calls**: Automatically instrumented by \`@vercel/otel\` with span propagation.

## File location

\`instrumentation.ts\` must be in the **app root** (next to \`next.config.ts\`), NOT inside \`src/\`. Next.js auto-discovers it at startup.

## Logs in Next.js

Next.js apps typically use \`console.log()\` which is NOT captured by OpenTelemetry. This means:

- **No logger detected** (no Pino, Winston, Bunyan in dependencies) \u2192 logs in vx will only contain OTel-native log records (from \`logRecordProcessors\`). This is the expected behavior for most Next.js apps.
- **App uses Pino explicitly** (e.g., in Route Handlers or Server Actions) \u2192 configure \`pino-opentelemetry-transport\` as described in [node.md](node.md#template-srcloggerts). The \`logger.ts\` template applies.
- **App uses \`@vercel/otel\` + \`console\` instrumentation** \u2192 Not supported. Console calls don't produce structured log records compatible with OTel.

**Bottom line:** For Next.js apps, traces and metrics are the primary signals. Logs only flow if the app explicitly uses a structured logger like Pino with the OTel transport configured.
`;

// src/skills/vx/references/node.md
var node_default = `# Node.js Template

Two files to configure for Node.js apps: \`tracing.ts\` (OTel SDK \u2014 traces, metrics, log pipeline) and \`logger.ts\` (Pino transport \u2014 sends application logs to OTel).

**Both files are required for full observability.** The SDK alone configures the pipeline but produces no application logs. The logger produces logs but needs the pipeline to export them.

## Template: \`src/tracing.ts\`

\`\`\`typescript
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { BatchLogRecordProcessor } from "@opentelemetry/sdk-logs";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";

const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? "http://localhost:4318";

const sdk = new NodeSDK({
  resource: resourceFromAttributes({
    [ATTR_SERVICE_NAME]: process.env.OTEL_SERVICE_NAME ?? "my-service",
  }),
  traceExporter: new OTLPTraceExporter({
    url: \`\${endpoint}/v1/traces\`,
  }),
  metricReaders: [
    new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter({
        url: \`\${endpoint}/v1/metrics\`,
      }),
      exportIntervalMillis: 15_000,
    }),
  ],
  logRecordProcessors: [
    new BatchLogRecordProcessor(
      new OTLPLogExporter({
        url: \`\${endpoint}/v1/logs\`,
      }),
    ),
  ],
  instrumentations: [
    getNodeAutoInstrumentations({
      "@opentelemetry/instrumentation-fs": { enabled: false },
      "@opentelemetry/instrumentation-dns": { enabled: false },
      "@opentelemetry/instrumentation-net": { enabled: false },
      // Disable auto log sending \u2014 we use pino-opentelemetry-transport instead
      "@opentelemetry/instrumentation-pino": { disableLogSending: true },
    }),
  ],
});

sdk.start();
process.on("SIGTERM", () => sdk.shutdown());
\`\`\`

## Template: \`src/logger.ts\`

Configures Pino to send logs to the OTel collector via \`pino-opentelemetry-transport\`. Uses \`multistream\` for dual output (stdout + OTel).

\`\`\`typescript
import { context, trace } from "@opentelemetry/api";
import pino from "pino";

const otelTransport = pino.transport({
  target: "pino-opentelemetry-transport",
  options: {
    resourceAttributes: {
      "service.name": process.env.OTEL_SERVICE_NAME ?? "my-service",
    },
  },
});

export const logger = pino(
  {
    level: process.env.LOG_LEVEL ?? "info",
    // Inject trace context into every log record for correlation
    mixin() {
      const span = trace.getSpan(context.active());
      if (!span) return {};
      const { traceId, spanId, traceFlags } = span.spanContext();
      return { trace_id: traceId, span_id: spanId, trace_flags: traceFlags };
    },
  },
  pino.multistream([
    { stream: process.stdout },
    { stream: otelTransport },
  ]),
);
\`\`\`

### How it works

1. **\`pino-opentelemetry-transport\`** runs in a Pino worker thread. It reads \`OTEL_EXPORTER_OTLP_ENDPOINT\` from the process environment and sends logs via OTLP HTTP to the collector. It does NOT use the NodeSDK's configuration \u2014 it connects independently.
2. **\`mixin()\`** reads the active span from \`@opentelemetry/api\` context (uses AsyncLocalStorage). Every log record emitted within a traced request gets \`trace_id\` and \`span_id\` fields. This enables log-to-trace correlation in vx.
3. **\`pino.multistream()\`** sends logs to both stdout (for terminal output) and the OTel transport (for vx).

### Why NOT auto-instrumentation for logs

\`@opentelemetry/instrumentation-pino\` (included in auto-instrumentations) works by monkey-patching Pino at import time. This silently fails when:
- The project uses ESM (\`"type": "module"\` in package.json)
- The project uses tsx as the TypeScript runner
- The project uses pnpm (symlink resolution breaks module name matching)

Since most modern TypeScript projects use some combination of these, the transport approach is the only reliable method. See [log-bridges.md](log-bridges.md) for details.

### Required env vars for the transport

The transport worker thread reads these from the process environment:

\`\`\`bash
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318   # Where to send logs
OTEL_SERVICE_NAME=my-service                         # Service identity in log records
\`\`\`

**CRITICAL:** These MUST be set in the app's env file. The transport runs in a separate worker thread and does NOT inherit configuration from the NodeSDK instance.

## Framework variations

| Framework | Service name | Entry file | Tracing import | Logger import |
|-----------|-------------|------------|----------------|---------------|
| Hono (Node) | \`my-hono-api\` | \`src/index.ts\` | \`import "./tracing.js";\` first line | \`import { logger } from "./logger.js";\` |
| NestJS | \`my-nestjs-api\` | \`src/main.ts\` | \`import "./tracing.js";\` first line | \`import { logger } from "./logger.js";\` |
| Express | \`my-express-api\` | \`src/app.ts\` | \`import "./tracing.js";\` first line | \`import { logger } from "./logger.js";\` |
| Fastify | \`my-fastify-api\` | \`src/server.ts\` | \`import "./tracing.js";\` first line | \`import { logger } from "./logger.js";\` |
| Generic | \`my-service\` | Entry file | \`import "./tracing.js";\` first line | \`import { logger } from "./logger.js";\` |

Replace \`my-service\` with the actual service name. The tracing import MUST be the first line in the entry file. The logger import can be anywhere after.

## Extra: Hono on Node

If the framework is Hono running on Node, also install \`@hono/otel\` and wrap the app:

\`\`\`typescript
import { instrument } from "@hono/otel";

const app = new Hono();
// ... routes ...

export default instrument(app);
\`\`\`

This adds middleware-level route tracing on top of the auto-instrumentation (HTTP, DB, etc.).

## Install dependencies

Run inside the app directory using the project's package manager. Before installing, look up the latest stable version of each package on npm. Do NOT use hardcoded versions \u2014 they go stale quickly. Use \`npm view <package> version\` or check the package's npm page.

\`\`\`bash
pnpm add @opentelemetry/api \\
  @opentelemetry/sdk-node \\
  @opentelemetry/auto-instrumentations-node \\
  @opentelemetry/exporter-trace-otlp-http \\
  @opentelemetry/exporter-metrics-otlp-http \\
  @opentelemetry/exporter-logs-otlp-http \\
  @opentelemetry/resources \\
  @opentelemetry/sdk-metrics \\
  @opentelemetry/sdk-logs \\
  @opentelemetry/semantic-conventions

# If app uses Pino (required for logger.ts):
pnpm add pino-opentelemetry-transport

# For Hono on Node, also:
pnpm add @hono/otel
\`\`\`

For npm: replace \`pnpm add\` with \`npm install\`.
For yarn: replace \`pnpm add\` with \`yarn add\`.

## Critical: import order

\`tracing.ts\` must be imported **before** any instrumented library (HTTP, pg, etc.). This ensures the monkey-patching hooks are registered before the libraries load.

\`logger.ts\` can be imported after \`tracing.ts\` \u2014 the transport connects independently, not through auto-instrumentation hooks.

\`\`\`typescript
// src/index.ts
import "./tracing.js";                // FIRST \u2014 registers all instrumentations
import { Hono } from "hono";          // After \u2014 gets instrumented
import { logger } from "./logger.js"; // After \u2014 connects via transport, not monkey-patching
\`\`\`

## If the app already has a Pino logger

Do NOT create a new \`logger.ts\`. Instead, modify the existing logger to add the OTel transport and mixin:

1. Add \`pino-opentelemetry-transport\` as a dependency
2. Add the \`mixin()\` function for trace correlation
3. Change the stream to \`pino.multistream()\` with both stdout and the OTel transport

If the existing logger uses \`pino.transport()\` already (single transport), switch to \`pino.multistream()\` to add the OTel transport alongside.

If the existing logger uses a custom destination (e.g., \`pino.destination('./app.log')\`), add the OTel transport as a second stream via multistream.
`;

// src/skills/vx/references/signals.md
var signals_default = `# The Three Signals

OpenTelemetry defines three observability signals. The vx stack receives and stores all three. A complete setup exports **all of them**.

## What each signal provides

| Signal | What it captures | Example data |
|--------|-----------------|--------------|
| **Traces** | Request flow across services, latency per operation | \`GET /api/projects \u2192 45ms\`, \`db.query \u2192 12ms\` |
| **Metrics** | Numeric measurements over time | \`http.server.request.duration\`, \`nodejs.event_loop.utilization\` |
| **Logs** | Structured application log records | \`{"level":"info","msg":"Run completed","runId":"abc"}\` |

## How each signal is configured in NodeSDK

The \`NodeSDK\` constructor accepts properties for each signal:

\`\`\`typescript
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { BatchLogRecordProcessor } from "@opentelemetry/sdk-logs";

const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? "http://localhost:4318";

new NodeSDK({
  // Signal 1: Traces
  traceExporter: new OTLPTraceExporter({
    url: \`\${endpoint}/v1/traces\`,
  }),

  // Signal 2: Metrics
  metricReaders: [
    new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter({
        url: \`\${endpoint}/v1/metrics\`,
      }),
      exportIntervalMillis: 15_000,
    }),
  ],

  // Signal 3: Logs
  logRecordProcessors: [
    new BatchLogRecordProcessor(
      new OTLPLogExporter({
        url: \`\${endpoint}/v1/logs\`,
      }),
    ),
  ],
});
\`\`\`

**Note:** Use the plural properties (\`metricReaders\`, \`logRecordProcessors\`) \u2014 the singular forms are deprecated.

## How each signal is configured in @vercel/otel

The \`registerOTel()\` function accepts the same metric/log properties (undocumented but functional):

\`\`\`typescript
import { registerOTel } from "@vercel/otel";

registerOTel({
  serviceName: "my-app",
  metricReaders: [/* same as NodeSDK */],
  logRecordProcessors: [/* same as NodeSDK */],
});
\`\`\`

See [nextjs.md](nextjs.md) for the complete Next.js template with dynamic imports.

## What auto-instrumentations produce

When using \`@opentelemetry/auto-instrumentations-node\`:

| Instrumentation | Traces | Metrics | Logs |
|----------------|--------|---------|------|
| \`instrumentation-http\` | HTTP server/client spans | \`http.server.request.duration\`, \`http.client.request.duration\` | \u2014 |
| \`instrumentation-runtime-node\` | \u2014 | Event loop utilization | \u2014 |
| \`instrumentation-pino\` | \u2014 | \u2014 | **CJS only** \u2014 fails with ESM + tsx + pnpm |
| \`instrumentation-winston\` | \u2014 | \u2014 | Forwards winston log records to OTel Logs SDK |
| \`instrumentation-bunyan\` | \u2014 | \u2014 | Forwards bunyan log records to OTel Logs SDK |
| \`instrumentation-pg\` | DB query spans | \u2014 | \u2014 |
| \`instrumentation-undici\` | fetch() spans | \u2014 | \u2014 |
| All others (30+) | Various spans | \u2014 | \u2014 |

**Key insight:** Metrics require the exporter config in the SDK AND auto-instrumentations that produce metrics. Logs require \`logRecordProcessors\` in the SDK AND a log source. For Pino logs, use \`pino-opentelemetry-transport\` (works everywhere) rather than \`instrumentation-pino\` (breaks with ESM + tsx + pnpm). See [node.md](node.md#template-srcloggerts) for the logger template and [log-bridges.md](log-bridges.md) for details.

## Completing an incomplete setup

If existing OTel only has traces, add the missing exporters:

### Adding metrics to existing NodeSDK

\`\`\`typescript
// Add these imports
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";

// Add to NodeSDK config
metricReaders: [
  new PeriodicExportingMetricReader({
    exporter: new OTLPMetricExporter({
      url: \`\${endpoint}/v1/metrics\`,
    }),
    exportIntervalMillis: 15_000,
  }),
],
\`\`\`

### Adding logs to existing NodeSDK

\`\`\`typescript
// Add these imports
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { BatchLogRecordProcessor } from "@opentelemetry/sdk-logs";

// Add to NodeSDK config
logRecordProcessors: [
  new BatchLogRecordProcessor(
    new OTLPLogExporter({
      url: \`\${endpoint}/v1/logs\`,
    }),
  ),
],
\`\`\`

**Note:** Adding \`logRecordProcessors\` to the SDK is only half of the log setup. You also need to configure the application logger (Pino) to send logs through the transport. See [node.md](node.md#template-srcloggerts) for the \`logger.ts\` template.

### Dependencies for all 3 signals

Before installing, look up the latest stable version of each package on npm. Do NOT use hardcoded versions \u2014 they go stale quickly. Use \`npm view <package> version\` or check the package's npm page.

\`\`\`bash
# Core (required for all)
@opentelemetry/api
@opentelemetry/sdk-node
@opentelemetry/resources
@opentelemetry/semantic-conventions

# Traces
@opentelemetry/exporter-trace-otlp-http

# Metrics
@opentelemetry/exporter-metrics-otlp-http
@opentelemetry/sdk-metrics

# Logs
@opentelemetry/exporter-logs-otlp-http
@opentelemetry/sdk-logs

# Auto-instrumentation (Node.js only, NOT Bun)
@opentelemetry/auto-instrumentations-node

# Pino log transport (if app uses Pino)
pino-opentelemetry-transport
\`\`\`
`;

// src/skills/vx/SKILL.md
var SKILL_default = '---\nname: vx\ndescription: Configure and verify OpenTelemetry instrumentation so this project sends traces, metrics, and logs to the vx observability stack. Use when setting up observability or when telemetry is not flowing.\n---\n\n# vx \u2014 OpenTelemetry Setup & Verification\n\nConfigure OpenTelemetry to send **all three signals** (traces, metrics, logs) to the vx stack at `http://localhost:4318`, then verify telemetry flows correctly.\n\n## Phase 1: Analyze the project\n\n1. Detect project type:\n   - `package.json` \u2192 JavaScript/TypeScript\n   - `go.mod` \u2192 Go (see note below)\n   - `pyproject.toml` or `requirements.txt` \u2192 Python (see note below)\n   - If not JS/TS: report "Only JavaScript/TypeScript is supported. Manual setup required." and stop.\n2. Check for monorepo: `workspaces` in `package.json`, `pnpm-workspace.yaml`, or `lerna.json`.\n3. If monorepo: identify app directories (typically `apps/*`, `services/*`, or `packages/` with servers).\n4. For each app (or root if single-package):\n   - **Framework**: detect from dependencies \u2014 `@nestjs/core`, `hono`, `next`, `express`, `fastify`, `@temporalio/worker`\n   - **Runtime**: `bun` in devDependencies or `bunfig.toml` exists \u2192 Bun. Otherwise \u2192 Node.\n   - **Logger**: detect from dependencies \u2014 `pino`, `winston`, `bunyan`\n   - **Existing OTel**: grep for `@opentelemetry`, `OTLPTraceExporter`, `NodeSDK`, `registerOTel`, `@hono/otel` in source files. Check for `tracing.ts`, `instrumentation.ts`, or `telemetry.ts` files.\n   - If found: read the file and note which signals are configured (trace exporter, metric reader, log processor).\n5. Detect env file pattern per app:\n   - `.env.local` exists \u2192 use `.env.local`\n   - `.env.development` exists \u2192 use `.env.development`\n   - `.env` exists \u2192 use `.env`\n   - None exist \u2192 create `.env.local`\n6. Detect packages/libraries in the monorepo that are NOT apps but contain business logic (SDK wrappers, DB layers, etc.).\n\n## Phase 2: Configure per app\n\n### Step 1: Apply OTel SDK template\n\nApply the FIRST matching rule:\n\n| Condition                                           | Action                                                                                  |\n| --------------------------------------------------- | --------------------------------------------------------------------------------------- |\n| OTel exists with all 3 signals exporting to `:4318` | Report: "Fully configured. No changes needed."                                          |\n| OTel exists but missing signals (e.g., only traces) | Complete the setup \u2014 see [references/signals.md](references/signals.md) for what to add |\n| OTel exists but exports to different URL            | Set `OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318` in the detected env file        |\n| No OTel AND Next.js                                 | Apply template from [references/nextjs.md](references/nextjs.md)                        |\n| No OTel AND Bun runtime                             | Apply template from [references/bun.md](references/bun.md)                              |\n| No OTel AND Node runtime                            | Apply template from [references/node.md](references/node.md)                            |\n\n### Step 2: Configure the application logger for log sending\n\nAfter applying the SDK template, if the app uses a logger, the logger MUST be configured to send logs to OTel. The SDK\'s `tracing.ts` alone does NOT produce application logs \u2014 it only configures the log pipeline. The logger itself needs a transport.\n\n| Condition                       | Action                                                                                                             |\n| ------------------------------- | ------------------------------------------------------------------------------------------------------------------ |\n| App uses Pino                   | **Configure `pino-opentelemetry-transport`** \u2014 see the logger template in [references/node.md](references/node.md) |\n| App uses Winston                | Configure Winston OTel transport \u2014 see [references/log-bridges.md](references/log-bridges.md)                      |\n| App uses Bunyan                 | Configure Bunyan OTel transport \u2014 see [references/log-bridges.md](references/log-bridges.md)                       |\n| App has NO logger               | `logRecordProcessors` in the SDK is sufficient \u2014 only OTel-native log records will flow                            |\n| Next.js without explicit logger | Logs from `console.log` are NOT captured. This is expected \u2014 see [references/nextjs.md](references/nextjs.md)      |\n\n**CRITICAL:** Do NOT rely on `@opentelemetry/instrumentation-pino` for log bridging. It fails silently with ESM + tsx + pnpm. Always use the explicit transport approach shown in node.md.\n\n### Step 3: Additional recommendations\n\n| Condition                              | Action                                                                                |\n| -------------------------------------- | ------------------------------------------------------------------------------------- |\n| Monorepo has library packages with I/O | Recommend manual spans \u2014 see [references/manual-spans.md](references/manual-spans.md) |\n\n### After applying changes\n\n1. Set env vars in the detected env file \u2014 see [references/env-vars.md](references/env-vars.md)\n2. **If using Pino:** verify that `OTEL_EXPORTER_OTLP_ENDPOINT` is set in the env file (required by the transport worker thread \u2014 it does NOT inherit from the NodeSDK)\n3. Install all added dependencies (both OTel SDK packages AND `pino-opentelemetry-transport` if applicable)\n4. Run the project\'s type checker (`tsc --noEmit`, `bun run check`, etc.)\n5. Proceed to Phase 3 (Verify).\n\n## Phase 3: Verify\n\n### Step 1 \u2014 Check vx stack\n\n```bash\nnpx vx status\n```\n\n- All services `healthy` \u2192 proceed.\n- Any `unreachable` \u2192 run `npx vx up`, wait, re-check.\n- `vx up` fails \u2192 report error and stop.\n\n### Step 2 \u2014 Ensure app is running\n\n- Detect start command from `package.json` scripts (`dev`, `start`).\n- Check if the app\'s port responds to HTTP.\n- If not running: ask the user to start it in a separate terminal.\n\n### Step 3 \u2014 Query telemetry\n\nWait ~20 seconds after the app starts (metrics flush every 15s, log batches every 5s), then:\n\n```bash\nnpx vx traces \'*\'\nnpx vx metrics \'{__name__=~".+"}\'\nnpx vx logs \'*\'\n```\n\n### Step 4 \u2014 Report\n\nFor each signal, report:\n\n| Signal  | Result                    | Details                          |\n| ------- | ------------------------- | -------------------------------- |\n| Traces  | Found N spans / No data   | Show sample span if found        |\n| Metrics | Found N series / No data  | Show sample metric name if found |\n| Logs    | Found N entries / No data | Show sample log message if found |\n\nEvaluate result:\n\n- **All 3 signals return data** \u2192 SUCCESS\n- **Some signals return data** \u2192 PARTIAL \u2014 explain which are missing and run diagnostics for the missing signal from [references/diagnostics.md](references/diagnostics.md)\n- **No signals return data** \u2192 FAIL \u2014 run full diagnostics from [references/diagnostics.md](references/diagnostics.md)\n\n### Step 5 \u2014 Coverage checklist\n\nPresent a final summary table per app:\n\n```\n| Check                              | Status |\n|------------------------------------|--------|\n| tracing.ts / instrumentation.ts    | \u2713 / \u2717  |\n| Trace exporter configured          | \u2713 / \u2717  |\n| Metric reader configured           | \u2713 / \u2717  |\n| Log processor configured           | \u2713 / \u2717  |\n| Logger transport (Pino/Winston)    | \u2713 / \u2717 / N/A |\n| Trace correlation (mixin)          | \u2713 / \u2717 / N/A |\n| Env vars set                       | \u2713 / \u2717  |\n| Type check passes                  | \u2713 / \u2717  |\n| Traces verified in vx              | \u2713 / \u2717  |\n| Metrics verified in vx             | \u2713 / \u2717  |\n| Logs verified in vx                | \u2713 / \u2717  |\n```\n\n**Coverage score:** Count \u2713 items / total applicable items (exclude N/A). Report as percentage.\n\n## Rules\n\n1. NEVER overwrite an existing tracing/instrumentation file. Analyze it \u2014 don\'t replace it.\n2. NEVER remove existing OTel configuration or dependencies.\n3. If existing OTel already has all 3 signals pointing to `:4318`, do NOTHING.\n4. Prefer environment variables over hardcoded URLs.\n5. Bun runtime NEVER gets `@opentelemetry/auto-instrumentations-node`.\n6. The OTLP endpoint is always `http://localhost:4318` (HTTP, not gRPC).\n7. For monorepos: handle each app independently. Report findings per workspace.\n8. Install dependencies inside each app workspace, not in the monorepo root.\n9. When adding dependencies, respect existing versions \u2014 never downgrade.\n10. After any code change, verify it compiles (run type checker).\n11. Detect and follow the project\'s env file pattern. Never hardcode which env file to use.\n12. All three signals must be configured. Traces-only is incomplete.\n13. Library packages use `@opentelemetry/api` only \u2014 never the SDK.\n14. When an app uses Pino, always configure `pino-opentelemetry-transport`. Do NOT assume auto-instrumentation will handle logs.\n15. The logger template (`logger.ts`) is as critical as `tracing.ts`. Both must be created for apps with Pino.\n\n## References\n\n- [The three signals](references/signals.md) \u2014 What traces, metrics, and logs provide and how to configure each\n- [Node.js template](references/node.md) \u2014 NodeSDK + Pino logger with all 3 signals (Hono, Express, NestJS, Fastify)\n- [Next.js template](references/nextjs.md) \u2014 @vercel/otel with all 3 signals\n- [Bun template](references/bun.md) \u2014 Bun-specific setup and limitations\n- [Log bridges](references/log-bridges.md) \u2014 Pino transport setup (recommended) and auto-instrumentation fallback\n- [Manual spans](references/manual-spans.md) \u2014 When and how library packages add custom spans\n- [Diagnostics](references/diagnostics.md) \u2014 Troubleshooting when telemetry is not flowing\n- [Environment variables](references/env-vars.md) \u2014 Complete OTel env var reference\n';

// src/skills/content.ts
var VX_SKILL = SKILL_default;
var VX_REFERENCES = {
  "bun.md": bun_default,
  "diagnostics.md": diagnostics_default,
  "env-vars.md": env_vars_default,
  "log-bridges.md": log_bridges_default,
  "manual-spans.md": manual_spans_default,
  "nextjs.md": nextjs_default,
  "node.md": node_default,
  "signals.md": signals_default
};
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

- \`/vx\` \u2014 Configure and verify OpenTelemetry instrumentation (traces, metrics, logs)

### Endpoints

| Signal  | Port   | Query Language |
|---------|--------|----------------|
| Metrics | :8428  | MetricsQL      |
| Logs    | :9428  | LogsQL         |
| Traces  | :10428 | LogsQL         |
| OTLP    | :4318  | \u2014              |

### Workflow

1. Run \`vx up\` before starting the app
2. Run \`/vx\` to configure OTel and verify telemetry flows
3. App emits telemetry to \`http://localhost:4318\` via OpenTelemetry
4. Query with \`vx metrics\`, \`vx logs\`, \`vx traces\`
5. Use \`vx check\` as quality gates before completing a task
6. Run \`vx down\` when done`;

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
  const vxDir = join2(cwd, ".claude", "skills", "vx");
  const refsDir = join2(vxDir, "references");
  await mkdir2(refsDir, { recursive: true });
  const skillResult = await writeIfNotExists(join2(vxDir, "SKILL.md"), VX_SKILL, force);
  const refResults = [];
  for (const [filename, content] of Object.entries(VX_REFERENCES)) {
    const result = await writeIfNotExists(join2(refsDir, filename), content, force);
    refResults.push({ path: `.claude/skills/vx/references/${filename}`, action: result });
  }
  const claudeMdPath = join2(cwd, "CLAUDE.md");
  const claudeMdResult = await appendClaudeMd(claudeMdPath, CLAUDE_MD_BLOCK, force);
  const files = [
    { path: ".claude/skills/vx/SKILL.md", action: skillResult },
    ...refResults,
    { path: "CLAUDE.md", action: claudeMdResult }
  ];
  const skills = ["vx"];
  const nextSteps = ["Run /vx to configure OpenTelemetry and verify telemetry flows"];
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
        metrics_endpoint: "http://victoria-metrics:8428/opentelemetry/api/v1/push",
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
  version: "0.0.12",
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
