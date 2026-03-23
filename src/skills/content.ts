import { readFileSync } from "node:fs";
import { join } from "node:path";

function readSkill(name: string): string {
	const path = join(import.meta.dirname, `${name}.md`);
	return readFileSync(path, "utf-8");
}

export const VX_SETUP_SKILL = readSkill("vx-setup");
export const VX_VERIFY_SKILL = readSkill("vx-verify");

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
