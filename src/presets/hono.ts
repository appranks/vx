import { join } from "node:path";
import { parseFlag } from "../lib/args.ts";
import type { CommandContext } from "../lib/context.ts";
import { injectDependencies } from "../lib/package-json.ts";
import { writeIfNotExists } from "../lib/preset-writer.ts";

const HONO_DEPS: Record<string, string> = {
	"@hono/otel": "1.1.1",
	"@opentelemetry/api": "1.9.0",
	"@opentelemetry/sdk-node": "0.213.0",
	"@opentelemetry/exporter-trace-otlp-http": "0.213.0",
	"@opentelemetry/exporter-metrics-otlp-http": "0.213.0",
	"@opentelemetry/exporter-logs-otlp-http": "0.213.0",
	"@opentelemetry/sdk-metrics": "2.0.0",
	"@opentelemetry/sdk-logs": "0.213.0",
	"@opentelemetry/resources": "2.0.0",
	"@opentelemetry/semantic-conventions": "1.35.0",
};

const INSTRUMENTATION = `import { NodeSDK } from "@opentelemetry/sdk-node";
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

const ENV_OTEL = `# OpenTelemetry configuration for vx observability stack
# Copy these values to your .env or .env.local file

OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
OTEL_SERVICE_NAME=my-service
# Optional: enable detailed OTel SDK logs
# OTEL_LOG_LEVEL=debug
`;

export async function initHono(ctx: CommandContext) {
	const force = ctx.args.includes("--force") || parseFlag(ctx.args, "--force") !== undefined;
	const cwd = process.cwd();

	const instrumentationResult = await writeIfNotExists(join(cwd, "instrumentation.ts"), INSTRUMENTATION, force);
	const envResult = await writeIfNotExists(join(cwd, ".env.otel"), ENV_OTEL, force);
	const depResult = await injectDependencies(HONO_DEPS);

	return {
		preset: "hono",
		files: [
			{ path: "instrumentation.ts", action: instrumentationResult },
			{ path: ".env.otel", action: envResult },
		],
		dependencies: depResult,
		next_steps: [
			"pnpm install",
			"Add OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318 to your .env",
			"Import instrumentation.ts as the first import in your entry file",
			"Wrap your Hono app with instrument() from @hono/otel",
		],
	};
}
