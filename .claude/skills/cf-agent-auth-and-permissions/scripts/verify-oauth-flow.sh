#!/usr/bin/env bash
# verify-oauth-flow.sh — curl-driven smoke test of an OAuth-protected MCP server.
#
# Walks the OAuth 2.1 + Dynamic Client Registration flow end-to-end, then calls
# a protected MCP method. Reports each step's status and exits non-zero on
# failure.
#
# USAGE:
#   verify-oauth-flow.sh <base-url>
#   verify-oauth-flow.sh https://my-mcp.example.com
#   verify-oauth-flow.sh http://localhost:8787
#
# OPTIONAL ENV:
#   VERIFY_OAUTH_VERBOSE=1   — print full request/response bodies
#   VERIFY_OAUTH_NO_BROWSER=1 — skip the interactive `/authorize` redirect step
#                              (use when running in CI; just verifies that the
#                              endpoints exist and the metadata is right)
#   VERIFY_OAUTH_REDIRECT_URI — override the redirect URI (default
#                               http://localhost:9999/cb, must match what the
#                               provider allows for testing)
#
# EXIT CODES:
#   0  — all checks passed
#   1  — at least one check failed
#   2  — bad input / cannot reach server

set -uo pipefail

BASE_URL="${1:-}"
if [ -z "$BASE_URL" ]; then
  echo "usage: $0 <base-url>" >&2
  echo "  e.g. $0 https://my-mcp.example.com" >&2
  exit 2
fi

# Strip trailing slash
BASE_URL="${BASE_URL%/}"

VERBOSE="${VERIFY_OAUTH_VERBOSE:-0}"
NO_BROWSER="${VERIFY_OAUTH_NO_BROWSER:-0}"
REDIRECT_URI="${VERIFY_OAUTH_REDIRECT_URI:-http://localhost:9999/cb}"

PASS=0
FAIL=0

step() {
  local name="$1"
  printf '%-60s' "[step] $name ... "
}

ok() {
  echo "OK"
  PASS=$((PASS + 1))
}

fail() {
  local reason="$1"
  echo "FAIL ($reason)"
  FAIL=$((FAIL + 1))
}

verbose_print() {
  if [ "$VERBOSE" = "1" ]; then
    echo "  $*"
  fi
}

# Tools we need
for tool in curl jq; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "missing required tool: $tool" >&2
    exit 2
  fi
done

# ------------------------------------------------------------
# Step 1: OAuth Authorization Server discovery (RFC 8414)
# ------------------------------------------------------------
step "GET /.well-known/oauth-authorization-server (RFC 8414)"
DISCOVERY_URL="$BASE_URL/.well-known/oauth-authorization-server"
DISC_BODY=$(curl -sS -L --fail-with-body --max-time 10 "$DISCOVERY_URL" 2>&1) || {
  fail "could not fetch $DISCOVERY_URL"
  echo "$DISC_BODY" | head -3
  echo
  echo "  Verify the Worker is up and OAuthProvider is the entrypoint."
  exit 1
}
verbose_print "body: $DISC_BODY"

if ! echo "$DISC_BODY" | jq -e '.authorization_endpoint and .token_endpoint' >/dev/null; then
  fail "missing authorization_endpoint or token_endpoint in metadata"
  echo "$DISC_BODY"
else
  ok
  AUTH_ENDPOINT=$(echo "$DISC_BODY" | jq -r '.authorization_endpoint')
  TOKEN_ENDPOINT=$(echo "$DISC_BODY" | jq -r '.token_endpoint')
  REGISTER_ENDPOINT=$(echo "$DISC_BODY" | jq -r '.registration_endpoint // empty')
  SCOPES_SUPPORTED=$(echo "$DISC_BODY" | jq -r '.scopes_supported // [] | join(" ")')
  verbose_print "authorization_endpoint = $AUTH_ENDPOINT"
  verbose_print "token_endpoint         = $TOKEN_ENDPOINT"
  verbose_print "registration_endpoint  = $REGISTER_ENDPOINT"
  verbose_print "scopes_supported       = $SCOPES_SUPPORTED"
fi

# ------------------------------------------------------------
# Step 2: Protected Resource metadata (RFC 9728)
# ------------------------------------------------------------
step "GET /.well-known/oauth-protected-resource (RFC 9728)"
PR_URL="$BASE_URL/.well-known/oauth-protected-resource"
PR_BODY=$(curl -sS -L --fail-with-body --max-time 10 "$PR_URL" 2>&1) || {
  # Some providers serve only RFC 8414, not 9728. Treat as soft-fail.
  echo "SKIP (no RFC 9728 endpoint — that's OK for some setups)"
}
if [ -n "${PR_BODY:-}" ] && echo "$PR_BODY" | jq -e '.authorization_servers' >/dev/null 2>&1; then
  ok
  verbose_print "authorization_servers = $(echo "$PR_BODY" | jq -c '.authorization_servers')"
fi

# ------------------------------------------------------------
# Step 3: Dynamic Client Registration (RFC 7591)
# ------------------------------------------------------------
if [ -z "${REGISTER_ENDPOINT:-}" ]; then
  step "POST <registration_endpoint>"
  echo "SKIP (no registration_endpoint advertised — DCR disabled)"
else
  step "POST $REGISTER_ENDPOINT (Dynamic Client Registration)"
  REG_PAYLOAD=$(jq -n \
    --arg ru "$REDIRECT_URI" \
    '{
      client_name: "verify-oauth-flow.sh",
      redirect_uris: [$ru],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none"
    }')
  REG_BODY=$(curl -sS -L --fail-with-body --max-time 10 \
    -H "Content-Type: application/json" \
    -X POST -d "$REG_PAYLOAD" \
    "$REGISTER_ENDPOINT" 2>&1) || {
    fail "registration request failed"
    echo "$REG_BODY" | head -5
    exit 1
  }
  verbose_print "registration response: $REG_BODY"

  CLIENT_ID=$(echo "$REG_BODY" | jq -r '.client_id // empty')
  if [ -z "$CLIENT_ID" ]; then
    fail "no client_id in registration response"
    echo "$REG_BODY"
    exit 1
  fi
  ok
  verbose_print "client_id = $CLIENT_ID"
fi

# ------------------------------------------------------------
# Step 4: /authorize redirect chain
# ------------------------------------------------------------
if [ "$NO_BROWSER" = "1" ]; then
  step "GET /authorize (NO_BROWSER mode — only verify endpoint exists)"
  AUTH_PROBE=$(curl -sS -o /dev/null -w "%{http_code}" --max-time 10 \
    "$AUTH_ENDPOINT?response_type=code&client_id=${CLIENT_ID:-test}&redirect_uri=$REDIRECT_URI&state=probe&code_challenge=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA&code_challenge_method=S256" 2>&1) || true
  if [ "$AUTH_PROBE" = "302" ] || [ "$AUTH_PROBE" = "200" ] || [ "$AUTH_PROBE" = "303" ]; then
    ok
  else
    fail "unexpected status $AUTH_PROBE"
  fi
else
  step "GET $AUTH_ENDPOINT (interactive)"
  echo
  echo "  ====================================================================="
  echo "  INTERACTIVE STEP — open the URL below in a browser, complete login,"
  echo "  and paste the 'code' query param from the redirect URL when prompted."
  echo
  CODE_VERIFIER=$(openssl rand -base64 32 | tr -d '=+/' | cut -c1-43)
  CODE_CHALLENGE=$(printf '%s' "$CODE_VERIFIER" | openssl dgst -sha256 -binary | openssl base64 | tr -d '=+/' | tr -- '+/' '-_')
  AUTH_URL="$AUTH_ENDPOINT?response_type=code&client_id=${CLIENT_ID:-test}&redirect_uri=$REDIRECT_URI&state=test&code_challenge=$CODE_CHALLENGE&code_challenge_method=S256&scope=$SCOPES_SUPPORTED"
  echo "  $AUTH_URL"
  echo "  ====================================================================="
  echo
  read -r -p "  Paste the 'code' from the redirect URL: " AUTH_CODE
  if [ -z "$AUTH_CODE" ]; then
    fail "no code provided"
    exit 1
  fi
  ok

  # Step 5: token exchange
  step "POST $TOKEN_ENDPOINT (token exchange)"
  TOKEN_BODY=$(curl -sS --fail-with-body --max-time 10 \
    -H "Content-Type: application/x-www-form-urlencoded" \
    -X POST \
    --data-urlencode "grant_type=authorization_code" \
    --data-urlencode "code=$AUTH_CODE" \
    --data-urlencode "redirect_uri=$REDIRECT_URI" \
    --data-urlencode "client_id=${CLIENT_ID:-test}" \
    --data-urlencode "code_verifier=$CODE_VERIFIER" \
    "$TOKEN_ENDPOINT" 2>&1) || {
    fail "token exchange failed"
    echo "$TOKEN_BODY" | head -5
    exit 1
  }
  verbose_print "token response: $TOKEN_BODY"

  ACCESS_TOKEN=$(echo "$TOKEN_BODY" | jq -r '.access_token // empty')
  if [ -z "$ACCESS_TOKEN" ]; then
    fail "no access_token in token response"
    echo "$TOKEN_BODY"
    exit 1
  fi
  ok
  verbose_print "access_token = ${ACCESS_TOKEN:0:8}... (truncated)"

  # Step 6: protected MCP call (tools/list, the simplest MCP method)
  step "POST $BASE_URL/mcp (Bearer token, tools/list)"
  MCP_BODY=$(curl -sS --max-time 10 \
    -H "Authorization: Bearer $ACCESS_TOKEN" \
    -H "Content-Type: application/json" \
    -H "Accept: application/json, text/event-stream" \
    -X POST -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' \
    "$BASE_URL/mcp" 2>&1) || true
  verbose_print "mcp response: $MCP_BODY"

  if echo "$MCP_BODY" | grep -q '"tools"'; then
    ok
  else
    fail "expected a tools/list response with 'tools' key"
    echo "$MCP_BODY" | head -10
  fi
fi

# ------------------------------------------------------------
# Summary
# ------------------------------------------------------------
echo
echo "===== verify-oauth-flow.sh ====="
echo "passed: $PASS"
echo "failed: $FAIL"
if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
exit 0
