#!/usr/bin/env -S bun run
/**
 * ws-replay.ts — replay a recorded WebSocket session against a deployed
 * Cloudflare Agent and diff the captured server responses against a
 * golden snapshot.
 *
 * Smoke regression for chat flows: lock down the protocol envelope,
 * the streaming-chunk pattern, and the final message shape so a
 * future refactor that subtly breaks reconnection or chunk ordering
 * fails the test.
 *
 * Usage:
 *   bun run scripts/ws-replay.ts \
 *     --host my-worker.workers.dev \
 *     --agent ChatAgent \
 *     --name session-test \
 *     --session ./fixtures/golden-session.json \
 *     --snapshot ./fixtures/golden-snapshot.json \
 *     [--token <bearer>]                # appended as ?token=...
 *     [--scheme wss|ws]                  # default wss
 *     [--basePath agents]                # default agents
 *     [--timeout-ms 30000]
 *     [--update]                         # overwrite snapshot from this run
 *     [--ignore-fields ts,id]            # comma-list of JSON paths to redact before diffing
 *
 * Session file format (JSON):
 *   {
 *     "steps": [
 *       { "kind": "send",  "data": { "type": "...", "..." } },
 *       { "kind": "send",  "data": "raw string" },
 *       { "kind": "wait",  "ms": 100 },
 *       { "kind": "wait-for", "match": { "type": "rpc-response", "id": "*" }, "timeoutMs": 5000 }
 *     ]
 *   }
 *
 * Snapshot file format (JSON):
 *   {
 *     "received": [
 *       { "data": <parsed-or-string>, "atMs": 0 },
 *       ...
 *     ]
 *   }
 *
 * Exit codes:
 *   0  — replay matched snapshot (or --update succeeded)
 *   1  — replay diverged from snapshot
 *   2  — config error (bad args, missing file, can't connect)
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

// --- CLI parsing ---------------------------------------------------------

type Args = {
  host: string;
  agent: string;
  name: string;
  session: string;
  snapshot: string;
  token?: string;
  scheme: "ws" | "wss";
  basePath: string;
  timeoutMs: number;
  update: boolean;
  ignoreFields: string[];
};

function parseArgs(argv: string[]): Args {
  const flags: Record<string, string | boolean> = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) {
      flags[key] = true;
    } else {
      flags[key] = next;
      i++;
    }
  }

  const required = ["host", "agent", "name", "session", "snapshot"] as const;
  for (const k of required) {
    if (typeof flags[k] !== "string") {
      console.error(`error: --${k} is required`);
      process.exit(2);
    }
  }

  return {
    host: flags.host as string,
    agent: flags.agent as string,
    name: flags.name as string,
    session: flags.session as string,
    snapshot: flags.snapshot as string,
    token: typeof flags.token === "string" ? flags.token : undefined,
    scheme: (flags.scheme === "ws" ? "ws" : "wss") as "ws" | "wss",
    basePath: typeof flags.basePath === "string" ? flags.basePath : "agents",
    timeoutMs: Number(flags["timeout-ms"] ?? 30000),
    update: flags.update === true,
    ignoreFields:
      typeof flags["ignore-fields"] === "string"
        ? (flags["ignore-fields"] as string).split(",").map((s) => s.trim()).filter(Boolean)
        : [],
  };
}

// --- Session + snapshot types -------------------------------------------

type SendStep = { kind: "send"; data: unknown };
type WaitStep = { kind: "wait"; ms: number };
type WaitForStep = {
  kind: "wait-for";
  match: Record<string, unknown>;
  timeoutMs?: number;
};
type Step = SendStep | WaitStep | WaitForStep;
type Session = { steps: Step[] };

type Received = { data: unknown; atMs: number };
type Snapshot = { received: Received[] };

// --- Match helper (server payload vs match pattern, with "*" wildcards) -

function matches(payload: unknown, pattern: unknown): boolean {
  if (pattern === "*") return true;
  if (typeof pattern !== "object" || pattern === null) return payload === pattern;
  if (typeof payload !== "object" || payload === null) return false;
  for (const [k, v] of Object.entries(pattern)) {
    if (!matches((payload as Record<string, unknown>)[k], v)) return false;
  }
  return true;
}

// --- Field redaction (drop volatile fields before snapshot diff) --------

function redact(obj: unknown, paths: string[]): unknown {
  if (paths.length === 0) return obj;
  if (Array.isArray(obj)) return obj.map((x) => redact(x, paths));
  if (typeof obj !== "object" || obj === null) return obj;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (paths.includes(k)) continue;
    out[k] = redact(v, paths);
  }
  return out;
}

// --- Connect + replay ---------------------------------------------------

async function replay(args: Args): Promise<Snapshot> {
  const session: Session = JSON.parse(readFileSync(resolve(args.session), "utf8"));

  const kebab = args.agent.replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase();
  const qs = args.token ? `?token=${encodeURIComponent(args.token)}` : "";
  const url = `${args.scheme}://${args.host}/${args.basePath}/${kebab}/${encodeURIComponent(args.name)}${qs}`;

  console.error(`[ws-replay] connecting -> ${url}`);

  const ws = new WebSocket(url);
  const received: Received[] = [];
  const startedAt = Date.now();

  let openResolve: () => void;
  let openReject: (e: unknown) => void;
  const opened = new Promise<void>((res, rej) => {
    openResolve = res;
    openReject = rej;
  });

  ws.addEventListener("open", () => openResolve());
  ws.addEventListener("error", (e) => openReject(e));
  ws.addEventListener("message", (ev) => {
    let parsed: unknown = ev.data;
    if (typeof ev.data === "string") {
      try {
        parsed = JSON.parse(ev.data);
      } catch {
        parsed = ev.data;
      }
    }
    received.push({ data: parsed, atMs: Date.now() - startedAt });
  });

  const closed = new Promise<void>((res) => ws.addEventListener("close", () => res()));

  const timeout = setTimeout(() => {
    console.error("[ws-replay] global timeout — closing");
    try {
      ws.close();
    } catch {}
  }, args.timeoutMs);

  try {
    await opened;
    console.error("[ws-replay] connected");

    for (const step of session.steps) {
      if (step.kind === "send") {
        const payload = typeof step.data === "string" ? step.data : JSON.stringify(step.data);
        ws.send(payload);
      } else if (step.kind === "wait") {
        await new Promise((r) => setTimeout(r, step.ms));
      } else if (step.kind === "wait-for") {
        const deadline = Date.now() + (step.timeoutMs ?? 5000);
        let satisfied = false;
        while (Date.now() < deadline) {
          if (received.some((r) => matches(r.data, step.match))) {
            satisfied = true;
            break;
          }
          await new Promise((r) => setTimeout(r, 50));
        }
        if (!satisfied) {
          throw new Error(`wait-for timed out: ${JSON.stringify(step.match)}`);
        }
      }
    }

    // Drain anything still arriving (e.g. trailing chunks of a stream).
    await new Promise((r) => setTimeout(r, 250));
    ws.close(1000, "replay complete");
    await closed;
  } finally {
    clearTimeout(timeout);
  }

  return { received };
}

// --- Diff snapshots -----------------------------------------------------

function diff(actual: Snapshot, expected: Snapshot, ignoreFields: string[]): string[] {
  const errs: string[] = [];
  const a = actual.received.map((r) => redact(r.data, ignoreFields));
  const e = expected.received.map((r) => redact(r.data, ignoreFields));
  if (a.length !== e.length) {
    errs.push(`length mismatch: got ${a.length}, expected ${e.length}`);
  }
  const n = Math.min(a.length, e.length);
  for (let i = 0; i < n; i++) {
    const aj = JSON.stringify(a[i]);
    const ej = JSON.stringify(e[i]);
    if (aj !== ej) {
      errs.push(`message[${i}] differs:\n  got      ${aj}\n  expected ${ej}`);
    }
  }
  for (let i = n; i < a.length; i++) errs.push(`unexpected message[${i}]: ${JSON.stringify(a[i])}`);
  for (let i = n; i < e.length; i++) errs.push(`missing message[${i}]: expected ${JSON.stringify(e[i])}`);
  return errs;
}

// --- Main ---------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv);

  let snapshot: Snapshot;
  try {
    snapshot = await replay(args);
  } catch (e) {
    console.error(`[ws-replay] replay failed: ${(e as Error).message}`);
    process.exit(2);
  }

  const snapshotPath = resolve(args.snapshot);

  if (args.update || !existsSync(snapshotPath)) {
    writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2));
    console.error(`[ws-replay] wrote snapshot -> ${snapshotPath} (${snapshot.received.length} messages)`);
    process.exit(0);
  }

  const expected: Snapshot = JSON.parse(readFileSync(snapshotPath, "utf8"));
  const errs = diff(snapshot, expected, args.ignoreFields);

  if (errs.length === 0) {
    console.error(`[ws-replay] OK — ${snapshot.received.length} messages match snapshot`);
    process.exit(0);
  }

  console.error(`[ws-replay] FAIL — ${errs.length} divergence(s):`);
  for (const err of errs) console.error("  " + err);
  console.error("\nrun with --update to accept the new output as the snapshot.");
  process.exit(1);
}

main().catch((e) => {
  console.error(`[ws-replay] fatal: ${(e as Error).stack ?? e}`);
  process.exit(2);
});
