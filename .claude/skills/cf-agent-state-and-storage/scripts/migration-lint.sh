#!/usr/bin/env bash
# migration-lint.sh
#
# Lints the `migrations` array in a wrangler.jsonc / wrangler.toml.
# Enforces the rules from cf-runtime-primitives §5 + cf-agents-core §15:
#
#   1. Tags are unique within migrations[].
#   2. Tags are monotonically increasing if they follow the v<N> convention.
#   3. Every name in new_sqlite_classes has a matching durable_objects.bindings.class_name.
#   4. WARN LOUDLY on new_classes (KV-backed, irreversible).
#   5. Every renamed_classes entry has both `from` and `to`.
#   6. Every transferred_classes entry has `from`, `from_script`, and `to`.
#
# Stella Principle: this is pure JSON parsing + string comparison. Don't push it through an LLM.
#
# Usage:
#   migration-lint.sh [path/to/wrangler.jsonc]
#   (defaults to ./wrangler.jsonc, falls back to ./wrangler.toml)

set -uo pipefail

CONFIG="${1:-}"

if [[ -z "$CONFIG" ]]; then
  if [[ -f "wrangler.jsonc" ]]; then
    CONFIG="wrangler.jsonc"
  elif [[ -f "wrangler.json" ]]; then
    CONFIG="wrangler.json"
  elif [[ -f "wrangler.toml" ]]; then
    CONFIG="wrangler.toml"
  else
    echo "ERROR: no wrangler config found. Pass a path or run from the project root." >&2
    exit 2
  fi
fi

if [[ ! -f "$CONFIG" ]]; then
  echo "ERROR: $CONFIG not found." >&2
  exit 2
fi

# Convert TOML to JSON so we have one parsing path. Prefer `dasel`, fall back to a python helper.
to_json() {
  local file="$1"
  case "$file" in
    *.toml)
      if command -v dasel >/dev/null 2>&1; then
        dasel -f "$file" -r toml -w json
      elif command -v python3 >/dev/null 2>&1; then
        python3 -c '
import sys, json
try:
    import tomllib
except ImportError:
    import tomli as tomllib  # py<3.11
with open(sys.argv[1], "rb") as fh:
    print(json.dumps(tomllib.load(fh)))
' "$file"
      else
        echo "ERROR: TOML parsing requires `dasel` or `python3`." >&2
        exit 2
      fi
      ;;
    *.jsonc|*.json)
      # Strip // and /* */ comments so jq can parse JSONC.
      # This is a coarse but adequate stripper — won't choke on the canonical wrangler shape.
      sed -E -e 's://[^"]*$::g' -e '/\/\*/,/\*\//d' "$file"
      ;;
    *)
      echo "ERROR: unrecognized config extension: $file" >&2
      exit 2
      ;;
  esac
}

if ! command -v jq >/dev/null 2>&1; then
  echo "ERROR: jq is required." >&2
  exit 2
fi

JSON=$(to_json "$CONFIG")
if [[ -z "$JSON" ]]; then
  echo "ERROR: failed to parse $CONFIG to JSON." >&2
  exit 2
fi

errors=0
warnings=0

err()  { echo "FAIL: $*" >&2; errors=$((errors+1)); }
warn() { echo "WARN: $*" >&2; warnings=$((warnings+1)); }
ok()   { echo "OK:   $*"; }

# ---------- check 1: tags unique ----------
TAGS=$(echo "$JSON" | jq -r '.migrations // [] | .[].tag')
if [[ -z "$TAGS" ]]; then
  warn "no migrations[] array in $CONFIG — first deploy will fail to instantiate the DO"
else
  DUPS=$(echo "$TAGS" | sort | uniq -d)
  if [[ -n "$DUPS" ]]; then
    err "duplicate migration tags: $(echo "$DUPS" | tr '\n' ',' | sed 's/,$//')"
  else
    ok "tags are unique"
  fi
fi

# ---------- check 2: monotonic v<N> ordering ----------
# Only enforces if the user follows the v<N> convention. Mixed schemes get a warn.
declare -a TAG_NUMS=()
allnum=1
while IFS= read -r tag; do
  if [[ "$tag" =~ ^v([0-9]+)$ ]]; then
    TAG_NUMS+=("${BASH_REMATCH[1]}")
  else
    allnum=0
  fi
done <<<"$TAGS"

if [[ "$allnum" == "1" && "${#TAG_NUMS[@]}" -gt 1 ]]; then
  prev=-1
  monotonic=1
  for n in "${TAG_NUMS[@]}"; do
    if [[ "$n" -le "$prev" ]]; then
      monotonic=0
      break
    fi
    prev=$n
  done
  if [[ "$monotonic" == "1" ]]; then
    ok "tags are monotonically increasing (v1, v2, ...)"
  else
    err "tags are NOT monotonically increasing — order: $(echo "$TAGS" | tr '\n' ' ')"
  fi
elif [[ "$allnum" == "0" && -n "$TAGS" ]]; then
  warn "non-v<N> tag scheme — order can't be auto-verified. Make sure tags only ever append."
fi

# ---------- check 3: no new_classes (KV-backed) ----------
NEW_KV=$(echo "$JSON" | jq -r '.migrations // [] | .[].new_classes // [] | .[]')
if [[ -n "$NEW_KV" ]]; then
  warn "==========================================================="
  warn "  new_classes (KV-backed) detected: $(echo "$NEW_KV" | tr '\n' ',' | sed 's/,$//')"
  warn "  This is IRREVERSIBLE. You can never convert to SQLite."
  warn "  Use new_sqlite_classes instead, ALWAYS."
  warn "==========================================================="
else
  ok "no legacy new_classes detected"
fi

# ---------- check 4: new_sqlite_classes have matching bindings ----------
SQLITE_CLASSES=$(echo "$JSON" | jq -r '.migrations // [] | .[].new_sqlite_classes // [] | .[]' | sort -u)
BOUND_CLASSES=$(echo "$JSON" | jq -r '.durable_objects.bindings // [] | .[].class_name' | sort -u)

if [[ -n "$SQLITE_CLASSES" ]]; then
  missing=""
  for cls in $SQLITE_CLASSES; do
    if ! grep -qx "$cls" <<<"$BOUND_CLASSES"; then
      missing="$missing $cls"
    fi
  done
  if [[ -n "$missing" ]]; then
    err "new_sqlite_classes without matching durable_objects.bindings:$missing"
  else
    ok "every new_sqlite_classes entry has a binding"
  fi
fi

# Also flag bindings without a corresponding migration (forgotten first migration)
if [[ -n "$BOUND_CLASSES" ]]; then
  RENAMED_TO=$(echo "$JSON" | jq -r '.migrations // [] | .[].renamed_classes // [] | .[].to' 2>/dev/null)
  TRANSFERRED_TO=$(echo "$JSON" | jq -r '.migrations // [] | .[].transferred_classes // [] | .[].to' 2>/dev/null)
  ALL_KNOWN=$(printf "%s\n%s\n%s\n%s" "$SQLITE_CLASSES" "$NEW_KV" "$RENAMED_TO" "$TRANSFERRED_TO" | sort -u | grep -v '^$')

  unmigrated=""
  for cls in $BOUND_CLASSES; do
    if ! grep -qx "$cls" <<<"$ALL_KNOWN"; then
      unmigrated="$unmigrated $cls"
    fi
  done
  if [[ -n "$unmigrated" ]]; then
    err "binding(s) with no migration entry — DO will fail to instantiate:$unmigrated"
  fi
fi

# ---------- check 5: renamed_classes shape ----------
RENAMED_BAD=$(echo "$JSON" | jq -c '
  .migrations // []
  | .[] | .renamed_classes // []
  | .[] | select((.from // "") == "" or (.to // "") == "")
')
if [[ -n "$RENAMED_BAD" ]]; then
  err "renamed_classes entries missing from/to: $RENAMED_BAD"
else
  ok "renamed_classes shapes are valid"
fi

# ---------- check 6: transferred_classes shape ----------
TRANSFER_BAD=$(echo "$JSON" | jq -c '
  .migrations // []
  | .[] | .transferred_classes // []
  | .[] | select((.from // "") == "" or (.to // "") == "" or (.from_script // "") == "")
')
if [[ -n "$TRANSFER_BAD" ]]; then
  err "transferred_classes entries missing from/from_script/to: $TRANSFER_BAD"
else
  ok "transferred_classes shapes are valid"
fi

# ---------- check 7: deleted_classes warning ----------
DELETED=$(echo "$JSON" | jq -r '.migrations // [] | .[].deleted_classes // [] | .[]')
if [[ -n "$DELETED" ]]; then
  warn "deleted_classes will DESTROY ALL DATA for: $(echo "$DELETED" | tr '\n' ',' | sed 's/,$//')"
  warn "Make sure binding + code references were removed in a PRIOR deploy."
fi

# ---------- summary ----------
echo
echo "=== migration-lint summary ==="
echo "errors:   $errors"
echo "warnings: $warnings"

if [[ "$errors" -gt 0 ]]; then
  exit 1
fi
exit 0
