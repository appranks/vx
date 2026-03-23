export const HELP_TEXT = `vx — ephemeral observability for coding agents

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
  check <gate>    Evaluate a quality gate → exit 0/1
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
