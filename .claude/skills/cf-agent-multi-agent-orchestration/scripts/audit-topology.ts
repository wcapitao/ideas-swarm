#!/usr/bin/env -S npx tsx
/**
 * audit-topology.ts — graph the multi-agent topology of a Cloudflare Agents codebase.
 *
 * Walks a source tree, finds:
 *   - class declarations that extend Agent / AIChatAgent / McpAgent
 *   - getAgentByName(env.X, ...) calls — and which class makes them
 *   - SDK sub-agent calls (agentTool, runAgentTool)
 *
 * Emits:
 *   - a Mermaid diagram of the agent->agent call graph
 *   - a list of detected cycles (exits non-zero if any)
 *   - a list of agent classes with no incoming edges (potential entry points)
 *
 * Usage:
 *     npx tsx audit-topology.ts <src-dir> [<src-dir>...]
 *     npx tsx audit-topology.ts src/
 *
 * Exit codes:
 *     0 — no cycles, topology is a DAG
 *     1 — cycles detected
 *     2 — usage error
 *
 * Notes:
 *   - This is a static, regex-based analysis. It does not execute code.
 *   - It will miss dynamic dispatch (e.g. `getAgentByName(env[someVar], ...)`).
 *   - It will catch the common cases (`getAgentByName(env.AgentClass, ...)`)
 *     and the SDK sub-agent helpers (`agentTool(SomeAgent, ...)`).
 */

import * as fs from "node:fs";
import * as path from "node:path";

type AgentClass = string;            // e.g. "ChatSupervisor"
type Edge = { from: AgentClass; to: AgentClass; file: string; line: number };

const AGENT_BASE_CLASSES = [
  "Agent",
  "AIChatAgent",
  "McpAgent",
  "Think",
  "WorkflowEntrypoint",   // workflows can call agents and form part of the topology
];

const SOURCE_EXTS = [".ts", ".tsx", ".mts", ".cts", ".js", ".mjs", ".jsx"];

// Match: export class Foo extends Bar<...> {
const CLASS_DECL_RE =
  /export\s+class\s+(\w+)\s+extends\s+(\w+)(?:<[^>]*>)?/g;

// Match: getAgentByName(env.X, ...)  or getAgentByName<...>(env.X, ...)
const GETAGENTBYNAME_RE =
  /getAgentByName\s*(?:<[^>]*>)?\s*\(\s*(?:this\.)?env\.(\w+)\s*,/g;

// Match: agentTool(SomeAgent, ...)  or runAgentTool(SomeAgent, ...)
const AGENTTOOL_RE =
  /(?:agentTool|runAgentTool)\s*\(\s*(\w+)\s*[,)]/g;

function walk(dir: string, out: string[]): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || entry.name === "node_modules" || entry.name === "dist" || entry.name === "build") {
      continue;
    }
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, out);
    } else if (entry.isFile() && SOURCE_EXTS.includes(path.extname(entry.name))) {
      out.push(full);
    }
  }
}

function readSource(file: string): string {
  return fs.readFileSync(file, "utf8");
}

/**
 * Find all class declarations that extend an Agent base class.
 * Returns a map { className -> baseClass }.
 */
function findAgentClasses(files: string[]): Map<AgentClass, { base: string; file: string; line: number }> {
  const classes = new Map<AgentClass, { base: string; file: string; line: number }>();
  for (const f of files) {
    const src = readSource(f);
    CLASS_DECL_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = CLASS_DECL_RE.exec(src)) !== null) {
      const [, className, baseClass] = m;
      if (AGENT_BASE_CLASSES.includes(baseClass)) {
        const line = src.slice(0, m.index).split("\n").length;
        classes.set(className, { base: baseClass, file: f, line });
      }
    }
  }
  return classes;
}

/**
 * For each source file, determine which agent class "owns" each character
 * offset (i.e. which class body the offset falls inside). Used to attribute
 * a getAgentByName call to the calling class.
 */
function buildClassRangeIndex(file: string, src: string, agentClasses: Set<AgentClass>): Array<{ name: AgentClass; start: number; end: number }> {
  const ranges: Array<{ name: AgentClass; start: number; end: number }> = [];
  // Naive: find each "export class X extends ..." then match braces forward.
  CLASS_DECL_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = CLASS_DECL_RE.exec(src)) !== null) {
    const [, className] = m;
    if (!agentClasses.has(className)) continue;
    // Find the "{" that opens the class body. We must skip past any type-
    // parameter list on the base class (e.g. `extends Agent<Env, {}>`) — its
    // `{}` would otherwise be mistaken for the class body.
    let scanFrom = m.index + m[0].length;
    while (scanFrom < src.length && /\s/.test(src[scanFrom])) scanFrom++;
    if (src[scanFrom] === "<") {
      let tdepth = 1;
      scanFrom++;
      while (scanFrom < src.length && tdepth > 0) {
        const ch = src[scanFrom];
        if (ch === "<") tdepth++;
        else if (ch === ">") tdepth--;
        else if (ch === "{") {
          // Type-level object literal inside generic params — walk braces.
          let bdepth = 1;
          scanFrom++;
          while (scanFrom < src.length && bdepth > 0) {
            if (src[scanFrom] === "{") bdepth++;
            else if (src[scanFrom] === "}") bdepth--;
            scanFrom++;
          }
          continue;
        }
        scanFrom++;
      }
    }
    const openIdx = src.indexOf("{", scanFrom);
    if (openIdx < 0) continue;
    // Walk to the matching closing brace.
    let depth = 1;
    let i = openIdx + 1;
    while (i < src.length && depth > 0) {
      const ch = src[i];
      if (ch === "{") depth++;
      else if (ch === "}") depth--;
      // Skip strings (very rough — does not handle template-string interpolation)
      else if (ch === '"' || ch === "'" || ch === "`") {
        const quote = ch;
        i++;
        while (i < src.length && src[i] !== quote) {
          if (src[i] === "\\") i++;
          i++;
        }
      } else if (ch === "/" && src[i + 1] === "/") {
        while (i < src.length && src[i] !== "\n") i++;
      } else if (ch === "/" && src[i + 1] === "*") {
        i += 2;
        while (i < src.length - 1 && !(src[i] === "*" && src[i + 1] === "/")) i++;
        i++;
      }
      i++;
    }
    ranges.push({ name: className, start: openIdx, end: i });
  }
  return ranges;
}

function findCallerAt(ranges: Array<{ name: AgentClass; start: number; end: number }>, offset: number): AgentClass | null {
  // Innermost-wins (in case of nested classes, though that's rare here).
  let best: { name: AgentClass; size: number } | null = null;
  for (const r of ranges) {
    if (offset >= r.start && offset <= r.end) {
      const size = r.end - r.start;
      if (!best || size < best.size) best = { name: r.name, size };
    }
  }
  return best?.name ?? null;
}

function findEdges(files: string[], agentClasses: Map<AgentClass, unknown>): Edge[] {
  const edges: Edge[] = [];
  const classNames = new Set(agentClasses.keys());

  for (const f of files) {
    const src = readSource(f);
    const ranges = buildClassRangeIndex(f, src, classNames);

    const recordCall = (calledClass: AgentClass, offset: number) => {
      const line = src.slice(0, offset).split("\n").length;
      const caller = findCallerAt(ranges, offset);
      if (!caller) {
        // Call is outside any agent class — likely a Worker default export or Workflow.
        // Use a synthetic node "<external>" so we still capture incoming edges.
        edges.push({ from: "<external>", to: calledClass, file: f, line });
      } else if (caller !== calledClass) {
        edges.push({ from: caller, to: calledClass, file: f, line });
      } else {
        // Self-call — usually a no-op (calling getAgentByName on yourself); still log it.
        edges.push({ from: caller, to: calledClass, file: f, line });
      }
    };

    GETAGENTBYNAME_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = GETAGENTBYNAME_RE.exec(src)) !== null) {
      const calledClass = m[1];
      if (classNames.has(calledClass)) recordCall(calledClass, m.index);
    }

    AGENTTOOL_RE.lastIndex = 0;
    while ((m = AGENTTOOL_RE.exec(src)) !== null) {
      const calledClass = m[1];
      if (classNames.has(calledClass)) recordCall(calledClass, m.index);
    }
  }

  return edges;
}

/**
 * Tarjan's SCC algorithm — finds strongly connected components. Any SCC of
 * size >1 is a cycle. A self-loop is also a cycle.
 */
function findCycles(nodes: AgentClass[], edges: Edge[]): AgentClass[][] {
  const adj = new Map<AgentClass, Set<AgentClass>>();
  for (const n of nodes) adj.set(n, new Set());
  for (const e of edges) {
    if (!adj.has(e.from)) adj.set(e.from, new Set());
    if (!adj.has(e.to)) adj.set(e.to, new Set());
    adj.get(e.from)!.add(e.to);
  }

  let index = 0;
  const indices = new Map<AgentClass, number>();
  const lowlinks = new Map<AgentClass, number>();
  const onStack = new Set<AgentClass>();
  const stack: AgentClass[] = [];
  const sccs: AgentClass[][] = [];

  const strongconnect = (v: AgentClass): void => {
    indices.set(v, index);
    lowlinks.set(v, index);
    index++;
    stack.push(v);
    onStack.add(v);

    for (const w of adj.get(v) ?? []) {
      if (!indices.has(w)) {
        strongconnect(w);
        lowlinks.set(v, Math.min(lowlinks.get(v)!, lowlinks.get(w)!));
      } else if (onStack.has(w)) {
        lowlinks.set(v, Math.min(lowlinks.get(v)!, indices.get(w)!));
      }
    }

    if (lowlinks.get(v) === indices.get(v)) {
      const scc: AgentClass[] = [];
      let w: AgentClass;
      do {
        w = stack.pop()!;
        onStack.delete(w);
        scc.push(w);
      } while (w !== v);
      sccs.push(scc);
    }
  };

  for (const v of adj.keys()) {
    if (!indices.has(v)) strongconnect(v);
  }

  // A cycle is an SCC of size >1, or a single node with a self-loop.
  return sccs.filter((scc) => scc.length > 1 || (scc.length === 1 && adj.get(scc[0])!.has(scc[0])));
}

function emitMermaid(nodes: AgentClass[], edges: Edge[]): string {
  const lines: string[] = ["graph LR"];
  for (const n of nodes) {
    lines.push(`  ${n}["${n}"]`);
  }
  // Deduplicate identical edges.
  const seen = new Set<string>();
  for (const e of edges) {
    const key = `${e.from}->${e.to}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (e.from === "<external>") {
      lines.push(`  external["(external entry)"] --> ${e.to}`);
    } else {
      lines.push(`  ${e.from} --> ${e.to}`);
    }
  }
  return lines.join("\n");
}

function main(): number {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error("Usage: npx tsx audit-topology.ts <src-dir> [<src-dir>...]");
    return 2;
  }

  const files: string[] = [];
  for (const arg of args) {
    const stat = fs.statSync(arg);
    if (stat.isDirectory()) walk(arg, files);
    else if (stat.isFile()) files.push(arg);
  }

  if (files.length === 0) {
    console.error("No source files found.");
    return 2;
  }

  const agentClasses = findAgentClasses(files);
  if (agentClasses.size === 0) {
    console.log("No agent classes found (looked for classes extending Agent / AIChatAgent / McpAgent / Think / WorkflowEntrypoint).");
    return 0;
  }

  const nodes = Array.from(agentClasses.keys()).sort();
  const edges = findEdges(files, agentClasses);

  console.log("# Multi-agent topology audit\n");
  console.log(`Source files scanned: ${files.length}`);
  console.log(`Agent classes found:  ${nodes.length}`);
  console.log(`Cross-agent calls:    ${edges.length}\n`);

  console.log("## Agent classes\n");
  for (const n of nodes) {
    const meta = agentClasses.get(n)!;
    console.log(`  ${n}  (extends ${meta.base})  — ${path.relative(".", meta.file)}:${meta.line}`);
  }

  console.log("\n## Edges\n");
  if (edges.length === 0) {
    console.log("  (none — no cross-agent calls detected)");
  } else {
    for (const e of edges) {
      console.log(`  ${e.from} -> ${e.to}    ${path.relative(".", e.file)}:${e.line}`);
    }
  }

  console.log("\n## Mermaid diagram\n");
  console.log("```mermaid");
  console.log(emitMermaid(nodes, edges));
  console.log("```\n");

  // Entry points: nodes with no incoming edges.
  const incoming = new Map<AgentClass, number>();
  for (const n of nodes) incoming.set(n, 0);
  for (const e of edges) {
    if (e.from !== "<external>") incoming.set(e.to, (incoming.get(e.to) ?? 0) + 1);
  }
  const entryPoints = nodes.filter((n) => (incoming.get(n) ?? 0) === 0);

  console.log("## Entry points (no incoming cross-agent calls)\n");
  if (entryPoints.length === 0) {
    console.log("  (none — every agent is called by at least one other agent; check your routing)");
  } else {
    for (const n of entryPoints) console.log(`  ${n}`);
  }

  // Cycle detection.
  const cycles = findCycles(nodes, edges);
  console.log("\n## Cycle check\n");
  if (cycles.length === 0) {
    console.log("  OK — topology is a DAG.\n");
    return 0;
  }
  console.log(`  FAIL — ${cycles.length} cycle(s) detected:\n`);
  for (const scc of cycles) {
    console.log(`    ${scc.join(" -> ")} -> ${scc[0]}`);
  }
  console.log("\nCycles cause DO RPC deadlocks (DOs are single-threaded). Break the cycle before deploying.");
  return 1;
}

process.exit(main());
