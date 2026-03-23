# vx — Architecture

Ephemeral observability for coding agents. Gives agents eyes over the system they are building during development.

## How it works

```
Agent -> writes code -> app runs -> emits telemetry -> vx captures it
                                                            |
Agent <- reads output <- vx queries <- Victoria stores <----+
```

The app emits telemetry via OpenTelemetry. An OTel Collector routes each signal to its Victoria backend. The agent queries via CLI — each command is an HTTP request to Victoria, formatted for stdout.

## Stack

```
+--------------------------------------------------------------+
|                        vx CLI (Bun)                          |
|                                                              |
|   vx up    vx metrics    vx logs    vx traces    vx check    |
|   vx down  vx status     vx init   vx snippet                |
+------+----------------+-----------------------+--------------+
       | docker compose  | HTTP queries          | threshold
       |                 |                       |
+------v-----------------v-----------------------v--------------+
|                   Docker Network (vx-net)                      |
|                                                                |
|  +-----------------+ +-----------------+ +-----------------+   |
|  | Victoria        | | Victoria        | | Victoria        |   |
|  | Metrics         | | Logs            | | Traces          |   |
|  | :8428           | | :9428           | | :10428          |   |
|  | MetricsQL       | | LogsQL          | | LogsQL+Jaeger   |   |
|  +--------^--------+ +--------^--------+ +--------^--------+   |
|           |                   |                   |             |
|  +--------+-------------------+-------------------+----------+  |
|  |              OpenTelemetry Collector                       |  |
|  |              :4318 (OTLP HTTP) / :4317 (gRPC)             |  |
|  +---------------------------^-------------------------------+  |
+------------------------------|----------------------------------+
                               | OTLP
                               |
+------------------------------+----------------------------------+
|                   App under development                          |
|   Any framework + OpenTelemetry SDK                              |
|   OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318              |
+------------------------------------------------------------------+
```

## Module structure

```
src/
├── cli.ts              # Entry point, arg parser, dispatch
├── commands/           # One file per command (up, down, metrics, logs, etc.)
├── lib/                # Shared utilities (http, docker, format, constants)
├── stack/              # docker-compose.yml and otel-collector.yaml generators
└── presets/            # OTel instrumentation generators per framework
```

## Data flow

1. App starts instrumented with OpenTelemetry SDK
2. Telemetry (metrics, logs, traces) flows to the OTel Collector at `:4318`
3. Collector routes each signal to its Victoria backend
4. Agent queries via CLI — HTTP request to Victoria, formatted output to stdout

## Key decisions

| Decision        | Choice                          | Rationale                                         |
| --------------- | ------------------------------- | ------------------------------------------------- |
| CLI runtime     | Bun                             | ~6ms startup, native TypeScript, single binary    |
| Queries         | `fetch()` to Victoria HTTP APIs | Zero deps, JSON response, deterministic           |
| Stack           | Docker Compose                  | Universal, available on any dev machine           |
| Instrumentation | OpenTelemetry SDK               | Vendor-neutral, all Victoria products accept OTLP |
| Distribution    | npm (`@appranks/vx`)            | One `pnpm add -D` to adopt                        |
| Retention       | 1 day, hardcoded                | Only the current session matters                  |
| Persistence     | None                            | Ephemeral by design                               |

## Resource footprint

| Service          | RAM         | CPU             |
| ---------------- | ----------- | --------------- |
| Victoria Metrics | 256 MB      | 0.5             |
| Victoria Logs    | 256 MB      | 0.5             |
| Victoria Traces  | 512 MB      | 0.5             |
| OTel Collector   | 128 MB      | 0.25            |
| **Total**        | **~1.1 GB** | **~1.75 cores** |

## Exit codes

| Code | Meaning                                             |
| ---- | --------------------------------------------------- |
| 0    | Success / gate passed                               |
| 1    | User error / gate failed                            |
| 2    | Stack error (Docker, network, Victoria unreachable) |

## Output contract

- stdout = data for the agent (JSON when piped, human-readable in TTY)
- stderr = diagnostics and errors
- `--json` forces JSON output regardless of TTY
- All query commands return `{ query, count, results }` structure

## Integration

`vx init` installs two Claude Code skills and appends a `## vx` block to the project's `CLAUDE.md`:

1. `/vx-setup` — The agent analyzes the project, detects frameworks and existing OTel config, and makes minimal changes
2. `/vx-verify` — The agent verifies telemetry flows from the app to the vx stack

This is a **Claude-first approach**: the CLI doesn't generate code deterministically. Instead, the agent reads the skill instructions and acts intelligently — handling monorepos, existing configurations, different frameworks, and env patterns.

```
pnpm add -Dw @appranks/vx   # install
npx vx init                  # copy skills + CLAUDE.md
/vx-setup                    # agent configures OTel
/vx-verify                   # agent verifies connection
```

After this, the agent's workflow becomes:

```
vx up → app runs → vx metrics/logs/traces → vx check → vx down
```
