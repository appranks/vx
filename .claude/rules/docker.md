---
description: Docker Compose generation, lifecycle, naming, health checks, ports, cleanup
paths:
  - "src/stack/**"
  - "src/commands/up.ts"
  - "src/commands/down.ts"
  - "src/commands/status.ts"
  - "src/lib/docker.ts"
  - "src/lib/health.ts"
  - "src/lib/ports.ts"
  - "src/lib/paths.ts"
  - "src/lib/constants.ts"
---

# Patrones Docker

Contratos fuente: `.claude/contracts/docker.md`

## Generación de compose

- El `docker-compose.yml` se genera construyendo un objeto TypeScript tipado y serializándolo a YAML.
- NO usar string interpolation ni plantillas de texto. Los errores de YAML deben detectarse en compile-time.
- Las versiones de imagen vienen de las constantes en `src/lib/constants.ts`.
- El generador está en `src/stack/compose.ts`, la función es `buildComposeConfig()`.
- La config del OTel Collector se genera en `src/stack/otel.ts`.

## Ubicación de archivos

- Todos los archivos generados van a `.vx/` relativo a `process.cwd()`.
  - `.vx/docker-compose.yml`
  - `.vx/otel-collector.yaml`
- Nunca al root del proyecto, nunca a `/tmp/`, nunca a `~/.vx/`.
- Las funciones de path están en `src/lib/paths.ts`: `getVxDir()`, `getComposePath()`, `getOtelConfigPath()`.
- `ensureVxDir()` crea el directorio si no existe.

## Naming

- Project name de Docker Compose: siempre `vx` (constante `VX_PROJECT_NAME`). Nunca derivado del directorio.
- Network: `vx-net`.
- Volúmenes: prefijo `vx-` (e.g., `vx-vm-data`, `vx-vl-data`, `vx-vt-data`).
- Los nombres de servicio en compose son sin prefijo (`victoria-metrics`, `victoria-logs`, etc.) — Docker Compose ya prefija con el project name.

## Imágenes

- Versiones exactas siempre. Nunca `:latest`.
- Las constantes de imágenes viven en `src/lib/constants.ts` bajo `IMAGES`.

```typescript
export const IMAGES = {
  victoriaMetrics: 'victoriametrics/victoria-metrics:v1.138.0',
  victoriaLogs:    'victoriametrics/victoria-logs:v1.48.0',
  victoriaTraces:  'victoriametrics/victoria-traces:v0.8.0',
  otelCollector:   'otel/opentelemetry-collector-contrib:0.148.0',
} as const;
```

## Health checks

- Cada servicio tiene `healthcheck` declarativo en el compose (wget a `/health`).
- `vx up` hace polling HTTP adicional a los endpoints reales después de `docker compose up -d`.
- El polling usa `fetch()` con `AbortSignal.timeout(2000)` a cada endpoint.
- Timeout global: 60 segundos. Intervalo de polling: 1 segundo.
- La función de health está en `src/lib/health.ts`: `waitForStack()`, `isStackRunning()`.
- `vx status` verifica via HTTP directo, no via `docker ps`. Importa si el servicio responde, no si el container existe.

## Endpoints de health

```typescript
const HEALTH_ENDPOINTS = [
  { name: 'victoria-metrics', url: 'http://localhost:8428/health' },
  { name: 'victoria-logs',    url: 'http://localhost:9428/health' },
  { name: 'victoria-traces',  url: 'http://localhost:10428/health' },
  { name: 'otel-collector',   url: 'http://localhost:4318/' },
];
```

## Detección de puertos

- Antes de `docker compose up`, verificar que los puertos 4317, 4318, 8428, 9428, 10428 están libres.
- Si alguno está ocupado: error a stderr con el puerto conflictivo, exit 2.
- La verificación está en `src/lib/ports.ts`: `checkPortsAvailable()`.
- Método: intentar `fetch()` con timeout corto (500ms). Si responde, el puerto está ocupado.

## Idempotencia

- **`vx up`:** Si el stack ya corre, reporta `already_running` y exit 0. No re-levanta, no destruye.
- **`vx down`:** Siempre ejecuta `docker compose down --volumes --remove-orphans`. Si no hay stack, exit 0 sin error.
- El flag `--volumes` es obligatorio. El stack es efímero — los datos no persisten entre sesiones.
- `--remove-orphans` limpia containers de configuraciones anteriores.

## Docker wrapper

- Comandos cortos (up, down, ps): `Bun.spawnSync()` con captura de stderr.
- El wrapper está en `src/lib/docker.ts`: `dockerRun()`, `composeRun()`.
- Retorna `DockerResult { exitCode, stdout, stderr }`.
- Si `exitCode !== 0`, el comando reporta error con el stderr de Docker y exit 2.

## Reglas

1. Nunca se escribe fuera de `.vx/` — el proyecto del usuario es inmutable excepto por `vx init`.
2. `docker compose down` siempre incluye `--volumes --remove-orphans`. Sin excepción.
3. El health check es siempre HTTP al endpoint, nunca `docker ps`.
4. La detección de conflicto de puertos ocurre antes de ejecutar cualquier comando Docker.
5. Cada servicio tiene `restart: 'no'` — no queremos restart loops en dev.
