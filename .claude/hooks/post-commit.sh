#!/bin/bash
# Versus — Post-Commit Hook
# Detecta git commits e injeta lembrete de code review

# Verifica se o input do tool use contém "git commit"
INPUT="${CLAUDE_TOOL_INPUT:-}"
if echo "$INPUT" | grep -q "git commit"; then
  echo "[Hook] Commit realizado. Considere executar /code-review:code-review para revisar as mudanças antes de continuar."
fi
