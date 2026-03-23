---
name: docker-stack
description: Docker Compose generation, lifecycle, naming, health checks, cleanup
area: docker
depth_level: 3
decisions: 11
created: 2026-03-23
---

## Proposito

Define como el CLI genera, levanta, y destruye el stack de observabilidad Victoria via Docker Compose. Cubre la generacion dinamica del archivo `docker-compose.yml`, el naming de recursos, health checks, deteccion de conflictos de puertos, idempotencia, y la estrategia de cleanup total al hacer `vx down`.

---

## Decisiones

### D-01: Generacion de docker-compose.yml — codigo TypeScript, no plantilla de texto

**Eleccion:** El archivo `docker-compose.yml` se genera construyendo un objeto JavaScript tipado y serializandolo a YAML con un serializer minimo propio. No se usa string interpolation ni un archivo de plantilla estatico.

**Justificacion:** Las plantillas de texto con interpolacion de variables son propensas a errores de indentacion YAML. Un objeto tipado en TypeScript es validado por el compilador: si un campo es incorrecto, el error aparece en compile-time, no en runtime cuando Docker rechaza el archivo. La superficie del compose es pequena (4 servicios, configuracion fija) y no requiere motor de plantillas. Las versiones exactas de imagen viven en `stack-manifest.json` y se importan directamente en el generador.

**Ejemplo:**

```typescript
// src/stack/compose.ts
import type { ComposeConfig } from '../lib/compose-types.ts';

interface ServiceDef {
  image: string;
  ports: string[];
  command?: string[];
  volumes: string[];
  networks: string[];
  healthcheck: HealthcheckDef;
  restart: 'no';
}

interface HealthcheckDef {
  test: string[];
  interval: string;
  timeout: string;
  retries: number;
  start_period: string;
}

export function buildComposeConfig(projectName: string): ComposeConfig {
  return {
    name: projectName,
    services: {
      'victoria-metrics': buildVictoriaMetrics(),
      'victoria-logs': buildVictoriaLogs(),
      'victoria-traces': buildVictoriaTraces(),
      'otel-collector': buildOtelCollector(),
    },
    volumes: {
      'vm-data': null,
      'vl-data': null,
      'vt-data': null,
    },
    networks: {
      'vx-net': { driver: 'bridge' },
    },
  };
}
```

---

### D-02: Ubicacion de archivos generados — directorio `.vx/` en cwd

**Eleccion:** Todos los archivos que `vx` genera se guardan en `.vx/` relativo al directorio de trabajo actual. El `docker-compose.yml` vive en `.vx/docker-compose.yml`. El config del OTel Collector en `.vx/otel-collector.yaml`.

**Justificacion:** Usar un directorio dedicado evita contaminar el root del proyecto con archivos de infraestructura. El nombre `.vx/` es consistente con la herramienta y facilita el `.gitignore` (una sola entrada: `.vx/`). No se usa `/tmp/` porque `docker compose` necesita un path estable para idempotencia — el mismo path = el mismo proyecto. No se usa un path global `~/.vx/` porque diferentes proyectos podrian tener configuraciones distintas y necesitan isolation.

**Ejemplo:**

```typescript
// src/lib/paths.ts
import { join } from 'path';

export function getVxDir(): string {
  return join(process.cwd(), '.vx');
}

export function getComposePath(): string {
  return join(getVxDir(), 'docker-compose.yml');
}

export function getOtelConfigPath(): string {
  return join(getVxDir(), 'otel-collector.yaml');
}

// Crear directorio si no existe
export async function ensureVxDir(): Promise<void> {
  await Bun.write(join(getVxDir(), '.gitkeep'), '');
}
```

---

### D-03: Project name de Docker Compose — fijo `vx`

**Eleccion:** El proyecto de Docker Compose siempre se llama `vx`. Esto resulta en contenedores llamados `vx-victoria-metrics-1`, `vx-victoria-logs-1`, etc.

**Justificacion:** Docker Compose usa el nombre del directorio por defecto, lo que causa conflictos si el directorio es `api`, `engine`, o cualquier nombre comun. Un nombre fijo garantiza que el stack de `vx` siempre sea identificable y no colisione con otros compose projects del desarrollador. `docker compose -p vx down` siempre destruye exactamente el stack correcto, independientemente del directorio actual.

**Ejemplo:**

```typescript
// src/lib/constants.ts
export const VX_PROJECT_NAME = 'vx';
export const VX_NETWORK = 'vx-net';

// En el compose generado, el campo name: vx garantiza esto.
// Equivalente a docker compose --project-name vx
```

```yaml
# .vx/docker-compose.yml generado
name: vx
services:
  victoria-metrics:
    image: victoriametrics/victoria-metrics:v1.138.0
    ...
networks:
  vx-net:
    driver: bridge
```

---

### D-04: Naming de recursos — prefijo consistente `vx-`

**Eleccion:** Volumenes y redes usan prefijo `vx-`. Los nombres de servicio en el compose son los nombres canonicos sin prefijo (Docker Compose ya prefija con el project name).

**Justificacion:** Los volumenes son recursos globales en Docker — si se llaman `data` o `metrics-data` colisionan con otros proyectos. El prefijo `vx-` los hace identificables. La red `vx-net` es visible en `docker network ls` de forma inequivoca.

**Ejemplo:**

```yaml
# Volumenes en docker-compose.yml
volumes:
  vx-vm-data:     # Victoria Metrics data
  vx-vl-data:     # Victoria Logs data
  vx-vt-data:     # Victoria Traces data

# Red
networks:
  vx-net:
    driver: bridge
```

---

### D-05: Health check pattern — polling con timeout y retries

**Eleccion:** Cada servicio tiene un `healthcheck` declarativo en el compose. El comando `vx up` usa `docker compose up -d` y luego hace polling de los endpoints HTTP de cada servicio hasta que todos respondan, con un timeout global de 60 segundos.

**Justificacion:** Docker Compose puede reportar contenedores como "running" cuando el proceso interno aun esta inicializando. Los health checks declarativos en el compose permiten que `docker compose ps` reporte el estado real. El polling HTTP desde el CLI es necesario adicionalmente porque el CLI necesita retornar solo cuando el stack esta realmente listo para recibir telemetria, no solo cuando Docker dice que esta "healthy".

**Ejemplo:**

```typescript
// src/lib/health.ts
const HEALTH_ENDPOINTS: Array<{ name: string; url: string }> = [
  { name: 'victoria-metrics', url: 'http://localhost:8428/health' },
  { name: 'victoria-logs',    url: 'http://localhost:9428/health' },
  { name: 'victoria-traces',  url: 'http://localhost:10428/health' },
  { name: 'otel-collector',   url: 'http://localhost:4318/' },
];

const TIMEOUT_MS = 60_000;
const POLL_INTERVAL_MS = 1_000;

export async function waitForStack(): Promise<void> {
  const deadline = Date.now() + TIMEOUT_MS;

  while (Date.now() < deadline) {
    const results = await Promise.allSettled(
      HEALTH_ENDPOINTS.map(({ url }) =>
        fetch(url, { signal: AbortSignal.timeout(2_000) })
      )
    );

    const allHealthy = results.every(
      (r) => r.status === 'fulfilled' && r.value.ok
    );

    if (allHealthy) return;

    await Bun.sleep(POLL_INTERVAL_MS);
  }

  throw new Error(`stack not ready after ${TIMEOUT_MS / 1000}s`);
}
```

```yaml
# healthcheck declarativo en cada servicio del compose
healthcheck:
  test: ["CMD", "wget", "--no-verbose", "--tries=1", "--spider", "http://localhost:8428/health"]
  interval: 5s
  timeout: 3s
  retries: 10
  start_period: 10s
```

---

### D-06: Deteccion de conflictos de puertos — antes de `docker compose up`

**Eleccion:** Antes de ejecutar `docker compose up`, el CLI verifica que los puertos 4317, 4318, 8428, 9428, y 10428 esten libres. Si alguno esta ocupado, se reporta cual puerto y cual proceso lo tiene, con exit code 2.

**Justificacion:** Intentar levantar el stack con un puerto ocupado resulta en un error crisptico de Docker que el agente no puede parsear. La deteccion previa permite un mensaje de error claro y accionable. Bun no tiene una API nativa para listar procesos por puerto, pero se puede intentar un `fetch` local y checar si algo responde, o usar `Bun.spawnSync(['lsof', '-ti', ':PORT'])`.

**Ejemplo:**

```typescript
// src/lib/ports.ts
const REQUIRED_PORTS = [4317, 4318, 8428, 9428, 10428];

export async function checkPortsAvailable(): Promise<void> {
  const conflicts: number[] = [];

  for (const port of REQUIRED_PORTS) {
    try {
      const res = await fetch(`http://localhost:${port}`, {
        signal: AbortSignal.timeout(500),
      });
      // Si algo responde, el puerto esta ocupado
      if (res) conflicts.push(port);
    } catch {
      // ECONNREFUSED = puerto libre, es lo esperado
    }
  }

  if (conflicts.length > 0) {
    throw new Error(
      `ports already in use: ${conflicts.join(', ')}. Stop the conflicting services before running vx up`
    );
  }
}
```

---

### D-07: Idempotencia de `vx up` — re-run seguro

**Eleccion:** Si el stack ya esta corriendo cuando se ejecuta `vx up`, el comando verifica el estado, reporta "stack already running", y sale con exit code 0. No intenta levantar de nuevo. No destruye nada.

**Justificacion:** Los agentes pueden llamar `vx up` como precondicion al inicio de cada sesion sin saber si el stack ya esta activo. Un `vx up` idempotente significa que el agente puede incluirlo en su setup sin verificaciones previas. `docker compose up --no-recreate` logra esto a nivel de Docker, pero el CLI debe verificar el estado primero para dar un mensaje claro.

**Ejemplo:**

```typescript
// src/commands/up.ts
export async function runUp(ctx: CommandContext): Promise<void> {
  // Verificar si ya esta corriendo
  const running = await isStackRunning();
  if (running) {
    ctx.output.print({ status: 'already_running', message: 'stack is already running' });
    return; // exit 0
  }

  // Verificar puertos libres
  try {
    await checkPortsAvailable();
  } catch (err) {
    ctx.output.error('port conflict', err instanceof Error ? err.message : String(err));
    exitWith(EXIT.STACK_ERROR);
    return;
  }

  // Generar archivos si no existen
  await ensureVxDir();
  await generateComposeFile();
  await generateOtelConfig();

  // Levantar
  const proc = Bun.spawnSync(
    ['docker', 'compose', '-f', getComposePath(), 'up', '-d'],
    { stderr: 'pipe' }
  );

  if (proc.exitCode !== 0) {
    ctx.output.error('docker compose up failed', new TextDecoder().decode(proc.stderr));
    exitWith(EXIT.STACK_ERROR);
    return;
  }

  await waitForStack();
  ctx.output.print({ status: 'running', message: 'stack is ready' });
}
```

---

### D-08: Idempotencia de `vx down` — cleanup total

**Eleccion:** `vx down` siempre ejecuta `docker compose down --volumes --remove-orphans`. Si el stack no estaba corriendo, el comando igual exitcode 0 sin error.

**Justificacion:** El flag `--volumes` es critico para garantizar que no queden volumenes huerfanos entre sesiones. El diseño es "efimero por diseno" — los datos no deben persistir. `--remove-orphans` limpia contenedores que quedaron de configuraciones anteriores. La idempotencia (funcionar aunque el stack no este corriendo) es importante porque los agentes pueden llamar `vx down` como paso de cleanup sin saber el estado actual.

**Ejemplo:**

```typescript
// src/commands/down.ts
export async function runDown(ctx: CommandContext): Promise<void> {
  const composePath = getComposePath();
  const composeExists = await Bun.file(composePath).exists();

  if (!composeExists) {
    // Nada que bajar
    ctx.output.print({ status: 'not_running', message: 'no stack to stop' });
    return;
  }

  const proc = Bun.spawnSync(
    ['docker', 'compose', '-f', composePath, 'down', '--volumes', '--remove-orphans'],
    { stderr: 'pipe' }
  );

  if (proc.exitCode !== 0) {
    ctx.output.error('docker compose down failed', new TextDecoder().decode(proc.stderr));
    exitWith(EXIT.STACK_ERROR);
    return;
  }

  ctx.output.print({ status: 'stopped', message: 'stack destroyed, all data removed' });
}
```

---

### D-09: Wrapper de Docker — `Bun.spawnSync` para comandos cortos, `Bun.spawn` para streaming

**Eleccion:** Comandos cortos (up, down, ps) usan `Bun.spawnSync` con captura de stderr. Comandos que producen output progresivo (logs en tiempo real) usan `Bun.spawn` con stream de stdout.

**Justificacion:** `Bun.spawnSync` bloquea hasta que el proceso termina y captura todo el output — ideal para operaciones con resultado definido. Para operaciones donde el agente necesita ver progreso (como el polling de health), el streaming es mejor UX. El wrapper centraliza el manejo de errores de Docker.

**Ejemplo:**

```typescript
// src/lib/docker.ts
export interface DockerResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export function dockerRun(args: string[]): DockerResult {
  const proc = Bun.spawnSync(['docker', ...args], {
    stdout: 'pipe',
    stderr: 'pipe',
  });
  return {
    exitCode: proc.exitCode ?? 1,
    stdout: new TextDecoder().decode(proc.stdout),
    stderr: new TextDecoder().decode(proc.stderr),
  };
}

export function composeRun(args: string[], composePath: string): DockerResult {
  return dockerRun(['compose', '-f', composePath, ...args]);
}
```

---

### D-10: `vx status` — consulta directa a endpoints HTTP, no a Docker

**Eleccion:** El comando `vx status` verifica el estado de los servicios haciendo `GET /health` a cada endpoint Victoria, no corriendo `docker compose ps`.

**Justificacion:** El estado que le importa al agente no es "el contenedor esta corriendo" sino "el servicio responde y acepta queries". Un contenedor puede estar "running" en Docker pero el servicio interno puede estar en crash loop. La verificacion HTTP da la respuesta correcta. Ademas, no requiere acceso a Docker socket — funciona incluso si Docker no esta instalado localmente (caso de sandbox remoto).

**Ejemplo:**

```typescript
// src/commands/status.ts
export async function runStatus(ctx: CommandContext): Promise<void> {
  const checks = await Promise.allSettled(
    HEALTH_ENDPOINTS.map(async ({ name, url }) => {
      const res = await fetch(url, { signal: AbortSignal.timeout(3_000) });
      return { name, healthy: res.ok, port: new URL(url).port };
    })
  );

  const services = checks.map((result, i) => {
    const { name } = HEALTH_ENDPOINTS[i];
    if (result.status === 'fulfilled') {
      return { name, status: result.value.healthy ? 'healthy' : 'degraded', port: Number(result.value.port) };
    }
    return { name, status: 'unreachable', port: null, error: String(result.reason) };
  });

  ctx.output.print({ services });
}
```

---

### D-11: Imagenes — versiones exactas hardcodeadas, sin `latest`

**Eleccion:** Las versiones de imagen son exactas y se importan de las constantes del proyecto que replican `stack-manifest.json`. Nunca se usa `:latest`.

**Justificacion:** `:latest` hace el stack no reproducible. Si VictoriaMetrics publica una nueva version con una API diferente, el stack del agente cambia sin que nadie lo controle. Las versiones exactas garantizan que todos los agentes que usen la misma version de `vx` tengan exactamente el mismo comportamiento.

**Ejemplo:**

```typescript
// src/lib/constants.ts
export const IMAGES = {
  victoriaMetrics: 'victoriametrics/victoria-metrics:v1.138.0',
  victoriaLogs:    'victoriametrics/victoria-logs:v1.48.0',
  victoriaTraces:  'victoriametrics/victoria-traces:v0.8.0',
  otelCollector:   'otel/opentelemetry-collector-contrib:0.148.0',
} as const;
```

---

## Interfaz

```typescript
// Funciones publicas de src/lib/docker.ts y src/lib/health.ts

export function dockerRun(args: string[]): DockerResult;
export function composeRun(args: string[], composePath: string): DockerResult;

export async function waitForStack(timeoutMs?: number): Promise<void>;
export async function isStackRunning(): Promise<boolean>;
export async function checkPortsAvailable(): Promise<void>;

// src/stack/compose.ts
export function buildComposeConfig(projectName?: string): ComposeConfig;
export async function generateComposeFile(): Promise<void>;

// src/lib/paths.ts
export function getVxDir(): string;
export function getComposePath(): string;
export function getOtelConfigPath(): string;
export async function ensureVxDir(): Promise<void>;
```

---

## Reglas

1. El project name de Docker Compose es siempre `vx`. Nunca derivado del directorio.
2. Todos los archivos generados van a `.vx/`. Nunca al root del proyecto ni a `/tmp/`.
3. `docker compose down` siempre incluye `--volumes --remove-orphans`. Sin excepcion.
4. Las versiones de imagen son exactas (digest o tag semantico). Nunca `:latest`.
5. `vx up` es idempotente: si el stack ya corre, retorna exit 0 sin error.
6. `vx down` es idempotente: si el stack no corre, retorna exit 0 sin error.
7. El health check de `vx status` es siempre HTTP al endpoint, nunca `docker ps`.
8. La deteccion de conflicto de puertos ocurre antes de ejecutar cualquier comando Docker.
9. El timeout de health check es 60 segundos con polling de 1 segundo.
10. Los volumenes siempre tienen prefijo `vx-` para no colisionar con otros proyectos.
11. Nunca se escribe fuera de `.vx/` — el proyecto del usuario es inmutable excepto por `vx init`.

---

## Ejemplos

```bash
# Primera vez: genera archivos y levanta
$ vx up
# .vx/docker-compose.yml creado
# .vx/otel-collector.yaml creado
# docker compose -f .vx/docker-compose.yml up -d
# [polling health endpoints...]
# {"status":"running","message":"stack is ready"}

# Segunda vez: idempotente
$ vx up
# {"status":"already_running","message":"stack is already running"}

# Status
$ vx status
# {"services":[{"name":"victoria-metrics","status":"healthy","port":8428},{"name":"victoria-logs","status":"healthy","port":9428},...]}

# Cleanup total
$ vx down
# docker compose -f .vx/docker-compose.yml down --volumes --remove-orphans
# {"status":"stopped","message":"stack destroyed, all data removed"}

# Puerto ocupado
$ vx up
# stderr: {"error":"port conflict","detail":"ports already in use: 8428. Stop the conflicting services before running vx up","code":2}
# exit: 2
```
