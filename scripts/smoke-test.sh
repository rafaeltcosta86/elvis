#!/usr/bin/env bash
# smoke-test.sh — Post-deploy smoke tests
# Usage: ./scripts/smoke-test.sh [BASE_URL]
# Example: ./scripts/smoke-test.sh https://elvis.example.com

set -euo pipefail

BASE_URL="${1:-https://localhost}"
PASS=0
FAIL=0

check() {
  local label="$1"
  local url="$2"
  local expected_status="${3:-200}"
  local expected_body="${4:-}"

  response=$(curl -sk -o /tmp/smoke_body -w "%{http_code}" "$url")

  if [[ "$response" != "$expected_status" ]]; then
    echo "FAIL [$label] expected HTTP $expected_status, got $response — $url"
    ((FAIL++))
    return
  fi

  if [[ -n "$expected_body" ]]; then
    body=$(cat /tmp/smoke_body)
    if ! echo "$body" | grep -q "$expected_body"; then
      echo "FAIL [$label] body missing '$expected_body' — $url"
      ((FAIL++))
      return
    fi
  fi

  echo "PASS [$label] $url"
  ((PASS++))
}

echo "=== Elvis Smoke Tests — $BASE_URL ==="
echo ""

check "health"          "$BASE_URL/health"          200 '"ok"'
check "status"          "$BASE_URL/status"          200 '"db"'
check "today"           "$BASE_URL/today"           200 '"date"'
check "tasks list"      "$BASE_URL/tasks"           200
check "calendar today"  "$BASE_URL/calendar/today"  200
check "calendar week"   "$BASE_URL/calendar/week"   200
check "user profile"    "$BASE_URL/user/profile"    200

echo ""
echo "=== Results: $PASS passed, $FAIL failed ==="

if [[ "$FAIL" -gt 0 ]]; then
  exit 1
fi
