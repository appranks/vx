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
  { name: "otel-collector", url: "http://localhost:4318/" }
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
async function checkHealth(ctx) {
  const healthy = await isStackRunning();
  if (healthy) {
    ctx.output.print({ gate: "health", status: "passed", message: "all services healthy" });
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
      ctx.output.print({ gate: "latency", status: "passed", message: "no data", value: null, max: maxStr });
      return;
    }
    const value = Number.parseFloat(result.result[0].value[1]);
    if (value <= maxSeconds) {
      ctx.output.print({ gate: "latency", status: "passed", value, max: maxSeconds, query: wrappedQuery });
    } else {
      ctx.output.print({ gate: "latency", status: "failed", value, max: maxSeconds, query: wrappedQuery });
      exitWith(EXIT.USER_ERROR);
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
    if (count <= maxCount) {
      ctx.output.print({ gate: "errors", status: "passed", count, max: maxCount, query });
    } else {
      ctx.output.print({ gate: "errors", status: "failed", count, max: maxCount, query });
      exitWith(EXIT.USER_ERROR);
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
    ctx.output.print({ status: "not_running", message: "no stack to stop" });
    return;
  }
  const result = composeRun(["down", "--volumes", "--remove-orphans"], composePath);
  if (result.exitCode !== 0) {
    ctx.output.error("docker compose down failed", result.stderr);
    exitWith(EXIT.STACK_ERROR);
  }
  ctx.output.print({ status: "stopped", message: "stack destroyed, all data removed" });
}

// src/commands/init.ts
import { join as join7 } from "path";

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

// src/presets/detect.ts
import { join as join2 } from "path";
async function detectPreset() {
  const pkgPath = join2(process.cwd(), "package.json");
  const file = Bun.file(pkgPath);
  if (!await file.exists()) {
    return "generic";
  }
  const pkg = await file.json();
  if (pkg.workspaces) {
    return "generic";
  }
  const allDeps = {
    ...pkg.dependencies,
    ...pkg.devDependencies
  };
  if ("hono" in allDeps)
    return "hono";
  if ("next" in allDeps)
    return "nextjs";
  return "generic";
}

// src/presets/generic.ts
import { join as join4 } from "path";

// src/lib/package-json.ts
import { join as join3 } from "path";
async function injectDependencies(deps, dev = false) {
  const pkgPath = join3(process.cwd(), "package.json");
  const file = Bun.file(pkgPath);
  const exists = await file.exists();
  const pkg = exists ? await file.json() : { name: "my-app", version: "1.0.0" };
  const field = dev ? "devDependencies" : "dependencies";
  const existing = pkg[field] ?? {};
  const added = [];
  const skipped = [];
  for (const [name, version] of Object.entries(deps)) {
    if (existing[name]) {
      skipped.push(`${name}@${existing[name]} (keeping existing)`);
    } else {
      existing[name] = version;
      added.push(`${name}@${version}`);
    }
  }
  pkg[field] = existing;
  await Bun.write(pkgPath, `${JSON.stringify(pkg, null, 2)}
`);
  return { added, skipped };
}

// src/presets/generic.ts
var GENERIC_DEPS = {
  "@opentelemetry/api": "1.9.0",
  "@opentelemetry/sdk-node": "0.213.0",
  "@opentelemetry/exporter-trace-otlp-http": "0.213.0",
  "@opentelemetry/exporter-metrics-otlp-http": "0.213.0",
  "@opentelemetry/exporter-logs-otlp-http": "0.213.0",
  "@opentelemetry/sdk-metrics": "2.0.0",
  "@opentelemetry/sdk-logs": "0.213.0",
  "@opentelemetry/resources": "2.0.0",
  "@opentelemetry/semantic-conventions": "1.35.0"
};
var INSTRUMENTATION = `import { NodeSDK } from "@opentelemetry/sdk-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { SimpleLogRecordProcessor } from "@opentelemetry/sdk-logs";
import { Resource } from "@opentelemetry/resources";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";

const sdk = new NodeSDK({
  resource: new Resource({
    [ATTR_SERVICE_NAME]: process.env.SERVICE_NAME ?? "my-service",
  }),
  traceExporter: new OTLPTraceExporter({
    url: "http://localhost:4318/v1/traces",
  }),
  metricReader: new PeriodicExportingMetricReader({
    exporter: new OTLPMetricExporter({
      url: "http://localhost:4318/v1/metrics",
    }),
    exportIntervalMillis: 5_000,
  }),
  logRecordProcessors: [
    new SimpleLogRecordProcessor(
      new OTLPLogExporter({ url: "http://localhost:4318/v1/logs" })
    ),
  ],
  // No auto-instrumentations included \u2014 add spans manually for your framework
});

sdk.start();

process.on("beforeExit", () => sdk.shutdown());
`;
var ENV_OTEL = `# OpenTelemetry configuration for vx observability stack
# Copy these values to your .env or .env.local file

OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
OTEL_SERVICE_NAME=my-service
# Optional: enable detailed OTel SDK logs
# OTEL_LOG_LEVEL=debug
`;
async function initGeneric(ctx) {
  const force = ctx.args.includes("--force") || parseFlag(ctx.args, "--force") !== undefined;
  const cwd = process.cwd();
  const instrumentationResult = await writeIfNotExists(join4(cwd, "instrumentation.ts"), INSTRUMENTATION, force);
  const envResult = await writeIfNotExists(join4(cwd, ".env.otel"), ENV_OTEL, force);
  const depResult = await injectDependencies(GENERIC_DEPS);
  return {
    preset: "generic",
    files: [
      { path: "instrumentation.ts", action: instrumentationResult },
      { path: ".env.otel", action: envResult }
    ],
    dependencies: depResult,
    next_steps: [
      "pnpm install",
      "Add OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318 to your .env",
      "Import instrumentation.ts as the first import in your entry file",
      "Add manual spans for your framework routes and operations"
    ]
  };
}

// src/presets/hono.ts
import { join as join5 } from "path";
var HONO_DEPS = {
  "@hono/otel": "1.1.1",
  "@opentelemetry/api": "1.9.0",
  "@opentelemetry/sdk-node": "0.213.0",
  "@opentelemetry/exporter-trace-otlp-http": "0.213.0",
  "@opentelemetry/exporter-metrics-otlp-http": "0.213.0",
  "@opentelemetry/exporter-logs-otlp-http": "0.213.0",
  "@opentelemetry/sdk-metrics": "2.0.0",
  "@opentelemetry/sdk-logs": "0.213.0",
  "@opentelemetry/resources": "2.0.0",
  "@opentelemetry/semantic-conventions": "1.35.0"
};
var INSTRUMENTATION2 = `import { NodeSDK } from "@opentelemetry/sdk-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { SimpleLogRecordProcessor } from "@opentelemetry/sdk-logs";
import { Resource } from "@opentelemetry/resources";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";

const sdk = new NodeSDK({
  resource: new Resource({
    [ATTR_SERVICE_NAME]: process.env.SERVICE_NAME ?? "my-service",
  }),
  traceExporter: new OTLPTraceExporter({
    url: "http://localhost:4318/v1/traces",
  }),
  metricReader: new PeriodicExportingMetricReader({
    exporter: new OTLPMetricExporter({
      url: "http://localhost:4318/v1/metrics",
    }),
    exportIntervalMillis: 5_000,
  }),
  logRecordProcessors: [
    new SimpleLogRecordProcessor(
      new OTLPLogExporter({ url: "http://localhost:4318/v1/logs" })
    ),
  ],
  // No auto-instrumentations: Bun lacks diagnostics_channel support
});

sdk.start();

process.on("beforeExit", () => sdk.shutdown());
`;
var ENV_OTEL2 = `# OpenTelemetry configuration for vx observability stack
# Copy these values to your .env or .env.local file

OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
OTEL_SERVICE_NAME=my-service
# Optional: enable detailed OTel SDK logs
# OTEL_LOG_LEVEL=debug
`;
async function initHono(ctx) {
  const force = ctx.args.includes("--force") || parseFlag(ctx.args, "--force") !== undefined;
  const cwd = process.cwd();
  const instrumentationResult = await writeIfNotExists(join5(cwd, "instrumentation.ts"), INSTRUMENTATION2, force);
  const envResult = await writeIfNotExists(join5(cwd, ".env.otel"), ENV_OTEL2, force);
  const depResult = await injectDependencies(HONO_DEPS);
  return {
    preset: "hono",
    files: [
      { path: "instrumentation.ts", action: instrumentationResult },
      { path: ".env.otel", action: envResult }
    ],
    dependencies: depResult,
    next_steps: [
      "pnpm install",
      "Add OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318 to your .env",
      "Import instrumentation.ts as the first import in your entry file",
      "Wrap your Hono app with instrument() from @hono/otel"
    ]
  };
}

// src/presets/nextjs.ts
import { join as join6 } from "path";
var NEXTJS_DEPS = {
  "@vercel/otel": "2.1.1",
  "@opentelemetry/api": "1.9.0"
};
var INSTRUMENTATION3 = `import { registerOTel } from "@vercel/otel";

export function register() {
  registerOTel({
    serviceName: process.env.SERVICE_NAME ?? "my-nextjs-app",
  });
}
`;
var ENV_OTEL3 = `# OpenTelemetry configuration for vx observability stack
# Copy these values to your .env.local file

OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
OTEL_SERVICE_NAME=my-nextjs-app
# Optional: enable detailed OTel SDK logs
# OTEL_LOG_LEVEL=debug
`;
async function initNextjs(ctx) {
  const force = ctx.args.includes("--force") || parseFlag(ctx.args, "--force") !== undefined;
  const cwd = process.cwd();
  const instrumentationResult = await writeIfNotExists(join6(cwd, "instrumentation.ts"), INSTRUMENTATION3, force);
  const envResult = await writeIfNotExists(join6(cwd, ".env.otel"), ENV_OTEL3, force);
  const depResult = await injectDependencies(NEXTJS_DEPS);
  return {
    preset: "nextjs",
    files: [
      { path: "instrumentation.ts", action: instrumentationResult },
      { path: ".env.otel", action: envResult }
    ],
    dependencies: depResult,
    next_steps: [
      "pnpm install",
      "Add OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318 to your .env.local",
      "Next.js will automatically call register() from instrumentation.ts"
    ]
  };
}

// src/commands/init.ts
var PRESETS = {
  hono: initHono,
  nextjs: initNextjs,
  generic: initGeneric
};
var CLAUDE_MD_BLOCK = `## vx

This project uses \`vx\` for ephemeral runtime observability during development.

### Setup

\`\`\`bash
vx up       # Start the observability stack (Docker)
vx down     # Destroy the stack and all data
vx status   # Health check all services
\`\`\`

### Querying

\`\`\`bash
vx metrics '<MetricsQL>'   # Query metrics (PromQL superset)
vx logs '<LogsQL>'         # Query logs
vx traces '<query>'        # Query traces
\`\`\`

### Quality gates

\`\`\`bash
vx check health                                 # All services respond
vx check latency '<metric>' --p99 --max=2s       # p99 latency under threshold
vx check errors '<logsql>' --max=0               # Zero errors in window
\`\`\`

### Endpoints

| Signal  | Port   | Query Language |
|---------|--------|----------------|
| Metrics | :8428  | MetricsQL      |
| Logs    | :9428  | LogsQL         |
| Traces  | :10428 | LogsQL         |
| OTLP    | :4318  | \u2014              |

### Workflow

1. Run \`vx up\` before starting the app
2. App emits telemetry to \`http://localhost:4318\` via OpenTelemetry
3. Query with \`vx metrics\`, \`vx logs\`, \`vx traces\`
4. Use \`vx check\` as quality gates before completing a task
5. Run \`vx down\` when done`;
async function runInit(ctx) {
  const presetArg = ctx.args[0];
  const presetName = presetArg ?? await detectPreset();
  const handler = PRESETS[presetName];
  if (!handler) {
    ctx.output.error(`unknown preset: ${presetName}`, `Available presets: ${Object.keys(PRESETS).join(", ")}`);
    exitWith(EXIT.USER_ERROR);
  }
  const force = ctx.args.includes("--force") || parseFlag(ctx.args, "--force") !== undefined;
  const result = await handler(ctx);
  const claudeMdPath = join7(process.cwd(), "CLAUDE.md");
  const claudeMdResult = await appendClaudeMd(claudeMdPath, CLAUDE_MD_BLOCK, force);
  result.files.push({ path: "CLAUDE.md", action: claudeMdResult });
  ctx.output.print(result);
}

// src/lib/format.ts
function formatQueryResult(query, results) {
  return { query, count: results.length, results };
}

// src/commands/logs.ts
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
    ctx.output.print(formatQueryResult(query, entries));
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
    ctx.output.print(formatQueryResult(query, limited.result));
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

// src/commands/snippet.ts
var SNIPPET = `## vx \u2014 Observability for coding agents

This project uses \`vx\` for ephemeral runtime observability. The stack runs as Docker containers.

### Quick reference

\`\`\`bash
vx up                    # Start observability stack
vx down                  # Destroy stack and all data
vx status                # Health check all services
vx metrics '<MetricsQL>' # Query metrics (PromQL superset)
vx logs '<LogsQL>'       # Query logs
vx traces '<query>'      # Query traces
vx check health          # Verify all services respond
vx check latency '<metric>' --p99 --max=2s  # Latency gate
vx check errors '<logsql>' --max=0          # Error gate
\`\`\`

### Endpoints

| Signal  | Port  | Language   |
|---------|-------|------------|
| Metrics | :8428 | MetricsQL  |
| Logs    | :9428 | LogsQL     |
| Traces  | :10428| LogsQL     |
| OTLP    | :4318 | \u2014          |

### Telemetry

App must export telemetry via OpenTelemetry to \`http://localhost:4318\`.
Run \`vx init\` to generate instrumentation config.`;
async function runSnippet(ctx) {
  ctx.output.print({ snippet: SNIPPET });
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
  ctx.output.print({ services });
}

// src/commands/traces.ts
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
    ctx.output.print(formatQueryResult(query, entries));
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
    ports: ["4317:4317", "4318:4318"],
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
    ctx.output.print({ status: "already_running", message: "stack is already running" });
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
  ctx.output.print({ status: "running", message: "stack is ready" });
}

// src/lib/output.ts
function buildOutputHelper(flags) {
  const isJson = flags.json || !process.stdout.isTTY;
  return {
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
        process.stderr.write(`error: ${message}
`);
        if (detail && flags.verbose) {
          process.stderr.write(`${String(detail)}
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
var HELP_TEXT = `vx \u2014 ephemeral observability for coding agents

USAGE
  vx <command> [flags] [args]

COMMANDS
  up              Start the Victoria observability stack
  down            Destroy the stack and all data
  status          Health check of all services
  init [preset]   Generate docker-compose and OTel config
  metrics <query> Query Victoria Metrics (MetricsQL)
  logs <query>    Query Victoria Logs (LogsQL)
  traces <query>  Query Victoria Traces
  check <gate>    Evaluate a quality gate \u2192 exit 0/1
  snippet         Print CLAUDE.md block for agent setup

GLOBAL FLAGS
  --json          Force JSON output (default when not TTY)
  --quiet         Suppress informational output
  --verbose       Show additional diagnostic detail
  --help, -h      Show help
  --version, -v   Show version

EXAMPLES
  vx up
  vx metrics 'rate(http_requests_total[5m])'
  vx logs '{app="api"} error _time:5m'
  vx check latency 'http_request_duration_seconds' --p99 --max=2s
  vx down`;
// package.json
var package_default = {
  name: "@appranks/vx",
  version: "0.0.5",
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
    validate: "bun run scripts/validate.ts",
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
  init: runInit,
  snippet: runSnippet
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
    process.stdout.write(`vx ${VERSION}
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
  process.stderr.write(`fatal: ${err instanceof Error ? err.message : String(err)}
`);
  process.exit(EXIT.STACK_ERROR);
});
