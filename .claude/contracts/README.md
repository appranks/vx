---
name: contracts-index
description: Index of all stack contracts for vx
project: "@appranks/vx"
generated: 2026-03-23
---

# Stack Contracts — vx

Contratos tecnicos vinculantes para el CLI `vx`. Cada contrato define decisiones de diseno, interfaces publicas, reglas invariantes, y ejemplos concretos de uso.

**Nivel:** L3 (todas las decisiones significativas cubiertas)
**Metodo:** Seleccion automatica basada en best practices de la industria (gh CLI, docker CLI, kubectl, herramientas Go)

## Indice

| Archivo | Area | Decisiones | Descripcion |
|---------|------|------------|-------------|
| [cli.md](./cli.md) | CLI Core | 12 | Arg parsing, output routing, exit codes, error handling, signals, versioning |
| [docker.md](./docker.md) | Docker/Stack | 11 | Compose generation, lifecycle, naming, health checks, cleanup |
| [http.md](./http.md) | HTTP/Query | 10 | Fetch wrapper, timeout/retry, response parsing, output formatting |
| [testing.md](./testing.md) | Testing | 10 | Vitest config, mocking patterns, coverage, fixture management |
| [presets.md](./presets.md) | Presets/OTel | 11 | OTel instrumentation generation, Bun constraints, idempotence |

**Total: 54 decisiones capturadas**

## Principios transversales

Estos principios aplican a TODOS los contratos:

- **Zero dependencias externas** en el CLI (solo Bun built-ins)
- **Output determinístico** — JSON parseable en modo no-TTY, humano en TTY
- **Exit codes semanticos** — 0 OK, 1 USER_ERROR, 2 STACK_ERROR
- **Errores a stderr, datos a stdout** siempre
- **Sin estado global** — cada invocacion es independiente
- **Idempotencia** — up/down/init son seguros de re-ejecutar

## Restriccion de escritura

Los contratos viven en `.claude/contracts/`. La distribucion al harness la realiza el harness-generator. No editar `.claude/rules/` directamente desde aqui.
