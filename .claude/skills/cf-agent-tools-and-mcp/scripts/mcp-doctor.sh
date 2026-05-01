#!/usr/bin/env bash
#
# mcp-doctor.sh — sanity-check a deployed Cloudflare McpAgent / createMcpHandler.
#
# Usage:
#   ./mcp-doctor.sh <base-url>                   # checks /mcp then /sse
#   ./mcp-doctor.sh <base-url> --auth "Bearer X" # adds auth header
#   ./mcp-doctor.sh <base-url> --path /custom    # custom mount path
#
# Examples:
#   ./mcp-doctor.sh https://my-mcp.workers.dev
#   ./mcp-doctor.sh https://my-mcp.workers.dev --auth "Bearer $TOKEN"
#
# What it checks:
#   1. URL reachable, TLS valid
#   2. CORS preflight (OPTIONS) succeeds
#   3. MCP `initialize` handshake returns a valid result
#   4. `tools/list` returns at least one tool
#   5. Auth handling — 401 surfaces with WWW-Authenticate
#   6. Falls back to /sse if /mcp 404s
#
# Exit code 0 = healthy. Non-zero = client cannot consume this server.

set -uo pipefail

if [[ $# -lt 1 ]]; then
    echo "Usage: $0 <base-url> [--auth 'Bearer X'] [--path /mcp]" >&2
    exit 64
fi

BASE_URL="$1"; shift
AUTH_HEADER=""
MCP_PATH="/mcp"
SSE_PATH="/sse"

while [[ $# -gt 0 ]]; do
    case "$1" in
        --auth) AUTH_HEADER="$2"; shift 2 ;;
        --path) MCP_PATH="$2"; shift 2 ;;
        *) echo "Unknown arg: $1" >&2; exit 64 ;;
    esac
done

# Strip trailing slash from base URL
BASE_URL="${BASE_URL%/}"

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
NC='\033[0m'

ok()   { echo -e "  ${GREEN}[OK]${NC}   $*"; }
warn() { echo -e "  ${YELLOW}[WARN]${NC} $*"; }
err()  { echo -e "  ${RED}[ERR]${NC}  $*"; }
info() { echo -e "  ${BLUE}[..]${NC}   $*"; }

echo "=== mcp-doctor: $BASE_URL ==="
echo

# --- 1. URL reachable + TLS ---
info "Checking reachability and TLS"
HTTP_CODE=$(curl -sS -o /dev/null -w "%{http_code}" --max-time 10 "$BASE_URL/" || echo "000")
if [[ "$HTTP_CODE" == "000" ]]; then
    err "Cannot reach $BASE_URL (network error or TLS failure)"
    exit 1
fi
ok "Server reachable (HTTP $HTTP_CODE on /)"

# --- 2. CORS preflight ---
info "Checking CORS preflight (OPTIONS) on $MCP_PATH"
CORS_OUT=$(curl -sS -i --max-time 10 -X OPTIONS "$BASE_URL$MCP_PATH" \
    -H "Origin: https://playground.ai.cloudflare.com" \
    -H "Access-Control-Request-Method: POST" \
    -H "Access-Control-Request-Headers: content-type, mcp-session-id" \
    2>&1 || true)

if echo "$CORS_OUT" | head -1 | grep -qiE "HTTP/[0-9.]+ (200|204)"; then
    ALLOWED=$(echo "$CORS_OUT" | grep -i "^access-control-allow-headers:" | tr -d '\r' || true)
    ok "CORS preflight passed"
    if [[ -n "$ALLOWED" ]]; then
        echo "         $ALLOWED"
        if ! echo "$ALLOWED" | grep -qi "mcp-session-id"; then
            warn "CORS allow-headers does not include 'mcp-session-id' — streamable HTTP multi-turn will break"
        fi
    fi
else
    warn "CORS preflight non-2xx (browser MCP clients may fail)"
fi

# --- 3. MCP initialize ---
info "Sending initialize handshake to $MCP_PATH"
INIT_BODY='{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"mcp-doctor","version":"1.0"}}}'

CURL_ARGS=( -sS -i --max-time 30 -X POST "$BASE_URL$MCP_PATH"
    -H "Content-Type: application/json"
    -H "Accept: application/json, text/event-stream"
    -d "$INIT_BODY" )

if [[ -n "$AUTH_HEADER" ]]; then
    CURL_ARGS+=( -H "Authorization: $AUTH_HEADER" )
fi

INIT_RESP=$(curl "${CURL_ARGS[@]}" 2>&1 || true)
INIT_STATUS=$(echo "$INIT_RESP" | head -1 | awk '{print $2}')

if [[ "$INIT_STATUS" == "401" ]]; then
    err "Server returned 401 — auth required"
    WWW=$(echo "$INIT_RESP" | grep -i "^www-authenticate:" | head -1 | tr -d '\r' || true)
    if [[ -n "$WWW" ]]; then
        echo "         $WWW"
        if echo "$WWW" | grep -qi "Bearer"; then
            ok "WWW-Authenticate present (RFC-compliant)"
        fi
    else
        warn "401 with no WWW-Authenticate header — clients can't auto-discover OAuth"
    fi
    if [[ -z "$AUTH_HEADER" ]]; then
        echo "         Re-run with: $0 $BASE_URL --auth \"Bearer <TOKEN>\""
    fi
    exit 2
fi

if [[ "$INIT_STATUS" == "404" ]]; then
    warn "$MCP_PATH returned 404 — falling back to $SSE_PATH"
    MCP_PATH="$SSE_PATH"
    info "Re-trying initialize on $SSE_PATH (legacy SSE)"
    CURL_ARGS=( -sS -i --max-time 30 "$BASE_URL$SSE_PATH" )
    if [[ -n "$AUTH_HEADER" ]]; then CURL_ARGS+=( -H "Authorization: $AUTH_HEADER" ); fi
    SSE_HEAD=$(curl "${CURL_ARGS[@]}" 2>&1 | head -5 || true)
    if echo "$SSE_HEAD" | grep -qi "text/event-stream"; then
        ok "SSE endpoint responds (legacy /sse mount detected)"
        echo "         Note: SSE is deprecated. Mount $MCP_PATH for streamable HTTP."
        exit 0
    else
        err "Neither $MCP_PATH nor $SSE_PATH responded as MCP"
        exit 3
    fi
fi

if ! echo "$INIT_STATUS" | grep -qE "^(200|202)$"; then
    err "initialize returned HTTP $INIT_STATUS"
    echo "$INIT_RESP" | tail -20
    exit 4
fi
ok "initialize HTTP $INIT_STATUS"

# Capture session ID if streamable HTTP returned one
SESSION_ID=$(echo "$INIT_RESP" | grep -i "^mcp-session-id:" | head -1 | awk '{print $2}' | tr -d '\r' || true)
if [[ -n "$SESSION_ID" ]]; then
    ok "Session ID returned: $SESSION_ID (transport: streamable-http)"
else
    warn "No mcp-session-id header — server may be running stateless or older transport"
fi

# Extract JSON body (strip CRLF + headers)
INIT_JSON=$(echo "$INIT_RESP" | awk 'BEGIN{b=0} /^\r?$/{b=1; next} b{print}' )

# For SSE responses, the JSON arrives as "data: {...}"
if echo "$INIT_JSON" | head -1 | grep -q "^data:"; then
    INIT_JSON=$(echo "$INIT_JSON" | grep "^data:" | head -1 | sed 's/^data: //')
fi

if echo "$INIT_JSON" | python3 -c "
import sys, json
d = json.loads(sys.stdin.read())
assert d.get('id') == 1 and 'result' in d, 'invalid init response'
result = d['result']
print(f'         protocolVersion: {result.get(\"protocolVersion\", \"?\")}' )
print(f'         serverInfo: {result.get(\"serverInfo\", {})}' )
caps = result.get('capabilities', {})
print(f'         capabilities: {list(caps.keys())}')
" 2>/dev/null; then
    ok "initialize response valid"
else
    err "initialize response invalid JSON-RPC:"
    echo "$INIT_JSON" | head -3
    exit 5
fi

# --- 4. tools/list ---
info "Calling tools/list"
LIST_BODY='{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}'

CURL_ARGS=( -sS --max-time 30 -X POST "$BASE_URL$MCP_PATH"
    -H "Content-Type: application/json"
    -H "Accept: application/json, text/event-stream"
    -d "$LIST_BODY" )
if [[ -n "$AUTH_HEADER" ]]; then CURL_ARGS+=( -H "Authorization: $AUTH_HEADER" ); fi
if [[ -n "$SESSION_ID" ]]; then CURL_ARGS+=( -H "mcp-session-id: $SESSION_ID" ); fi

LIST_RESP=$(curl "${CURL_ARGS[@]}" 2>&1 || true)

# Strip SSE framing if present
if echo "$LIST_RESP" | head -1 | grep -q "^data:"; then
    LIST_RESP=$(echo "$LIST_RESP" | grep "^data:" | head -1 | sed 's/^data: //')
fi

if echo "$LIST_RESP" | python3 -c "
import sys, json
d = json.loads(sys.stdin.read())
assert d.get('id') == 2 and 'result' in d, 'invalid tools/list response'
tools = d['result'].get('tools', [])
print(f'         tools_count={len(tools)}')
if not tools:
    raise SystemExit('no tools registered')
for t in tools[:5]:
    name = t.get('name', '?')
    desc = (t.get('description') or '').replace('\n', ' ')[:80]
    print(f'         - {name}: {desc}')
if len(tools) > 5:
    print(f'         ... and {len(tools) - 5} more')
" 2>/dev/null; then
    ok "tools/list valid"
else
    err "tools/list response invalid or empty:"
    echo "$LIST_RESP" | head -5
    exit 6
fi

# --- 5. Stderr / health summary ---
echo
ok "Server is healthy. Connect MCP clients to:"
echo "         $BASE_URL$MCP_PATH"
exit 0
