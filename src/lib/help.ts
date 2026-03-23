import { c, st } from "./style.ts";

const h = (label: string) => st(c.bold, label);
const cmd = (name: string, desc: string) => `    ${st(c.cyan, name.padEnd(16))}${desc}`;
const flag = (name: string, desc: string) => `    ${st(c.dim, name.padEnd(16))}${desc}`;

export const HELP_TEXT = `  ${st(c.bold + c.cyan, "vx")} ${st(c.dim, "\u2014")} ephemeral observability for coding agents

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
