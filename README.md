# vx

Ephemeral observability for coding agents. Spins up a lightweight Victoria Metrics/Logs/Traces stack via Docker, receives telemetry via OpenTelemetry, and exposes queries through a single CLI.

## Install

**1. Add the GitHub Packages registry** to your project's `.npmrc`:

```
@appranks:registry=https://npm.pkg.github.com
```

**2. Install:**

```bash
pnpm add -Dw @appranks/vx
```

**3. Integrate:**

```bash
npx vx init      # generates instrumentation.ts, .env.otel, CLAUDE.md block
pnpm install     # install OTel dependencies
```

## Quick start

```bash
# Start the observability stack
npx vx up

# Start the observability stack
npx vx up

# Query what's happening
npx vx metrics 'rate(http_requests_total[5m])'
npx vx logs '{app="api"} error _time:5m'
npx vx traces 'resource_attr:service.name:"api"'

# Quality gates
npx vx check health
npx vx check latency 'http_request_duration_seconds' --p99 --max=2s
npx vx check errors '{app="api"} error' --max=0

# Done — destroy everything
npx vx down
```

`vx init` auto-detects your framework, generates OTel instrumentation, and writes a `## vx` block to your project's `CLAUDE.md` so the coding agent knows `vx` is available.

## Commands

| Command              | Description                                                 |
| -------------------- | ----------------------------------------------------------- |
| `vx up`              | Start the Victoria observability stack                      |
| `vx down`            | Destroy the stack and all data                              |
| `vx status`          | Health check of all services                                |
| `vx init [preset]`   | Generate OTel instrumentation + CLAUDE.md block             |
| `vx metrics <query>` | Query Victoria Metrics (MetricsQL)                          |
| `vx logs <query>`    | Query Victoria Logs (LogsQL)                                |
| `vx traces <query>`  | Query Victoria Traces                                       |
| `vx check <gate>`    | Evaluate a quality gate (exit 0 = pass, exit 1 = fail)      |
| `vx snippet`         | Print CLAUDE.md block for reference                         |

## Flags

| Flag              | Description                                 |
| ----------------- | ------------------------------------------- |
| `--json`          | Force JSON output (default when piped)      |
| `--quiet`         | Suppress informational output               |
| `--verbose`       | Show additional diagnostic detail           |
| `--limit N`       | Limit number of results (per query command) |
| `--help`, `-h`    | Show help                                   |
| `--version`, `-v` | Show version                                |

## Ports

| Port  | Service                                |
| ----- | -------------------------------------- |
| 4318  | OTel Collector (HTTP — apps send here) |
| 4317  | OTel Collector (gRPC)                  |
| 8428  | Victoria Metrics                       |
| 9428  | Victoria Logs                          |
| 10428 | Victoria Traces                        |

## What `vx init` generates

| File | Purpose |
|------|---------|
| `.claude/skills/vx-setup/SKILL.md` | Skill for the agent to configure OTel |
| `.claude/skills/vx-verify/SKILL.md` | Skill for the agent to verify telemetry |
| `CLAUDE.md` (block) | `## vx` section with commands and workflow |

`vx init` does NOT generate instrumentation code or inject dependencies. Instead, it installs skills that the agent (`/vx-setup`) executes intelligently — detecting frameworks, existing OTel config, monorepo structure, and making minimal non-invasive changes.

Use `--force` to overwrite existing skill files. Run again safely — `vx init` is idempotent.

## Supported frameworks

The `/vx-setup` skill handles:

| Framework | Runtime | Template |
|-----------|---------|----------|
| NestJS, Express, Fastify | Node | `node-auto` (auto-instrumentations) |
| Hono | Node | `node-auto` + `@hono/otel` (dual layer) |
| Hono | Bun | `hono-bun` (manual, no auto-instrumentations) |
| Next.js | Node | `nextjs` (`@vercel/otel`) |

If OTel already exists and points to `:4318` → zero changes needed.

## Development

```bash
bun run dev           # Run CLI in development mode
bun run build         # Compile to dist/
bun run check         # TypeScript type-check
bun run lint          # Biome check
bun run test          # Vitest
bun run validate      # All gates (format, lint, check, test, build)
```

## Publishing

Publishing is fully automated. Every push to `main` triggers a GitHub Action that:

1. Runs `validate` (format, lint, check, test, build)
2. Bumps the patch version
3. Publishes to GitHub Packages
4. Commits the version bump back

To publish manually:

```bash
bun run publish:gpr
```

## License

MIT
