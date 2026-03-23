import bunRef from "./vx/references/bun.md" with { type: "text" };
import diagnosticsRef from "./vx/references/diagnostics.md" with { type: "text" };
import envVarsRef from "./vx/references/env-vars.md" with { type: "text" };
import logBridgesRef from "./vx/references/log-bridges.md" with { type: "text" };
import manualSpansRef from "./vx/references/manual-spans.md" with { type: "text" };
import nextjsRef from "./vx/references/nextjs.md" with { type: "text" };
import nodeRef from "./vx/references/node.md" with { type: "text" };
import signalsRef from "./vx/references/signals.md" with { type: "text" };
import skillMd from "./vx/SKILL.md" with { type: "text" };

export const VX_SKILL = skillMd;

export const VX_REFERENCES: Record<string, string> = {
	"bun.md": bunRef,
	"diagnostics.md": diagnosticsRef,
	"env-vars.md": envVarsRef,
	"log-bridges.md": logBridgesRef,
	"manual-spans.md": manualSpansRef,
	"nextjs.md": nextjsRef,
	"node.md": nodeRef,
	"signals.md": signalsRef,
};

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

- \`/vx\` — Configure and verify OpenTelemetry instrumentation (traces, metrics, logs)

### Endpoints

| Signal  | Port   | Query Language |
|---------|--------|----------------|
| Metrics | :8428  | MetricsQL      |
| Logs    | :9428  | LogsQL         |
| Traces  | :10428 | LogsQL         |
| OTLP    | :4318  | —              |

### Workflow

1. Run \`vx up\` before starting the app
2. Run \`/vx\` to configure OTel and verify telemetry flows
3. App emits telemetry to \`http://localhost:4318\` via OpenTelemetry
4. Query with \`vx metrics\`, \`vx logs\`, \`vx traces\`
5. Use \`vx check\` as quality gates before completing a task
6. Run \`vx down\` when done`;
