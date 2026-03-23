---
description: CLI patterns — arg parsing, output routing, exit codes, errors, signals, help, version
paths:
  - "src/cli.ts"
  - "src/commands/**"
  - "src/lib/args.ts"
  - "src/lib/context.ts"
  - "src/lib/output.ts"
  - "src/lib/exit.ts"
  - "src/lib/help.ts"
  - "src/lib/version.ts"
---

# Patrones CLI

Contratos fuente: `.claude/contracts/cli.md`

## Arg parsing

- Parsing manual con `process.argv.slice(2)`. Sin commander, sin yargs, sin ninguna librería.
- Flags globales se extraen con `parseGlobalFlags()` de `src/lib/args.ts` antes del dispatch.
- Los flags globales son: `--json`, `--quiet`, `--verbose`, `--help` (`-h`), `--version` (`-v`).
- Todos los flags usan `--` largo. Solo `-h` y `-v` tienen versión corta.
- Los flags específicos de cada comando los parsea el handler del comando, no el parser global.
- `stripFlags()` retorna solo los args posicionales (sin `--` ni `-` prefixed).

## Dispatch

- Tabla de comandos `Record<string, CommandHandler>` en `src/cli.ts`.
- Lookup O(1). Agregar un comando nuevo = una línea en la tabla + el import.
- Si el comando no existe en la tabla, error a stderr con exit 1.

## CommandContext

- Cada handler recibe un `CommandContext` como único argumento.
- `CommandContext` contiene: `command`, `args` (posicionales), `flags` (GlobalFlags), `output` (OutputHelper).
- Se construye con `buildContext()` de `src/lib/context.ts`.
- Ningún comando importa `process.argv` directamente. Todo llega vía `CommandContext`.

## Output routing

- Si `process.stdout.isTTY === true` y no hay `--json`: formato humano (texto/tabla).
- Si `process.stdout.isTTY === false` o `--json`: JSON compacto en una sola línea.
- `OutputHelper.print(data)` — datos al agente (stdout). En modo JSON, `JSON.stringify(data) + '\n'`.
- `OutputHelper.printHuman(text)` — texto legible para humanos (stdout). Suprimido con `--quiet`.
- `OutputHelper.error(message, detail?)` — errores a stderr. En modo JSON: `{"error":"...","detail":"...","code":N}`. En modo humano: `error: mensaje`.
- Todo lo que va al agente va a stdout. Todo lo diagnóstico va a stderr.
- En modo JSON, stdout es siempre una sola línea de JSON válido por llamada a `output.print()`.

## Exit codes

```typescript
export const EXIT = {
  OK: 0,           // Éxito, gate pasó
  USER_ERROR: 1,   // Arg inválido, gate fallido, query mal formada
  STACK_ERROR: 2,  // Docker no responde, Victoria inalcanzable, timeout
} as const;
```

- Ningún comando llama `process.exit()` directamente. Solo vía `exitWith()` de `src/lib/exit.ts`.
- Un gate que falla es exit 1 (el agente puede corregir).
- Un stack que no responde es exit 2 (el agente debe ejecutar `vx up`).

## Error handling

- Los handlers nunca lanzan excepciones hacia `main`. Todo error se captura dentro del handler.
- Se escribe a stderr vía `ctx.output.error()` y luego se llama `exitWith()`.
- Sin stack traces en la salida. El agente no puede parsear stack traces.
- En `main`, un `.catch()` final captura cualquier error no manejado con `fatal:` prefix y exit 2.

## Help

- Texto de ayuda estático en `src/lib/help.ts` como string literal.
- No auto-generado desde la tabla de comandos.
- Se imprime a stdout con exit 0. Nunca a stderr.
- El flag `--help` sin comando muestra la ayuda general. Con comando, cada handler puede mostrar ayuda específica.

## Version

- Se lee de `package.json` vía `import pkg from '../../package.json' with { type: 'json' }`.
- Nunca se hardcodea en el código.
- `--version` imprime `vx X.Y.Z\n` a stdout y exit 0.

## Signals

- `SIGINT` (Ctrl+C) y `SIGTERM` se manejan con handlers registrados en `src/cli.ts`.
- Escriben un mensaje breve a stderr (`interrupted\n` o `terminated\n`).
- Exit 0 siempre (interrupción voluntaria no es error).
- Sin stack traces.

## Estructura de main

- Flujo lineal: parsear flags → --version → --help → resolver comando → validar → ejecutar handler.
- Menos de 40 líneas totales.
- Sin anidamiento profundo. Lista de pasos, no árbol de condiciones.
