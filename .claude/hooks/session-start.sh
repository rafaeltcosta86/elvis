#!/bin/bash
# Global Session Start Hook
# Gera um briefing automático para qualquer projeto git

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(pwd)}"
REPO_ROOT=$(git -C "$PROJECT_DIR" rev-parse --show-toplevel 2>/dev/null)
if [ -z "$REPO_ROOT" ]; then exit 0; fi

PROJECT_NAME=$(basename "$REPO_ROOT" | tr '[:lower:]' '[:upper:]')

echo "=== $PROJECT_NAME — SESSION BRIEFING ==="
echo ""

BRANCH=$(git -C "$REPO_ROOT" rev-parse --abbrev-ref HEAD 2>/dev/null)
echo "Branch: $BRANCH"
echo ""

echo "Últimos commits:"
git -C "$REPO_ROOT" log --oneline -3 2>/dev/null
echo ""

MODIFIED=$(git -C "$REPO_ROOT" status --short 2>/dev/null)
if [ -n "$MODIFIED" ]; then
  echo "Arquivos modificados:"
  echo "$MODIFIED"
else
  echo "Working tree limpo."
fi
echo ""

ROADMAP="$REPO_ROOT/.claude/product-context/current-roadmap.md"
if [ -f "$ROADMAP" ]; then
  echo "Roadmap (NOW):"
  awk '/^## NOW/,/^## NEXT/' "$ROADMAP" | grep -E '^\|.*🔄|^\|.*✅' | head -5
  echo ""
fi

CHECKPOINT="$REPO_ROOT/.claude/current-task.md"
if [ -f "$CHECKPOINT" ]; then
  echo "Current Task:"
  cat "$CHECKPOINT"
  echo ""
fi

echo "=================================="
