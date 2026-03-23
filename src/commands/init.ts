import { join } from "node:path";
import { parseFlag } from "../lib/args.ts";
import type { CommandContext } from "../lib/context.ts";
import { EXIT, exitWith } from "../lib/exit.ts";
import { appendClaudeMd } from "../lib/preset-writer.ts";
import { detectPreset, type PresetName } from "../presets/detect.ts";
import { initGeneric } from "../presets/generic.ts";
import { initHono } from "../presets/hono.ts";
import { initNextjs } from "../presets/nextjs.ts";

const PRESETS: Record<PresetName, (ctx: CommandContext) => Promise<InitResult>> = {
	hono: initHono,
	nextjs: initNextjs,
	generic: initGeneric,
};

interface InitResult {
	preset: string;
	files: Array<{ path: string; action: string }>;
	dependencies: { added: string[]; skipped: string[] };
	next_steps: string[];
}

const CLAUDE_MD_BLOCK = `## vx

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
| OTLP    | :4318  | —              |

### Workflow

1. Run \`vx up\` before starting the app
2. App emits telemetry to \`http://localhost:4318\` via OpenTelemetry
3. Query with \`vx metrics\`, \`vx logs\`, \`vx traces\`
4. Use \`vx check\` as quality gates before completing a task
5. Run \`vx down\` when done`;

export async function runInit(ctx: CommandContext): Promise<void> {
	const presetArg = ctx.args[0] as PresetName | undefined;
	const presetName = presetArg ?? (await detectPreset());

	const handler = PRESETS[presetName];
	if (!handler) {
		ctx.output.error(`unknown preset: ${presetName}`, `Available presets: ${Object.keys(PRESETS).join(", ")}`);
		exitWith(EXIT.USER_ERROR);
	}

	const force = ctx.args.includes("--force") || parseFlag(ctx.args, "--force") !== undefined;
	const result = await handler(ctx);

	const claudeMdPath = join(process.cwd(), "CLAUDE.md");
	const claudeMdResult = await appendClaudeMd(claudeMdPath, CLAUDE_MD_BLOCK, force);
	result.files.push({ path: "CLAUDE.md", action: claudeMdResult });

	ctx.output.print(result);
}
