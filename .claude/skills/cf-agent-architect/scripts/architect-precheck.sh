#!/usr/bin/env bash
# architect-precheck.sh
#
# Verifies the host environment is ready to bootstrap a Cloudflare agent.
# Exits non-zero on the first failure with an actionable message.
#
# Checks:
#   1. Node version  >= 20  (Cloudflare Workers + agents SDK target Node 20+; agents repo uses Node 24+)
#   2. wrangler is installed and runnable
#   3. Cloudflare account-id is resolvable (`wrangler whoami` succeeds)
#   4. Current directory is inside a git repo
#   5. No conflicting wrangler.toml in the project root
#      (Cloudflare Agents prefers wrangler.jsonc — cf-github-canon §6)
#
# Usage:  bash scripts/architect-precheck.sh
set -uo pipefail

C_RED=$'\033[0;31m'
C_GRN=$'\033[0;32m'
C_YLW=$'\033[1;33m'
C_RST=$'\033[0m'

ok()    { printf "%s[ OK ]%s %s\n" "$C_GRN" "$C_RST" "$1"; }
warn()  { printf "%s[WARN]%s %s\n" "$C_YLW" "$C_RST" "$1"; }
fail()  { printf "%s[FAIL]%s %s\n" "$C_RED" "$C_RST" "$1" >&2; exit 1; }

# ---------------------------------------------------------------------------
# 1. Node >= 20
# ---------------------------------------------------------------------------
if ! command -v node >/dev/null 2>&1; then
  fail "node is not installed. Install Node 20+ (https://nodejs.org/). Cloudflare Agents requires Node >= 20."
fi
NODE_VER_STR="$(node --version 2>/dev/null | sed 's/^v//')"
NODE_MAJOR="${NODE_VER_STR%%.*}"
if [[ -z "$NODE_MAJOR" || ! "$NODE_MAJOR" =~ ^[0-9]+$ ]]; then
  fail "could not parse node version: '$NODE_VER_STR'"
fi
if (( NODE_MAJOR < 20 )); then
  fail "node version is v$NODE_VER_STR; Cloudflare Agents requires Node >= 20. Upgrade: https://nodejs.org/"
fi
ok "node v$NODE_VER_STR (>= 20 required)"

# ---------------------------------------------------------------------------
# 2. wrangler installed
# ---------------------------------------------------------------------------
WRANGLER_BIN=""
if command -v wrangler >/dev/null 2>&1; then
  WRANGLER_BIN="wrangler"
elif command -v npx >/dev/null 2>&1 && npx --no-install wrangler --version >/dev/null 2>&1; then
  WRANGLER_BIN="npx wrangler"
else
  fail "wrangler is not installed. Install it: npm i -D wrangler  (or globally: npm i -g wrangler)"
fi
WRANGLER_VER="$($WRANGLER_BIN --version 2>/dev/null | head -n1 | awk '{print $NF}')"
if [[ -z "$WRANGLER_VER" ]]; then
  fail "wrangler is installed but '--version' produced no output. Reinstall wrangler."
fi
ok "wrangler $WRANGLER_VER (binary: $WRANGLER_BIN)"

# ---------------------------------------------------------------------------
# 3. Cloudflare account-id resolvable
# ---------------------------------------------------------------------------
WHOAMI_OUT="$($WRANGLER_BIN whoami 2>&1 || true)"
if echo "$WHOAMI_OUT" | grep -qiE 'not (logged|authenticated)'; then
  fail "wrangler is not logged in. Run: wrangler login   (or set CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID)"
fi
# Account ID can come from env or whoami. Accept either.
ACCOUNT_ID=""
if [[ -n "${CLOUDFLARE_ACCOUNT_ID:-}" ]]; then
  ACCOUNT_ID="$CLOUDFLARE_ACCOUNT_ID"
fi
if [[ -z "$ACCOUNT_ID" ]]; then
  ACCOUNT_ID="$(echo "$WHOAMI_OUT" | grep -oE '[0-9a-f]{32}' | head -n1)"
fi
if [[ -z "$ACCOUNT_ID" ]]; then
  warn "could not extract a Cloudflare account ID from 'wrangler whoami'."
  warn "Set CLOUDFLARE_ACCOUNT_ID, or ensure 'wrangler whoami' shows an account."
  fail "no Cloudflare account ID resolvable."
fi
ok "Cloudflare account-id resolvable (${ACCOUNT_ID:0:8}...)"

# ---------------------------------------------------------------------------
# 4. Inside a git repo
# ---------------------------------------------------------------------------
if ! command -v git >/dev/null 2>&1; then
  fail "git is not installed."
fi
if ! git rev-parse --git-dir >/dev/null 2>&1; then
  fail "current directory is not a git repository. Run: git init"
fi
GIT_TOPLEVEL="$(git rev-parse --show-toplevel)"
ok "git repository: $GIT_TOPLEVEL"

# ---------------------------------------------------------------------------
# 5. No conflicting wrangler.toml (Cloudflare Agents prefers .jsonc)
# ---------------------------------------------------------------------------
TOML_FILES=()
for candidate in "wrangler.toml" "$GIT_TOPLEVEL/wrangler.toml"; do
  if [[ -f "$candidate" ]]; then
    TOML_FILES+=("$candidate")
  fi
done
if (( ${#TOML_FILES[@]} > 0 )); then
  for f in "${TOML_FILES[@]}"; do
    warn "found wrangler.toml at: $f"
  done
  warn "Cloudflare Agents canonically uses wrangler.jsonc (cf-github-canon §6)."
  warn "Migrate: rename wrangler.toml -> wrangler.jsonc and convert to JSONC."
  fail "wrangler.toml present; expected wrangler.jsonc."
fi
ok "no conflicting wrangler.toml in project root"

# ---------------------------------------------------------------------------
# Optional: warn if an existing wrangler.jsonc lacks nodejs_compat
# ---------------------------------------------------------------------------
JSONC_PATHS=("wrangler.jsonc" "$GIT_TOPLEVEL/wrangler.jsonc")
for p in "${JSONC_PATHS[@]}"; do
  if [[ -f "$p" ]]; then
    if ! grep -q '"nodejs_compat"' "$p"; then
      warn "$p exists but does not list 'nodejs_compat' in compatibility_flags."
      warn "Cloudflare Agents requires nodejs_compat (cf-agents-core §15)."
    fi
    break
  fi
done

printf "\n%sAll precheck gates passed.%s Ready to draft the architecture spec.\n" "$C_GRN" "$C_RST"
exit 0
