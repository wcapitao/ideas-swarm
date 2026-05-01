#!/usr/bin/env bash
# wrangler-doctor.sh — sanity-check wrangler.jsonc + bindings + secrets
#
# Validates a Cloudflare Agent's wrangler config. Reports clearly with
# pass/warn/fail. Non-zero exit on any FAIL.
#
# Checks:
#   1. wrangler.jsonc exists; no wrangler.toml siding alongside.
#   2. compatibility_date is recent (within last 12 months).
#   3. compatibility_flags includes "nodejs_compat" if the source uses
#      node-flavored APIs (process, crypto, async_hooks, fs, ...).
#   4. observability.enabled is true.
#   5. upload_source_maps is true.
#   6. Every durable_objects.bindings[].class_name has a matching
#      migration tag (new_sqlite_classes / new_classes /
#      renamed_classes.to / transferred_classes.to).
#   7. No DO uses new_classes (legacy KV-backed; warn).
#   8. secrets.required, if present, lists every secret referenced as
#      env.X in the source (best-effort grep).
#   9. workers_dev is false in env.production (if env.production exists).
#  10. routes / custom_domain configured for production env.
#
# Usage:
#   bash scripts/wrangler-doctor.sh [path/to/wrangler.jsonc]
#
# Defaults to ./wrangler.jsonc.

set -uo pipefail

CFG="${1:-./wrangler.jsonc}"
PROJECT_DIR="$(dirname "$CFG")"
SRC_DIR="${PROJECT_DIR}/src"

PASS=0
WARN=0
FAIL=0

red()   { printf "\033[31m%s\033[0m" "$1"; }
green() { printf "\033[32m%s\033[0m" "$1"; }
yellow(){ printf "\033[33m%s\033[0m" "$1"; }

ok()   { echo "  $(green PASS) $1"; PASS=$((PASS+1)); }
warn() { echo "  $(yellow WARN) $1"; WARN=$((WARN+1)); }
fail() { echo "  $(red FAIL) $1"; FAIL=$((FAIL+1)); }

echo "wrangler-doctor: $CFG"
echo

# ── 1. exists, no toml siding ────────────────────────────────────────
if [ ! -f "$CFG" ]; then
  fail "wrangler.jsonc not found at $CFG"
  exit 1
fi
ok "wrangler.jsonc found"

if [ -f "${PROJECT_DIR}/wrangler.toml" ]; then
  fail "wrangler.toml exists alongside wrangler.jsonc — mixed config silently breaks"
else
  ok "no wrangler.toml siding"
fi

# Strip jsonc comments so node can parse it.
JSON_TMP="$(mktemp)"
trap 'rm -f "$JSON_TMP"' EXIT
node -e "
  const fs = require('fs');
  const raw = fs.readFileSync(process.argv[1], 'utf8');
  const stripped = raw
    .replace(/\\/\\*[\\s\\S]*?\\*\\//g, '')
    .replace(/^\\s*\\/\\/.*\$/gm, '')
    .replace(/,(\\s*[}\\]])/g, '\$1');
  fs.writeFileSync(process.argv[2], stripped);
" "$CFG" "$JSON_TMP" 2>/dev/null || { fail "could not pre-process wrangler.jsonc"; exit 1; }

if ! node -e "JSON.parse(require('fs').readFileSync('$JSON_TMP','utf8'))" 2>/dev/null; then
  fail "wrangler.jsonc is not valid JSON after comment stripping"
  exit 1
fi
ok "wrangler.jsonc is valid jsonc"

# Helper: run a JS expression against the parsed config, emit result.
jq_node() {
  node -e "
    const c = JSON.parse(require('fs').readFileSync('$JSON_TMP','utf8'));
    const v = ($1);
    process.stdout.write(typeof v === 'object' ? JSON.stringify(v) : String(v ?? ''));
  "
}

# ── 2. compatibility_date is recent ─────────────────────────────────
COMPAT_DATE="$(jq_node 'c.compatibility_date')"
if [ -z "$COMPAT_DATE" ]; then
  fail "compatibility_date is missing"
else
  AGE_DAYS="$(node -e "
    const d = new Date('$COMPAT_DATE');
    const days = Math.floor((Date.now() - d.getTime()) / (1000*60*60*24));
    process.stdout.write(String(days));
  ")"
  if [ "$AGE_DAYS" -lt 0 ]; then
    warn "compatibility_date is in the future ($COMPAT_DATE)"
  elif [ "$AGE_DAYS" -gt 365 ]; then
    warn "compatibility_date is $AGE_DAYS days old ($COMPAT_DATE) — consider bumping with testing"
  else
    ok "compatibility_date is $AGE_DAYS days old ($COMPAT_DATE)"
  fi
fi

# ── 3. nodejs_compat ────────────────────────────────────────────────
HAS_NODEJS_COMPAT="$(jq_node "(c.compatibility_flags||[]).includes('nodejs_compat')")"
if [ "$HAS_NODEJS_COMPAT" = "true" ]; then
  ok "compatibility_flags includes nodejs_compat"
else
  if [ -d "$SRC_DIR" ] && grep -rE "(from ['\"]node:|require\(['\"]node:|process\.|crypto\.|Buffer\.)" "$SRC_DIR" >/dev/null 2>&1; then
    fail "compatibility_flags missing nodejs_compat but source imports node-flavored APIs"
  else
    warn "compatibility_flags missing nodejs_compat (Agents typically need it)"
  fi
fi

# ── 4. observability.enabled ────────────────────────────────────────
OBS_ENABLED="$(jq_node 'c.observability?.enabled === true')"
if [ "$OBS_ENABLED" = "true" ]; then
  ok "observability.enabled = true"
else
  fail "observability.enabled is not true — Workers Logs will be empty"
fi

# ── 5. upload_source_maps ───────────────────────────────────────────
UPLOAD_SM="$(jq_node 'c.upload_source_maps === true')"
if [ "$UPLOAD_SM" = "true" ]; then
  ok "upload_source_maps = true"
else
  warn "upload_source_maps not enabled — production stack traces will not remap"
fi

# ── 6. every DO binding has a migration tag ─────────────────────────
MIGRATION_CHECK="$(node -e "
  const c = JSON.parse(require('fs').readFileSync('$JSON_TMP','utf8'));
  const collect = (root) => {
    const bindings = (root?.durable_objects?.bindings || []).map(b => b.class_name);
    const migrated = new Set();
    for (const m of (root?.migrations || [])) {
      (m.new_sqlite_classes || []).forEach(x => migrated.add(x));
      (m.new_classes || []).forEach(x => migrated.add(x));
      (m.renamed_classes || []).forEach(r => migrated.add(r.to));
      (m.transferred_classes || []).forEach(t => migrated.add(t.to));
      (m.deleted_classes || []).forEach(x => migrated.delete(x));
    }
    return bindings.filter(b => !migrated.has(b));
  };
  const top = collect(c);
  const errs = [...top.map(c => 'top: ' + c)];
  for (const env of Object.keys(c.env || {})) {
    const merged = {
      durable_objects: c.env[env].durable_objects || c.durable_objects,
      migrations: c.env[env].migrations || c.migrations,
    };
    const missing = collect(merged);
    for (const m of missing) errs.push(env + ': ' + m);
  }
  process.stdout.write(errs.join('|'));
")"

if [ -z "$MIGRATION_CHECK" ]; then
  ok "every DO binding has a migration tag"
else
  IFS='|'
  for e in $MIGRATION_CHECK; do
    fail "DO class missing migration: $e"
  done
  unset IFS
fi

# ── 7. legacy new_classes ───────────────────────────────────────────
LEGACY="$(node -e "
  const c = JSON.parse(require('fs').readFileSync('$JSON_TMP','utf8'));
  const out = [];
  for (const m of (c.migrations || [])) {
    if (m.new_classes && m.new_classes.length) out.push(\`tag \${m.tag}: \${m.new_classes.join(',')}\`);
  }
  process.stdout.write(out.join('|'));
")"
if [ -z "$LEGACY" ]; then
  ok "no legacy new_classes (KV-backed) in migrations"
else
  IFS='|'
  for e in $LEGACY; do
    warn "legacy KV-backed DO via new_classes: $e — there is no migration path to SQLite"
  done
  unset IFS
fi

# ── 8. secrets.required vs env.X usage ──────────────────────────────
DECLARED="$(jq_node "(c.secrets?.required || []).join(',')")"
if [ -z "$DECLARED" ]; then
  warn "no secrets.required manifest — deploy will not fail on missing secrets"
else
  ok "secrets.required declared: $DECLARED"
  # Best-effort: find env.X references in source.
  if [ -d "$SRC_DIR" ]; then
    USED_RAW="$(grep -rEho "env\.[A-Z_][A-Z_0-9]*" "$SRC_DIR" 2>/dev/null | sed 's/env\.//' | sort -u || true)"
    for s in $(echo "$DECLARED" | tr ',' '\n'); do
      if ! echo "$USED_RAW" | grep -q "^${s}\$"; then
        warn "secrets.required lists $s but no env.$s reference found in src/"
      fi
    done
  fi
fi

# ── 9. workers_dev=false in production ──────────────────────────────
HAS_PROD="$(jq_node "Boolean(c.env?.production)")"
if [ "$HAS_PROD" = "true" ]; then
  PROD_WD="$(jq_node "c.env.production.workers_dev")"
  if [ "$PROD_WD" = "false" ]; then
    ok "env.production.workers_dev = false"
  else
    warn "env.production.workers_dev is not false — public *.workers.dev URL exposed"
  fi

  # ── 10. routes / custom_domain ───────────────────────────────────
  ROUTES="$(jq_node "(c.env.production.routes || []).filter(r => r.custom_domain === true).length > 0")"
  if [ "$ROUTES" = "true" ]; then
    ok "env.production has at least one custom_domain route"
  else
    warn "env.production has no custom_domain route — only *.workers.dev"
  fi
else
  warn "no env.production block — production deploys go to the default env"
fi

# ── Summary ─────────────────────────────────────────────────────────
echo
echo "Summary: $(green "$PASS pass") / $(yellow "$WARN warn") / $(red "$FAIL fail")"

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
exit 0
