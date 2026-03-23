---
description: Language conventions — English for code, Spanish for human interaction
paths:
  - "**/*"
---

# Idioma

## Inglés — Todo el código

| Contexto | Idioma |
|----------|--------|
| Identificadores (variables, funciones, clases, tipos) | Inglés |
| Comentarios inline | Inglés |
| Mensajes de error en CLI output | Inglés |
| Nombres de archivos | Inglés |
| Keys de JSON/YAML | Inglés |
| Nombres de tests | Inglés |
| Commits | Inglés |
| JSDoc / TSDoc | Inglés |
| Help text del CLI | Inglés |
| Nombres de comandos y flags | Inglés |

## Español — Interacción con humanos y documentación interna

| Contexto | Idioma |
|----------|--------|
| Respuestas de Claude al usuario | Español |
| CLAUDE.md, rules, contracts, skills | Español (contenido) |
| Frontmatter fields (`name`, `description`, `paths`) | Inglés |
| Memory files | Español |

## Reglas

- NO mezclar idiomas en un mismo contexto.
- Los campos de frontmatter YAML van en inglés.
- El contenido markdown de rules/contracts va en español.
- Los logs y mensajes del CLI van en inglés.
