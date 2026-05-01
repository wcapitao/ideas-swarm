#!/usr/bin/env bash
# verify-deploy.sh — post-deploy smoke test for a Cloudflare Agent
#
# After `wrangler deploy`, hits the deployed URL and verifies basic
# health. Each step reports clearly. Exits non-zero if any required
# check fails.
#
# Steps:
#   1. /health returns 200
#   2. /.well-known/oauth-authorization-server returns valid metadata (if MCP)
#   3. MCP `initialize` handshake succeeds (if MCP)
#   4. A sample tool call succeeds
#
# Usage:
#   bash verify-deploy.sh https://agent.example.com
#   bash verify-deploy.sh https://agent.example.com --skip-mcp
#   bash verify-deploy.sh https://agent.example.com --tool ping --tool-args '{}'

set -uo pipefail

BASE_URL="${1:-}"
shift || true

if [ -z "$BASE_URL" ]; then
  echo "usage: verify-deploy.sh <base-url> [--skip-mcp] [--tool <name>] [--tool-args <json>]" >&2
  exit 2
fi

SKIP_MCP=false
TOOL_NAME="ping"
TOOL_ARGS='{}'

while [ $# -gt 0 ]; do
  case "$1" in
    --skip-mcp)  SKIP_MCP=true; shift ;;
    --tool)      TOOL_NAME="$2"; shift 2 ;;
    --tool-args) TOOL_ARGS="$2"; shift 2 ;;
    *) echo "unknown flag: $1" >&2; exit 2 ;;
  esac
done

PASS=0
FAIL=0

red()   { printf "\033[31m%s\033[0m" "$1"; }
green() { printf "\033[32m%s\033[0m" "$1"; }
yellow(){ printf "\033[33m%s\033[0m" "$1"; }

ok()   { echo "  $(green PASS) $1"; PASS=$((PASS+1)); }
fail() { echo "  $(red FAIL) $1"; FAIL=$((FAIL+1)); }
skip() { echo "  $(yellow SKIP) $1"; }

echo "verify-deploy: $BASE_URL"
echo

# Allow self-signed for staging if needed.
CURL_FLAGS="-sS --max-time 10"

# ── 1. /health ─────────────────────────────────────────────────────
HEALTH_OUT="$(curl $CURL_FLAGS -w '\n%{http_code}' "$BASE_URL/health" || echo $'\nERR')"
HEALTH_CODE="$(printf '%s' "$HEALTH_OUT" | tail -n1)"
HEALTH_BODY="$(printf '%s' "$HEALTH_OUT" | sed '$d')"
if [ "$HEALTH_CODE" = "200" ]; then
  ok "/health -> 200"
  echo "       body: $(echo "$HEALTH_BODY" | head -c 120)"
else
  fail "/health -> $HEALTH_CODE (expected 200)"
fi

# ── 2. /.well-known/oauth-authorization-server (MCP) ───────────────
if [ "$SKIP_MCP" = "true" ]; then
  skip "MCP discovery (skipped via --skip-mcp)"
else
  WELL_KNOWN_OUT="$(curl $CURL_FLAGS -w '\n%{http_code}' "$BASE_URL/.well-known/oauth-authorization-server" || echo $'\nERR')"
  WELL_KNOWN_CODE="$(printf '%s' "$WELL_KNOWN_OUT" | tail -n1)"
  WELL_KNOWN_BODY="$(printf '%s' "$WELL_KNOWN_OUT" | sed '$d')"
  if [ "$WELL_KNOWN_CODE" = "200" ]; then
    if echo "$WELL_KNOWN_BODY" | node -e 'try { const m = JSON.parse(require("fs").readFileSync(0,"utf8")); if (!m.issuer || !m.authorization_endpoint || !m.token_endpoint) process.exit(1); } catch { process.exit(1); }'; then
      ok "/.well-known/oauth-authorization-server -> valid metadata"
    else
      fail "/.well-known/oauth-authorization-server -> 200 but missing required fields (issuer, authorization_endpoint, token_endpoint)"
    fi
  elif [ "$WELL_KNOWN_CODE" = "404" ]; then
    skip "no MCP OAuth metadata (not an MCP server, or unauthenticated MCP)"
  else
    fail "/.well-known/oauth-authorization-server -> $WELL_KNOWN_CODE"
  fi

  # ── 3. MCP initialize handshake ──────────────────────────────────
  # Standard MCP `initialize` over HTTP transport.
  INIT_REQUEST=$(cat <<'EOF'
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"verify-deploy","version":"1.0"}}}
EOF
)
  INIT_OUT="$(curl $CURL_FLAGS -X POST -w '\n%{http_code}' \
    -H 'content-type: application/json' \
    -H 'accept: application/json,text/event-stream' \
    -d "$INIT_REQUEST" \
    "$BASE_URL/mcp" || echo $'\nERR')"
  INIT_CODE="$(printf '%s' "$INIT_OUT" | tail -n1)"
  INIT_BODY="$(printf '%s' "$INIT_OUT" | sed '$d')"
  if [ "$INIT_CODE" = "200" ] && echo "$INIT_BODY" | grep -q '"protocolVersion"'; then
    ok "MCP initialize -> protocolVersion advertised"
  elif [ "$INIT_CODE" = "404" ]; then
    skip "no /mcp endpoint (not an MCP agent)"
  elif [ "$INIT_CODE" = "401" ] || [ "$INIT_CODE" = "403" ]; then
    skip "MCP initialize requires auth ($INIT_CODE) — provide a token to test the full handshake"
  else
    fail "MCP initialize -> $INIT_CODE"
  fi
fi

# ── 4. sample tool call ────────────────────────────────────────────
TOOL_REQUEST=$(cat <<EOF
{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"$TOOL_NAME","arguments":$TOOL_ARGS}}
EOF
)
TOOL_OUT="$(curl $CURL_FLAGS -X POST -w '\n%{http_code}' \
  -H 'content-type: application/json' \
  -H 'accept: application/json,text/event-stream' \
  -d "$TOOL_REQUEST" \
  "$BASE_URL/mcp" 2>/dev/null || echo $'\nERR')"
TOOL_CODE="$(printf '%s' "$TOOL_OUT" | tail -n1)"
TOOL_BODY="$(printf '%s' "$TOOL_OUT" | sed '$d')"
if [ "$TOOL_CODE" = "200" ] && ! echo "$TOOL_BODY" | grep -q '"isError":true'; then
  ok "tool call '$TOOL_NAME' -> ok"
elif [ "$TOOL_CODE" = "404" ] || [ "$TOOL_CODE" = "401" ] || [ "$TOOL_CODE" = "403" ]; then
  skip "tool call requires auth or MCP not exposed at /mcp"
else
  fail "tool call '$TOOL_NAME' -> $TOOL_CODE / isError"
  echo "       body: $(echo "$TOOL_BODY" | head -c 200)"
fi

echo
echo "Summary: $(green "$PASS pass") / $(red "$FAIL fail")"

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
exit 0
