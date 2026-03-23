---
name: cli-core
description: Arg parsing, output routing, exit codes, error handling, signals, versioning
area: cli
depth_level: 3
decisions: 12
created: 2026-03-23
---

## Proposito

Define el contrato completo del entry point `src/cli.ts` y las convenciones que todos los comandos deben respetar. Esto incluye como se parsean argumentos, como se enruta el output, que significan los exit codes, como se manejan los errores, y como responde el CLI ante senales del sistema operativo.

---

## Decisiones

### D-01: Parsing de argumentos — manual con `process.argv`

**Eleccion:** Parsing manual usando `process.argv.slice(2)` sin librerias externas.

**Justificacion:** El contrato principal del proyecto es zero dependencias externas en el CLI. Bun expone `process.argv` identico a Node. El CLI de `vx` tiene un arbol de subcomandos plano (un nivel de profundidad), lo cual hace que el parsing manual sea trivial y directo. Herramientas como `gh` CLI y `docker` CLI implementan su propio parser para tener control total sobre el formato de ayuda y errores. La superficie de comandos de `vx` no justifica la complejidad de yargs o commander.

**Ejemplo:**

```typescript
// src/cli.ts
const args = process.argv.slice(2);
const command = args[0];
const rest = args.slice(1);

// Flags globales extraidos antes del dispatch
const flags = parseGlobalFlags(rest);
```

```typescript
// src/lib/args.ts
export interface GlobalFlags {
  json: boolean;
  quiet: boolean;
  verbose: boolean;
  help: boolean;
  version: boolean;
}

export function parseGlobalFlags(args: string[]): GlobalFlags {
  return {
    json: args.includes('--json'),
    quiet: args.includes('--quiet'),
    verbose: args.includes('--verbose'),
    help: args.includes('--help') || args.includes('-h'),
    version: args.includes('--version') || args.includes('-v'),
  };
}

export function stripFlags(args: string[]): string[] {
  return args.filter((a) => !a.startsWith('--') && !a.startsWith('-'));
}
```

---

### D-02: Estructura de subcomandos — tabla de dispatch plana

**Eleccion:** Tabla de comandos como `Record<string, CommandHandler>` con lookup O(1).

**Justificacion:** Evita encadenamiento de if/else o switch que crece linealmente. La tabla hace que agregar un nuevo comando sea un cambio de una linea. Patron usado por `kubectl` y herramientas Go. La funcion `main` queda de menos de 30 lineas.

**Ejemplo:**

```typescript
// src/cli.ts
import { runUp } from './commands/up.ts';
import { runDown } from './commands/down.ts';
import { runStatus } from './commands/status.ts';
import { runMetrics } from './commands/metrics.ts';
import { runLogs } from './commands/logs.ts';
import { runTraces } from './commands/traces.ts';
import { runCheck } from './commands/check.ts';
import { runInit } from './commands/init.ts';
import { runSnippet } from './commands/snippet.ts';
import type { CommandContext } from './lib/context.ts';

type CommandHandler = (ctx: CommandContext) => Promise<void>;

const COMMANDS: Record<string, CommandHandler> = {
  up: runUp,
  down: runDown,
  status: runStatus,
  metrics: runMetrics,
  logs: runLogs,
  traces: runTraces,
  check: runCheck,
  init: runInit,
  snippet: runSnippet,
};
```

---

### D-03: CommandContext — unico objeto de contexto por invocacion

**Eleccion:** Cada comando recibe un `CommandContext` tipado que contiene flags, args posicionales, y helpers de output. Sin variables globales.

**Justificacion:** El contrato del proyecto dice "sin estado global". El `CommandContext` encapsula todo lo que un comando necesita sin importar de modulos de estado. Esto hace que los comandos sean testeables en aislamiento total: se puede construir un `CommandContext` falso en tests sin montar ninguna infraestructura.

**Ejemplo:**

```typescript
// src/lib/context.ts
export interface CommandContext {
  command: string;
  args: string[];       // args posicionales, sin flags
  flags: GlobalFlags;
  output: OutputHelper; // ver D-04
}

export function buildContext(rawArgs: string[]): CommandContext {
  const command = rawArgs[0] ?? '';
  const rest = rawArgs.slice(1);
  const flags = parseGlobalFlags(rest);
  const args = stripFlags(rest);
  return { command, args, flags, output: buildOutputHelper(flags) };
}
```

---

### D-04: Output routing — TTY detection automatica

**Eleccion:** Si `process.stdout.isTTY === true`, formato humano (tabla/texto). Si no, JSON compacto en una sola linea. El flag `--json` fuerza JSON independientemente del TTY.

**Justificacion:** Patron identico al de `gh` CLI y `docker` CLI. Los agentes de coding redirigen stdout a una variable o pipe, lo que desactiva TTY automaticamente. El agente siempre recibe JSON parseable sin tener que pasar flags. El humano que corre el CLI en su terminal recibe formato legible. No hay ambiguedad.

**Ejemplo:**

```typescript
// src/lib/output.ts
export interface OutputHelper {
  print(data: unknown): void;
  printHuman(text: string): void;
  error(message: string, detail?: unknown): void;
}

export function buildOutputHelper(flags: GlobalFlags): OutputHelper {
  const isJson = flags.json || !process.stdout.isTTY;

  return {
    print(data: unknown): void {
      if (isJson) {
        process.stdout.write(JSON.stringify(data) + '\n');
      } else {
        // cada comando implementa su propio formatter humano
        // este metodo no se llama directamente en modo human
      }
    },
    printHuman(text: string): void {
      if (!flags.quiet) {
        process.stdout.write(text + '\n');
      }
    },
    error(message: string, detail?: unknown): void {
      if (isJson) {
        process.stderr.write(JSON.stringify({ error: message, detail }) + '\n');
      } else {
        process.stderr.write(`error: ${message}\n`);
        if (detail && flags.verbose) {
          process.stderr.write(String(detail) + '\n');
        }
      }
    },
  };
}
```

---

### D-05: Exit codes — semantica fija de tres niveles

**Eleccion:** Exit code 0 = exito, 1 = error del usuario o gate fallido, 2 = error del stack (Docker, red, Victoria).

**Justificacion:** Este contrato esta definido explicitamente en `CLAUDE.md`. Los agentes y CI leen exit codes para decidir si continuar. El codigo 1 cubre tanto errores de argumentos como gates que fallan (`vx check` con threshold excedido) porque en ambos casos la accion correcta del agente es revisar y corregir. El codigo 2 indica un problema de infraestructura que el agente no puede resolver con cambios de codigo.

**Ejemplo:**

```typescript
// src/lib/exit.ts
export const EXIT = {
  OK: 0,
  USER_ERROR: 1,    // arg invalido, gate fallido, query mal formada
  STACK_ERROR: 2,   // Docker no responde, Victoria no alcanzable, timeout
} as const;

export type ExitCode = (typeof EXIT)[keyof typeof EXIT];

export function exitWith(code: ExitCode): never {
  process.exit(code);
}

// Uso en comando:
// if (!isStackRunning) exitWith(EXIT.STACK_ERROR);
// if (gateFailed) exitWith(EXIT.USER_ERROR);
```

---

### D-06: Manejo de errores — never throw desde comandos

**Eleccion:** Los comandos nunca lanzan excepciones hacia `main`. Todos los errores se capturan dentro del handler, se escriben a stderr via `ctx.output.error()`, y se llama `exitWith()` antes de retornar.

**Justificacion:** Un proceso Node/Bun que termina con una excepcion no manejada imprime un stack trace en stderr que contamina el output del agente. El agente no puede parsear un stack trace. Los errores deben ser siempre JSON o texto simple a stderr, con exit code semantico. Patron identico al de `kubectl` y `docker` CLI.

**Ejemplo:**

```typescript
// src/commands/metrics.ts
export async function runMetrics(ctx: CommandContext): Promise<void> {
  const query = ctx.args[0];
  if (!query) {
    ctx.output.error('missing query argument', 'Usage: vx metrics <MetricsQL query>');
    exitWith(EXIT.USER_ERROR);
    return; // TypeScript flow
  }

  let result: MetricsResult;
  try {
    result = await queryMetrics(query);
  } catch (err) {
    ctx.output.error('victoria metrics unreachable', err instanceof Error ? err.message : String(err));
    exitWith(EXIT.STACK_ERROR);
    return;
  }

  ctx.output.print(result);
}
```

---

### D-07: Formato de errores en stderr — objeto JSON estructurado

**Eleccion:** En modo JSON (no TTY o `--json`), los errores a stderr son `{"error":"mensaje","detail":"...","code":N}`. En modo humano, son texto plano prefijado con `error:`.

**Justificacion:** El agente puede estar procesando stderr para diagnosticar fallas. Un formato JSON consistente hace que el agente pueda extraer el mensaje sin regex. El `code` replica el exit code para que el agente tenga el contexto sin consultar `$?`.

**Ejemplo:**

```typescript
// Stderr en modo JSON:
// {"error":"victoria metrics unreachable","detail":"connect ECONNREFUSED 127.0.0.1:8428","code":2}

// Stderr en modo humano:
// error: victoria metrics unreachable
// detail: connect ECONNREFUSED 127.0.0.1:8428 (con --verbose)
```

---

### D-08: Help text — generado estaticamente, no auto-generado

**Eleccion:** El texto de ayuda es una string literal en `src/lib/help.ts`. No se genera desde la tabla de comandos.

**Justificacion:** El help de `vx` es simple y no cambia frecuentemente. El auto-generado requiere metadatos en cada comando (descripcion, flags, ejemplos) que aumentan la complejidad del codigo. El estatico permite formatear exactamente como el autor quiere, incluyendo ejemplos de uso real. La practica de `curl`, `git`, y la mayoria de CLIs maduros es texto estatico.

**Ejemplo:**

```typescript
// src/lib/help.ts
export const HELP_TEXT = `
vx — ephemeral observability for coding agents

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
  vx down
`.trim();
```

---

### D-09: Version — fuente de verdad unica en `package.json`

**Eleccion:** La version se lee en runtime desde `package.json` via `Bun.file('./package.json')` o importada como JSON. No se hardcodea en el codigo.

**Justificacion:** Tener dos lugares donde vive la version (package.json y un constante en el codigo) garantiza que van a desincronizarse. Bun soporta importacion nativa de JSON. Un solo `npm version patch` actualiza todo.

**Ejemplo:**

```typescript
// src/lib/version.ts
import pkg from '../../package.json' with { type: 'json' };

export const VERSION: string = pkg.version;

// En main:
// if (flags.version) {
//   process.stdout.write(`vx ${VERSION}\n`);
//   process.exit(EXIT.OK);
// }
```

---

### D-10: Flags globales — prefijo doble dash, sin abreviaciones excepto -h/-v

**Eleccion:** Todos los flags globales usan `--nombre`. Solo `--help` acepta `-h` y `--version` acepta `-v`. Los flags de comando (especificos a cada subcomando) son responsabilidad de cada handler.

**Justificacion:** Los CLIs que abusan de las abreviaciones single-char (`-q`, `-v`, `-j`) crean conflictos cuando un flag de comando necesita la misma letra. `--json`, `--quiet`, `--verbose` son suficientemente cortos para escribirse completos. `-h` y `-v` son los dos unicos universalmente estandarizados.

---

### D-11: Manejo de senales — SIGINT y SIGTERM limpios

**Eleccion:** Registrar handlers para `SIGINT` (Ctrl+C) y `SIGTERM`. El handler escribe un mensaje breve a stderr y sale con `EXIT.OK` si no hay operacion en curso, o con `EXIT.STACK_ERROR` si se interrumpio una operacion critica.

**Justificacion:** Un CLI que imprime un stack trace en Ctrl+C contamina el output del agente. El exit code correcto para interrupcion es 0 si el usuario interrumpio voluntariamente, no un error. Los comandos de larga duracion (como `vx up` esperando health checks) deben terminar limpiamente.

**Ejemplo:**

```typescript
// src/cli.ts
process.on('SIGINT', () => {
  process.stderr.write('\ninterrupted\n');
  process.exit(EXIT.OK);
});

process.on('SIGTERM', () => {
  process.stderr.write('terminated\n');
  process.exit(EXIT.OK);
});
```

---

### D-12: Estructura de main — flujo lineal sin anidamiento

**Eleccion:** La funcion `main` tiene exactamente esta secuencia: (1) parsear flags globales, (2) manejar --version y --help, (3) resolver comando, (4) validar que existe, (5) ejecutar handler.

**Justificacion:** La funcion main debe ser una lista de pasos, no un arbol de condiciones. El anidamiento profundo en main hace dificil razonar sobre el flujo. Menos de 40 lineas totales.

**Ejemplo:**

```typescript
// src/cli.ts
async function main(): Promise<void> {
  const rawArgs = process.argv.slice(2);
  const flags = parseGlobalFlags(rawArgs);

  if (flags.version) {
    process.stdout.write(`vx ${VERSION}\n`);
    process.exit(EXIT.OK);
  }

  if (flags.help && !rawArgs[0]) {
    process.stdout.write(HELP_TEXT + '\n');
    process.exit(EXIT.OK);
  }

  const commandName = rawArgs[0];
  const handler = COMMANDS[commandName];

  if (!handler) {
    const output = buildOutputHelper(flags);
    output.error(`unknown command: ${commandName ?? '(none)'}`, 'Run vx --help for available commands');
    process.exit(EXIT.USER_ERROR);
  }

  const ctx = buildContext(rawArgs);
  await handler(ctx);
}

main().catch((err) => {
  process.stderr.write(`fatal: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(EXIT.STACK_ERROR);
});
```

---

## Interfaz

```typescript
// Tipos exportados publicos de src/lib/

export interface GlobalFlags {
  json: boolean;
  quiet: boolean;
  verbose: boolean;
  help: boolean;
  version: boolean;
}

export interface CommandContext {
  command: string;
  args: string[];
  flags: GlobalFlags;
  output: OutputHelper;
}

export interface OutputHelper {
  print(data: unknown): void;
  printHuman(text: string): void;
  error(message: string, detail?: unknown): void;
}

export type CommandHandler = (ctx: CommandContext) => Promise<void>;

export const EXIT = {
  OK: 0,
  USER_ERROR: 1,
  STACK_ERROR: 2,
} as const;
```

---

## Reglas

1. Ningun comando importa `process.argv` directamente. Todo llega via `CommandContext`.
2. Ningun comando llama `process.exit()` directamente. Solo via `exitWith()` de `src/lib/exit.ts`.
3. Todo lo que va al agente va a `process.stdout`. Todo lo que es diagnostico va a `process.stderr`.
4. En modo JSON (no-TTY o `--json`), stdout es siempre una sola linea de JSON valido por llamada a `output.print()`.
5. Los handlers nunca lanzan excepciones hacia `main`. Toda excepcion se captura dentro del handler.
6. El texto de ayuda no se imprime a stderr. Solo se imprime a stdout y con exit 0.
7. El flag `--json` es global y no puede ser redefinido por ningun comando.
8. No existen flags sin `--` prefix excepto `-h` y `-v`.
9. La version se lee siempre de `package.json`. Nunca se hardcodea.
10. `SIGINT` y `SIGTERM` siempre terminan con exit 0 a menos que se este en mitad de una operacion critica irreversible.

---

## Ejemplos de uso completo

```bash
# Modo TTY (humano en terminal)
$ vx status
victoria-metrics  healthy  :8428
victoria-logs     healthy  :9428
victoria-traces   healthy  :10428
otel-collector    healthy  :4318

# Modo no-TTY (agente en pipe)
$ result=$(vx status)
$ echo $result
{"services":{"victoria-metrics":{"status":"healthy","port":8428},"victoria-logs":{"status":"healthy","port":9428}}}

# Error de usuario
$ vx metrics
# stderr: {"error":"missing query argument","detail":"Usage: vx metrics <MetricsQL query>","code":1}
# exit: 1

# Stack no corriendo
$ vx metrics 'up'
# stderr: {"error":"victoria metrics unreachable","detail":"connect ECONNREFUSED 127.0.0.1:8428","code":2}
# exit: 2

# Version
$ vx --version
vx 0.0.1

# Help
$ vx --help
vx — ephemeral observability for coding agents
...
```
