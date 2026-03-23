# vx — Architecture

Ephemeral observability for coding agents. Gives agents eyes over the system they are building during development.

## Purpose

A coding agent writes code, runs it, but has no way to know what happened at runtime — latency, errors, traces, log patterns. `vx` closes that gap. It spins up a lightweight observability stack, receives telemetry from the app under development via OpenTelemetry, and exposes queries and quality gates through a single CLI.

The agent writes code, the app emits telemetry, `vx` makes it queryable. The agent reads, understands, and self-corrects.

```
Agent → writes code → app runs → emits telemetry → vx captures it
                                                         ↓
Agent ← reads output ← vx queries ← Victoria stores ←───┘
```

## Stack

Three Victoria products run as ephemeral Docker containers, fronted by an OpenTelemetry Collector:

```
┌──────────────────────────────────────────────────────────────┐
│                        vx CLI (Bun)                          │
│                                                              │
│   vx up        vx metrics    vx logs    vx traces    vx check│
│   vx down      vx status     vx init    vx snippet          │
└──────┬────────────────┬─────────────────────┬────────────────┘
       │ docker compose │ HTTP queries        │ HTTP + threshold
       │                │                     │
┌──────▼────────────────▼─────────────────────▼────────────────┐
│                   Docker Network (vx-net)                     │
│                                                              │
│  ┌────────────────┐ ┌────────────────┐ ┌────────────────┐   │
│  │ Victoria       │ │ Victoria       │ │ Victoria       │   │
│  │ Metrics        │ │ Logs           │ │ Traces         │   │
│  │ :8428          │ │ :9428          │ │ :10428         │   │
│  │ MetricsQL      │ │ LogsQL         │ │ LogsQL+Jaeger  │   │
│  └───────▲────────┘ └───────▲────────┘ └───────▲────────┘   │
│          │                  │                  │             │
│  ┌───────┴──────────────────┴──────────────────┴──────────┐  │
│  │              OpenTelemetry Collector                    │  │
│  │              :4318 (OTLP HTTP)                         │  │
│  │              routes: metrics → VM, logs → VL,          │  │
│  │                      traces → VT                       │  │
│  └──────────────────────▲─────────────────────────────────┘  │
└─────────────────────────┼────────────────────────────────────┘
                          │ OTLP HTTP
                          │
┌─────────────────────────┴────────────────────────────────────┐
│                   App under development                       │
│                                                              │
│   Any framework (Hono, Next.js, Express, etc.)               │
│   + OpenTelemetry SDK (auto-instrumentation)                 │
│   + OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318        │
└──────────────────────────────────────────────────────────────┘
```

## CLI Modules

```
src/
├── cli.ts                  # Entry point, command parser
│
├── commands/
│   ├── up.ts               # Starts the Victoria stack via docker compose
│   ├── down.ts             # Destroys the stack and all data
│   ├── status.ts           # Health check of all services
│   ├── init.ts             # Generates docker-compose + OTel config per preset
│   ├── metrics.ts          # Queries Victoria Metrics via HTTP (:8428)
│   ├── logs.ts             # Queries Victoria Logs via HTTP (:9428)
│   ├── traces.ts           # Queries Victoria Traces via HTTP (:10428)
│   ├── check.ts            # Evaluates a query against a threshold → exit 0/1
│   └── snippet.ts          # Prints CLAUDE.md block for agent instructions
│
├── stack/
│   ├── compose.ts          # Generates docker-compose.yml dynamically
│   └── otel.ts             # Generates otel-collector config
│
├── presets/
│   ├── hono.ts             # OTel auto-instrumentation for Hono
│   ├── nextjs.ts           # OTel auto-instrumentation for Next.js
│   └── generic.ts          # Generic OpenTelemetry setup
│
└── lib/
    ├── http.ts             # Fetch wrapper for Victoria HTTP APIs
    ├── docker.ts           # Docker compose wrapper
    └── format.ts           # Output formatting (table, json, compact)
```

## Data Flow

1. The app starts instrumented with OpenTelemetry SDK
2. Telemetry (metrics, logs, traces) flows to the OTel Collector at `:4318`
3. The Collector routes each signal to its Victoria backend
4. The agent queries via CLI — each command is an HTTP request to Victoria, formatted for stdout

```
vx metrics 'rate(http_requests_total[5m])'
  → GET http://localhost:8428/api/v1/query?query=...
  → JSON response → formatted output → agent reads

vx logs '{app="engine"} error _time:5m'
  → GET http://localhost:9428/select/logsql/query?query=...
  → JSON Lines response → formatted output → agent reads

vx traces 'resource_attr:service.name:"api"'
  → GET http://localhost:10428/select/logsql/query?query=...
  → JSON response → formatted output → agent reads

vx check latency 'http_request_duration_seconds' --p99 --max=2s
  → query + threshold evaluation → exit 0 (pass) or exit 1 (fail)
```

## Quality Gates

`vx check` commands evaluate a query result against a threshold and return an exit code. This lets agents and CI pipelines use observability as a gate:

```
vx check latency '<metric>' --p99 --max=2s     # p99 latency under 2 seconds
vx check errors '<logsql>' --max=0              # zero errors in time window
vx check health                                 # all services responding
```

Exit 0 = gate passed. Exit 1 = gate failed. The agent reads stderr for diagnostics.

## Lifecycle

The stack is ephemeral. It is created for a development session or sandbox run and destroyed when done. Data does not persist between sessions.

```
vx up       →  stack starts, ready in ~5s
  ... agent works, app emits telemetry, agent queries ...
vx down     →  stack destroyed, volumes removed, zero residue
```

## Technical Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| CLI runtime | Bun | ~6ms startup, native TypeScript, single binary via `bun build --compile` |
| Queries | `fetch()` direct to Victoria HTTP APIs | Zero dependencies, JSON response, deterministic |
| Stack | Docker Compose | Universal, available on any dev machine |
| Instrumentation | OpenTelemetry SDK | Vendor-neutral standard, all three Victoria products accept OTLP |
| Distribution | npm (`@lemn/vx`) | One `pnpm add -D` to adopt |
| Retention | 1 day, hardcoded | Only the current session matters |
| Persistence | None | Ephemeral by design |

## Resource Footprint

| Service | RAM | CPU |
|---------|-----|-----|
| Victoria Metrics | 256 MB | 0.5 |
| Victoria Logs | 256 MB | 0.5 |
| Victoria Traces | 512 MB | 0.5 |
| OTel Collector | 128 MB | 0.25 |
| **Total** | **~1.1 GB** | **~1.75 cores** |
