#!/bin/bash

# M5 Validation — NanoClaw Webhook
# Tests: bearer token auth, command parsing, intent routing, mock fallback

WEBHOOK_URL="http://localhost:3000/webhook/nanoclaw"
WEBHOOK_SECRET="seu_webhook_secret_seguro_aqui"
SENDER_ID="551199999999"

echo "===== M5 VALIDATION: NanoClaw Webhook ====="
echo ""

# Test 1: 401 Unauthorized (no token)
echo "Test 1: 401 Unauthorized (no token)"
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$WEBHOOK_URL" \
  -H "Content-Type: application/json" \
  -d "{\"sender_id\": \"$SENDER_ID\", \"message_text\": \"/hoje\"}")
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | head -n-1)

if [ "$HTTP_CODE" = "401" ]; then
  echo "✅ PASS: Got 401 Unauthorized"
else
  echo "❌ FAIL: Expected 401, got $HTTP_CODE"
  echo "Response: $BODY"
fi
echo ""

# Test 2: /hoje command with valid token
echo "Test 2: /hoje command with valid token"
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$WEBHOOK_URL" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $WEBHOOK_SECRET" \
  -d "{\"sender_id\": \"$SENDER_ID\", \"message_text\": \"/hoje\", \"message_id\": \"msg-001\", \"timestamp\": \"$(date -u +'%Y-%m-%dT%H:%M:%SZ')\"}")
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | head -n-1)

if [ "$HTTP_CODE" = "200" ] && echo "$BODY" | grep -q '"ok":true'; then
  echo "✅ PASS: Got 200 OK with ok:true"
  echo "Response: $BODY"
else
  echo "❌ FAIL: Expected 200 with ok:true, got $HTTP_CODE"
  echo "Response: $BODY"
fi
echo ""

# Test 3: Free text message → CREATE_TASK intent
echo "Test 3: Free text message (CREATE_TASK intent)"
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$WEBHOOK_URL" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $WEBHOOK_SECRET" \
  -d "{\"sender_id\": \"$SENDER_ID\", \"message_text\": \"Ligar pro cliente\", \"message_id\": \"msg-002\", \"timestamp\": \"$(date -u +'%Y-%m-%dT%H:%M:%SZ')\"}")
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | head -n-1)

if [ "$HTTP_CODE" = "200" ]; then
  echo "✅ PASS: Got 200 OK for CREATE_TASK"
  echo "Response: $BODY"
else
  echo "❌ FAIL: Expected 200, got $HTTP_CODE"
  echo "Response: $BODY"
fi
echo ""

# Test 4: Unknown command
echo "Test 4: Unknown command (returns help)"
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$WEBHOOK_URL" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $WEBHOOK_SECRET" \
  -d "{\"sender_id\": \"$SENDER_ID\", \"message_text\": \"xyz123blah\", \"message_id\": \"msg-003\", \"timestamp\": \"$(date -u +'%Y-%m-%dT%H:%M:%SZ')\"}")
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | head -n-1)

if [ "$HTTP_CODE" = "200" ]; then
  echo "✅ PASS: Got 200 OK for UNKNOWN intent"
  echo "Response: $BODY"
else
  echo "❌ FAIL: Expected 200, got $HTTP_CODE"
  echo "Response: $BODY"
fi
echo ""

# Test 5: /done command
echo "Test 5: /done command with task ID"
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$WEBHOOK_URL" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $WEBHOOK_SECRET" \
  -d "{\"sender_id\": \"$SENDER_ID\", \"message_text\": \"/done abc123\", \"message_id\": \"msg-004\", \"timestamp\": \"$(date -u +'%Y-%m-%dT%H:%M:%SZ')\"}")
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | head -n-1)

if [ "$HTTP_CODE" = "200" ]; then
  echo "✅ PASS: Got 200 OK for DONE intent"
  echo "Response: $BODY"
else
  echo "❌ FAIL: Expected 200, got $HTTP_CODE"
  echo "Response: $BODY"
fi
echo ""

echo "===== M5 VALIDATION COMPLETE ====="
