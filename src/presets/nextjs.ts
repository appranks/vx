import { join } from "node:path";
import { parseFlag } from "../lib/args.ts";
import type { CommandContext } from "../lib/context.ts";
import { injectDependencies } from "../lib/package-json.ts";
import { writeIfNotExists } from "../lib/preset-writer.ts";

const NEXTJS_DEPS: Record<string, string> = {
	"@vercel/otel": "2.1.1",
	"@opentelemetry/api": "1.9.0",
};

const INSTRUMENTATION = `import { registerOTel } from "@vercel/otel";

export function register() {
  registerOTel({
    serviceName: process.env.SERVICE_NAME ?? "my-nextjs-app",
  });
}
`;

const ENV_OTEL = `# OpenTelemetry configuration for vx observability stack
# Copy these values to your .env.local file

OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
OTEL_SERVICE_NAME=my-nextjs-app
# Optional: enable detailed OTel SDK logs
# OTEL_LOG_LEVEL=debug
`;

export async function initNextjs(ctx: CommandContext) {
	const force = ctx.args.includes("--force") || parseFlag(ctx.args, "--force") !== undefined;
	const cwd = process.cwd();

	const instrumentationResult = await writeIfNotExists(join(cwd, "instrumentation.ts"), INSTRUMENTATION, force);
	const envResult = await writeIfNotExists(join(cwd, ".env.otel"), ENV_OTEL, force);
	const depResult = await injectDependencies(NEXTJS_DEPS);

	return {
		preset: "nextjs",
		files: [
			{ path: "instrumentation.ts", action: instrumentationResult },
			{ path: ".env.otel", action: envResult },
		],
		dependencies: depResult,
		next_steps: [
			"pnpm install",
			"Add OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318 to your .env.local",
			"Next.js will automatically call register() from instrumentation.ts",
		],
	};
}
