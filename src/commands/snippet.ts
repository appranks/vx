import type { CommandContext } from "../lib/context.ts";

const SNIPPET = `## vx — Observability for coding agents

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
| OTLP    | :4318 | —          |

### Telemetry

App must export telemetry via OpenTelemetry to \`http://localhost:4318\`.
Run \`vx init\` to generate instrumentation config.`;

export async function runSnippet(ctx: CommandContext): Promise<void> {
	ctx.output.print({ snippet: SNIPPET });
}
