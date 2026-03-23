#!/usr/bin/env bash
set -e

steps=("format" "lint" "check" "test" "build")

for step in "${steps[@]}"; do
  echo "[$step] running..."
  if ! bun run "$step"; then
    echo "[$step] failed" >&2
    echo "" >&2
    echo "validation failed" >&2
    exit 1
  fi
  echo "[$step] passed"
done

echo ""
echo "all gates passed"
