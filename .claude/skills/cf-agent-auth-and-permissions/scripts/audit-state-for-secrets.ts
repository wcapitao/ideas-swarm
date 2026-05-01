#!/usr/bin/env -S node --import tsx
/**
 * audit-state-for-secrets.ts
 *
 * Reads a JSON snapshot of agent state and regex-greps for token-shaped
 * strings. Exits non-zero if any are found in the broadcast `state`
 * field. OK if they live in `props` or raw storage outside `state`.
 *
 * USAGE:
 *   node --import tsx audit-state-for-secrets.ts <state-snapshot.json>
 *
 * The snapshot is expected to be a JSON object of the shape:
 *   {
 *     "state": { ...broadcast state... },
 *     "props": { ...server-only props... },        // optional, ignored
 *     "storage": { ...ctx.storage entries... }     // optional, ignored
 *   }
 *
 * EXIT CODES:
 *   0 — clean. No secrets in state.
 *   1 — secrets found in state. Failure with a breakdown.
 *   2 — input file unreadable or not the expected shape.
 *
 * Wire into CI:
 *   - run: node --import tsx scripts/audit-state-for-secrets.ts test/fixtures/agent-state.json
 */

import * as fs from "node:fs";
import * as path from "node:path";

interface Finding {
  jsonPath: string;
  pattern: string;
  sample: string;
}

// Regexes for things that should NEVER be in broadcast state.
// Keep them tight to avoid false positives, broad enough to catch the obvious.
const PATTERNS: Array<{ name: string; re: RegExp }> = [
  // Bearer tokens in any form
  { name: "Bearer header", re: /\bBearer\s+[A-Za-z0-9._\-/+=]{16,}/g },

  // JWT — three base64url segments separated by dots
  { name: "JWT", re: /\beyJ[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}\b/g },

  // Stripe live keys
  { name: "Stripe live key", re: /\bsk_live_[A-Za-z0-9]{16,}\b/g },
  { name: "Stripe test key", re: /\bsk_test_[A-Za-z0-9]{16,}\b/g },
  { name: "Stripe restricted key", re: /\brk_(live|test)_[A-Za-z0-9]{16,}\b/g },

  // GitHub tokens
  { name: "GitHub OAuth token", re: /\bgho_[A-Za-z0-9]{30,}\b/g },
  { name: "GitHub user token", re: /\bghu_[A-Za-z0-9]{30,}\b/g },
  { name: "GitHub server token", re: /\bghs_[A-Za-z0-9]{30,}\b/g },
  { name: "GitHub PAT (classic)", re: /\bghp_[A-Za-z0-9]{30,}\b/g },
  { name: "GitHub fine-grained PAT", re: /\bgithub_pat_[A-Za-z0-9_]{50,}\b/g },

  // Slack
  { name: "Slack bot token", re: /\bxoxb-[0-9]+-[0-9]+-[A-Za-z0-9]+\b/g },
  { name: "Slack user token", re: /\bxoxp-[0-9]+-[0-9]+-[0-9]+-[A-Za-z0-9]+\b/g },

  // OpenAI / Anthropic
  { name: "OpenAI API key", re: /\bsk-[A-Za-z0-9_\-]{20,}\b/g },
  { name: "Anthropic API key", re: /\bsk-ant-[A-Za-z0-9_\-]{20,}\b/g },

  // AWS access keys
  { name: "AWS access key ID", re: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g },

  // Google
  { name: "Google API key", re: /\bAIza[0-9A-Za-z_\-]{35}\b/g },

  // Generic long base64 (last-resort, narrow lower bound to reduce noise)
  { name: "Suspiciously long base64", re: /\b[A-Za-z0-9+/]{60,}={0,2}\b/g },

  // Field-name canaries — even if the value looks innocent, the KEY is sus.
  // These are caught in the walker, not via regex.
];

const SUSPICIOUS_FIELD_NAMES = new Set([
  "accessToken", "access_token",
  "refreshToken", "refresh_token",
  "idToken", "id_token",
  "apiKey", "api_key",
  "clientSecret", "client_secret",
  "privateKey", "private_key",
  "password", "secret",
  "githubToken", "github_token",
  "openaiKey", "openai_key",
  "jwt", "bearerToken", "bearer_token",
]);

function walk(
  node: unknown,
  jsonPath: string,
  findings: Finding[],
): void {
  if (node === null || node === undefined) return;

  if (typeof node === "string") {
    for (const { name, re } of PATTERNS) {
      // Reset state across iterations for /g regexes.
      re.lastIndex = 0;
      const matches = node.match(re);
      if (matches && matches.length > 0) {
        findings.push({
          jsonPath,
          pattern: name,
          sample: redact(matches[0]),
        });
      }
    }
    return;
  }

  if (Array.isArray(node)) {
    node.forEach((item, i) => walk(item, `${jsonPath}[${i}]`, findings));
    return;
  }

  if (typeof node === "object") {
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      const childPath = jsonPath ? `${jsonPath}.${k}` : k;
      // Field-name canary
      if (SUSPICIOUS_FIELD_NAMES.has(k) && v !== null && v !== "" && v !== undefined) {
        findings.push({
          jsonPath: childPath,
          pattern: `suspicious field name "${k}"`,
          sample: typeof v === "string" ? redact(v) : `<${typeof v}>`,
        });
      }
      walk(v, childPath, findings);
    }
  }
}

function redact(s: string): string {
  if (s.length <= 8) return "****";
  return `${s.slice(0, 4)}...${s.slice(-2)}`;
}

function main(): never {
  const [, , filePath] = process.argv;
  if (!filePath) {
    process.stderr.write(
      "usage: audit-state-for-secrets.ts <state-snapshot.json>\n",
    );
    process.exit(2);
  }

  const abs = path.resolve(filePath);
  let raw: string;
  try {
    raw = fs.readFileSync(abs, "utf8");
  } catch (err) {
    process.stderr.write(`cannot read ${abs}: ${(err as Error).message}\n`);
    process.exit(2);
  }

  let snapshot: unknown;
  try {
    snapshot = JSON.parse(raw);
  } catch (err) {
    process.stderr.write(`invalid JSON in ${abs}: ${(err as Error).message}\n`);
    process.exit(2);
  }

  if (typeof snapshot !== "object" || snapshot === null) {
    process.stderr.write(
      "snapshot must be a JSON object with at least a `state` key\n",
    );
    process.exit(2);
  }

  const obj = snapshot as Record<string, unknown>;

  // Audit ONLY the broadcast state surface. props / storage are server-only
  // by construction — secrets there are fine.
  const state = obj.state ?? obj; // tolerate snapshots that ARE the state
  const findings: Finding[] = [];
  walk(state, "state", findings);

  if (findings.length === 0) {
    process.stdout.write("audit-state-for-secrets: clean. No secrets in state.\n");
    process.exit(0);
  }

  process.stderr.write(
    `audit-state-for-secrets: FOUND ${findings.length} potential secret(s) in broadcast state:\n`,
  );
  for (const f of findings) {
    process.stderr.write(
      `  - ${f.jsonPath}  [${f.pattern}]  sample=${f.sample}\n`,
    );
  }
  process.stderr.write(
    "\n  Fix: move these fields out of `setState` / `this.state`.\n" +
    "       Use `this.props` (per-session, server-only) or\n" +
    "       `this.ctx.storage.put()` (server-only) instead.\n" +
    "       See references/props-vs-state.md.\n",
  );
  process.exit(1);
}

main();
