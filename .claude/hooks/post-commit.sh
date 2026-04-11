#!/bin/bash
# Elvis — Post-Commit Hook
# Detecta git commits, injeta lembrete de code review e salva checkpoint

INPUT="${CLAUDE_TOOL_INPUT:-}"
if echo "$INPUT" | grep -q "git commit"; then
  echo "[Hook] Commit realizado. Considere executar /code-review:code-review para revisar as mudanças antes de continuar."

  # Salva checkpoint com estado atual da tarefa
  PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(pwd)}"
  REPO_ROOT=$(git -C "$PROJECT_DIR" rev-parse --show-toplevel 2>/dev/null)
  if [ -n "$REPO_ROOT" ]; then
    CHECKPOINT="$REPO_ROOT/.claude/current-task.md"
    echo "## Último commit: $(git -C "$REPO_ROOT" log --oneline -1)" > "$CHECKPOINT"
    echo "Branch: $(git -C "$REPO_ROOT" rev-parse --abbrev-ref HEAD)" >> "$CHECKPOINT"
    echo "Data: $(date)" >> "$CHECKPOINT"
    echo "" >> "$CHECKPOINT"
    echo "_Atualize este arquivo com o próximo passo antes de fechar a sessão_" >> "$CHECKPOINT"
  fi
fi
