#!/usr/bin/env -S bunx tsx
/**
 * lint-tool-descriptions.ts
 *
 * Walks a folder of TypeScript files, extracts tool definitions from any of:
 *
 *   server.tool(name, description, schema, handler)        // McpAgent
 *   server.registerTool(name, { description, ... }, ...)   // McpAgent (alt API)
 *   tool({ description, inputSchema, execute, ... })       // AI SDK
 *   @callable({ description: "..." })                      // Agent
 *
 * Flags descriptions that:
 *   - are too short (<40 chars) or too long (>400 chars)
 *   - lack an action verb in the first 5 words
 *   - re-state the parameter list ("Takes a, b, c" pattern)
 *   - use hedge words (might, sometimes, may, possibly, perhaps)
 *   - duplicate another tool's description in the same scan
 *   - contain a TODO placeholder
 *
 * Usage:
 *   bunx tsx lint-tool-descriptions.ts <path>...
 *   bunx tsx lint-tool-descriptions.ts ./src/tools
 *
 * Exit code 0 if clean. Non-zero with the issue count on failure.
 *
 * Inspired by audit-agent-descriptions.py from agent-subagent-orchestration.
 */

import { readFileSync, statSync, readdirSync } from "node:fs";
import { join, extname } from "node:path";

// ---------- config ----------

const MIN_LEN = 40;
const MAX_LEN = 400;

const HEDGE_WORDS = new Set([
  "might",
  "sometimes",
  "may",
  "possibly",
  "perhaps",
  "maybe",
  "occasionally",
  "kinda",
  "sort of",
]);

// Common action verbs that should appear early in a description.
const ACTION_VERBS = new Set([
  "add",
  "answer",
  "apply",
  "archive",
  "build",
  "calculate",
  "cancel",
  "charge",
  "check",
  "compute",
  "configure",
  "convert",
  "copy",
  "create",
  "delete",
  "deploy",
  "describe",
  "dispatch",
  "download",
  "echo",
  "edit",
  "execute",
  "extract",
  "fetch",
  "find",
  "force",
  "format",
  "generate",
  "get",
  "grant",
  "import",
  "increment",
  "insert",
  "invoke",
  "kill",
  "launch",
  "list",
  "load",
  "log",
  "lookup",
  "map",
  "match",
  "merge",
  "move",
  "navigate",
  "notify",
  "open",
  "parse",
  "patch",
  "ping",
  "post",
  "process",
  "publish",
  "purge",
  "push",
  "put",
  "query",
  "read",
  "rebuild",
  "receive",
  "record",
  "refresh",
  "register",
  "reject",
  "remove",
  "rename",
  "render",
  "reply",
  "report",
  "request",
  "reset",
  "resolve",
  "restart",
  "retrieve",
  "return",
  "revoke",
  "run",
  "save",
  "scan",
  "schedule",
  "search",
  "send",
  "set",
  "show",
  "shutdown",
  "sign",
  "simulate",
  "snapshot",
  "split",
  "start",
  "stop",
  "store",
  "stream",
  "submit",
  "subtract",
  "summarize",
  "sync",
  "tag",
  "test",
  "transfer",
  "transform",
  "trigger",
  "truncate",
  "unlock",
  "unsubscribe",
  "update",
  "upload",
  "validate",
  "verify",
  "view",
  "watch",
  "write",
]);

// ---------- types ----------

interface Issue {
  file: string;
  line: number;
  toolName: string;
  description: string;
  message: string;
}

// ---------- extraction ----------

/** Strip JS/TS line and block comments to avoid matching descriptions inside them. */
function stripComments(src: string): string {
  // remove /* ... */ (non-greedy, multiline)
  let out = src.replace(/\/\*[\s\S]*?\*\//g, (m) => " ".repeat(m.length));
  // remove // line comments while preserving newlines for line numbering
  out = out.replace(/\/\/[^\n]*/g, (m) => " ".repeat(m.length));
  return out;
}

interface Match {
  toolName: string;
  description: string;
  index: number; // char offset
}

/** Extract every tool description we can find in `text`. */
function extractTools(text: string): Match[] {
  const out: Match[] = [];
  const cleaned = stripComments(text);

  // 1. server.tool("name", "description", schema, handler)
  //    or server.registerTool("name", { description: "..." }, ...)
  //    Match name as the first string arg, description as the second string arg
  //    or as `description: "..."` inside an options object.
  const reTool = /\b(?:server|s|this\.server)\.(?:tool|registerTool)\s*\(\s*["'`]([^"'`]+)["'`]\s*,\s*(?:["'`]([^"'`]*)["'`]|\{[^}]*?\bdescription\s*:\s*["'`]([^"'`]*)["'`])/g;
  for (const m of cleaned.matchAll(reTool)) {
    const desc = m[2] ?? m[3] ?? "";
    out.push({ toolName: m[1], description: desc, index: m.index ?? 0 });
  }

  // 2. AI SDK: <name>: tool({ description: "...", ... })
  //    Or:    const <name> = tool({ description: "...", ... })
  //    We capture description; tool name comes from the property/identifier.
  const reAiSdk =
    /(?:\b(?:const|let|var)\s+|\b)(\w[\w$]*)\s*[:=]\s*tool\s*\(\s*\{[^}]*?\bdescription\s*:\s*["'`]([^"'`]*)["'`]/g;
  for (const m of cleaned.matchAll(reAiSdk)) {
    out.push({ toolName: m[1], description: m[2], index: m.index ?? 0 });
  }

  // 3. @callable({ description: "..." })
  //    Tool name is the next method identifier on the line(s) below.
  const reCallable = /@callable\s*\(\s*\{[^}]*?\bdescription\s*:\s*["'`]([^"'`]*)["'`][^}]*?\}\s*\)\s*\n?\s*(?:async\s+)?(\w[\w$]*)/g;
  for (const m of cleaned.matchAll(reCallable)) {
    const desc = m[1];
    const name = m[2] ?? "<unknown>";
    out.push({ toolName: name, description: desc, index: m.index ?? 0 });
  }

  return out;
}

function lineOf(text: string, idx: number): number {
  let n = 1;
  for (let i = 0; i < idx && i < text.length; i++) if (text[i] === "\n") n++;
  return n;
}

// ---------- linting ----------

function lint(m: Match, file: string, allDescs: Map<string, string[]>): Issue[] {
  const issues: Issue[] = [];
  const desc = m.description.trim();
  const len = desc.length;

  if (len === 0) {
    issues.push({ file, line: 0, toolName: m.toolName, description: desc, message: "empty description" });
    return issues;
  }

  if (len < MIN_LEN) {
    issues.push({
      file,
      line: 0,
      toolName: m.toolName,
      description: desc,
      message: `too short (${len} chars; aim for ${MIN_LEN}-${MAX_LEN})`,
    });
  }
  if (len > MAX_LEN) {
    issues.push({
      file,
      line: 0,
      toolName: m.toolName,
      description: desc,
      message: `too long (${len} chars; aim for ${MIN_LEN}-${MAX_LEN})`,
    });
  }

  // First-5-words action-verb check
  const firstWords = desc
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 5);
  const hasVerb = firstWords.some((w) => ACTION_VERBS.has(w));
  if (!hasVerb) {
    issues.push({
      file,
      line: 0,
      toolName: m.toolName,
      description: desc,
      message: `no action verb in first 5 words: ${firstWords.join(" ")}`,
    });
  }

  // Hedge words
  const lower = desc.toLowerCase();
  for (const h of HEDGE_WORDS) {
    if (new RegExp(`\\b${h.replace(/\s+/g, "\\s+")}\\b`).test(lower)) {
      issues.push({
        file,
        line: 0,
        toolName: m.toolName,
        description: desc,
        message: `hedge word: '${h}'`,
      });
    }
  }

  // "Takes a, b, c" anti-pattern: re-stating the parameter list
  if (/^takes?\s+(?:[a-z_]+\s*,\s*){1,}[a-z_]+/i.test(desc)) {
    issues.push({
      file,
      line: 0,
      toolName: m.toolName,
      description: desc,
      message: "re-states the parameter list ('Takes a, b, c'); explain WHAT and WHEN instead",
    });
  }

  // TODO placeholder
  if (/\bTODO\b/.test(desc)) {
    issues.push({
      file,
      line: 0,
      toolName: m.toolName,
      description: desc,
      message: "contains TODO placeholder",
    });
  }

  // Duplicate tracking — populate map; duplicates surfaced after the pass
  const key = desc.toLowerCase();
  const existing = allDescs.get(key) ?? [];
  existing.push(`${file}::${m.toolName}`);
  allDescs.set(key, existing);

  return issues;
}

// ---------- traversal ----------

function* walk(path: string): Generator<string> {
  const st = statSync(path);
  if (st.isDirectory()) {
    for (const entry of readdirSync(path)) {
      if (entry === "node_modules" || entry.startsWith(".")) continue;
      yield* walk(join(path, entry));
    }
  } else if (st.isFile()) {
    const ext = extname(path);
    if (ext === ".ts" || ext === ".tsx" || ext === ".mts" || ext === ".cts") {
      yield path;
    }
  }
}

// ---------- main ----------

function main(): number {
  const argv = process.argv.slice(2);
  if (argv.length === 0) {
    console.error("Usage: lint-tool-descriptions.ts <path>...");
    return 64;
  }

  const allDescs = new Map<string, string[]>();
  let totalIssues = 0;
  let totalTools = 0;

  for (const root of argv) {
    let exists = true;
    try {
      statSync(root);
    } catch {
      exists = false;
    }
    if (!exists) {
      console.error(`  [WARN] ${root}: not found`);
      continue;
    }

    for (const file of walk(root)) {
      const text = readFileSync(file, "utf8");
      const matches = extractTools(text);
      if (matches.length === 0) continue;

      for (const m of matches) {
        totalTools++;
        const line = lineOf(text, m.index);
        const issues = lint(m, file, allDescs);
        if (issues.length > 0) {
          console.log(`  [FAIL] ${file}:${line}  tool=${m.toolName}`);
          console.log(`         "${m.description.slice(0, 120)}${m.description.length > 120 ? "..." : ""}"`);
          for (const i of issues) {
            console.log(`         - ${i.message}`);
            totalIssues++;
          }
        } else {
          console.log(`  [OK]   ${file}:${line}  tool=${m.toolName}  (${m.description.length} chars)`);
        }
      }
    }
  }

  // After the pass, surface any duplicate descriptions
  for (const [desc, locations] of allDescs) {
    if (locations.length > 1) {
      console.log(`  [DUPE] description used by ${locations.length} tools:`);
      console.log(`         "${desc.slice(0, 120)}${desc.length > 120 ? "..." : ""}"`);
      for (const loc of locations) console.log(`         - ${loc}`);
      totalIssues += locations.length - 1;
    }
  }

  console.log(`\nScanned ${totalTools} tool definitions; ${totalIssues} issue(s).`);
  return totalIssues > 0 ? 1 : 0;
}

process.exit(main());
