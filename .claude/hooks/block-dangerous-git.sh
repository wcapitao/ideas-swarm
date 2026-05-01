#!/usr/bin/env bash
# Block dangerous git commands that could destroy work
COMMAND="${CLAUDE_BASH_COMMAND:-}"

if echo "$COMMAND" | grep -qE 'git\s+(push\s+--force|reset\s+--hard|clean\s+-[a-z]*f|branch\s+-D)'; then
  echo "BLOCKED: Dangerous git command detected: $COMMAND" >&2
  exit 2
fi

exit 0
