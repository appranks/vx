# vx

CLI de observabilidad efímera para agentes de coding. Le da ojos al agente sobre el sistema que está construyendo durante desarrollo.

## Qué hace

Un agente escribe código, lo ejecuta, pero no tiene forma de saber qué pasó en runtime — latencia, errores, traces, patrones de logs. `vx` cierra esa brecha. Levanta un stack de observabilidad ligero (Victoria Metrics/Logs/Traces), recibe telemetría de la app via OpenTelemetry, y expone queries y gates de calidad a través de un solo CLI.

```
Agent → escribe código → app corre → emite telemetría → vx captura
                                                              ↓
Agent ← lee output ← vx consulta ← Victoria almacena ←───────┘
```

## Stack

- **Runtime:** Bun 1.3.11 (TypeScript nativo, single binary via `bun build --compile`)
- **Linter/Formatter:** Biome 2.4.8
- **Testing:** Vitest 4.1.0 (ejecutar con `bun run test`, nunca `bun test`)
- **Type-checking:** TypeScript 5.9.3 (`tsc --noEmit`)

### Victoria Stack (Docker, efímero)

| Servicio         | Imagen                                         | Puerto   | Señal    | Query Language              |
| ---------------- | ---------------------------------------------- | -------- | -------- | --------------------------- |
| Victoria Metrics | `victoriametrics/victoria-metrics:v1.138.0`    | `:8428`  | Métricas | MetricsQL (superset PromQL) |
| Victoria Logs    | `victoriametrics/victoria-logs:v1.48.0`        | `:9428`  | Logs     | LogsQL                      |
| Victoria Traces  | `victoriametrics/victoria-traces:v0.8.0`       | `:10428` | Traces   | LogsQL + Jaeger API         |
| OTel Collector   | `otel/opentelemetry-collector-contrib:0.148.0` | `:4318`  | Router   | —                           |

## Comandos

```bash
bun run dev           # Ejecuta el CLI en modo desarrollo
bun run build         # Compila a dist/
bun run check         # TypeScript type-check
bun run lint          # Biome check
bun run lint:fix      # Biome check --write
bun run test          # Vitest
```

## Estructura

```
src/
├── cli.ts              # Entry point, arg parser, dispatch
├── commands/           # Un archivo por comando (up, down, metrics, logs, etc.)
├── lib/                # Utilidades compartidas (http, docker, format, constants)
├── stack/              # Generadores de docker-compose.yml y otel-collector.yml
└── presets/            # Generadores de instrumentación OTel por framework
```

Los patrones y convenciones de cada área están en `.claude/rules/`:

- `rules/language.md` — Idioma (inglés en código, español en interacción)
- `rules/cli.md` — Patrones CLI: arg parsing, output, exit codes, error handling
- `rules/docker.md` — Docker compose: generación, health checks, lifecycle
- `rules/testing.md` — Vitest: qué testear, mocking patterns

Los contratos de cada componente están en `.claude/contracts/`.
Cada subdirectorio tiene su propio `CLAUDE.md` con contexto específico.

## Idioma

@.claude/rules/language.md

## Convenciones generales

- **Zero dependencias externas en el CLI.** Solo Bun built-ins: `fetch()`, `Bun.spawn()`, `Bun.file()`, `Bun.write()`. Sin commander, sin yargs, sin chalk.
- **Output determinístico.** Cada comando produce JSON parseble por el agente. Si stdout es TTY, formato humano; si no, JSON.
- **Exit codes semánticos.** 0 = éxito, 1 = error del usuario, 2 = error del stack.
- **Sin estado global.** Cada invocación es independiente. El stack Docker es el único estado.
- **Errores a stderr, datos a stdout.** El agente lee stdout, los humanos leen stderr.

## Referencia

- `ARCHITECTURE.md` — Arquitectura completa del CLI y diagrama del stack
- `.claude/stack-manifest.json` — Versiones exactas de cada tecnología con endpoints y flags
