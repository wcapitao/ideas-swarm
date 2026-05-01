#!/usr/bin/env -S npx tsx
/**
 * schedule-introspect.ts
 *
 * Lists every pending schedule on a deployed Cloudflare Agent, in
 * order of next fire time. Pretty-prints to the terminal.
 *
 * Two connection modes:
 *   1. AgentClient over WebSocket (preferred — uses callable RPC)
 *   2. Debug HTTP route on the agent that exposes `getSchedules()` as
 *      JSON. The agent must implement this route; see the recipe at
 *      the bottom of this file.
 *
 * Usage:
 *   tsx schedule-introspect.ts <agent-name> \
 *       [--host my-agent.workers.dev] \
 *       [--mode ws|http] \
 *       [--filter cron|delayed|scheduled|interval] \
 *       [--token <bearer>]
 *
 * Examples:
 *   tsx schedule-introspect.ts alice
 *   tsx schedule-introspect.ts alice --mode http --host my-agent.example.com
 *   tsx schedule-introspect.ts alice --filter cron
 */

type ScheduleType = "scheduled" | "delayed" | "cron" | "interval";

interface Schedule<T = unknown> {
  id: string;
  callback: string;
  payload: T;
  time: number; // unix seconds
  type: ScheduleType;
  cron?: string;
  delayInSeconds?: number;
  intervalSeconds?: number;
}

interface Args {
  agentName: string;
  host: string;
  mode: "ws" | "http";
  filter?: ScheduleType;
  token?: string;
}

function parseArgs(argv: string[]): Args {
  const [, , agentName, ...rest] = argv;
  if (!agentName || agentName.startsWith("--")) {
    console.error(
      "Usage: schedule-introspect.ts <agent-name> [--host H] [--mode ws|http] [--filter T] [--token TOK]",
    );
    process.exit(2);
  }

  const opts: Record<string, string> = {};
  for (let i = 0; i < rest.length; i += 2) {
    const k = rest[i]?.replace(/^--/, "");
    const v = rest[i + 1];
    if (!k || v === undefined) continue;
    opts[k] = v;
  }

  const host = opts.host ?? process.env.AGENT_HOST ?? "localhost:8787";
  const mode = (opts.mode ?? "ws") as "ws" | "http";
  const token = opts.token ?? process.env.AGENT_TOKEN;
  const filter = opts.filter as ScheduleType | undefined;
  return { agentName, host, mode, filter, token };
}

async function fetchHttp(args: Args): Promise<Schedule[]> {
  const proto = args.host.includes("localhost") ? "http" : "https";
  const url = `${proto}://${args.host}/agent/${encodeURIComponent(args.agentName)}/__schedules`;
  const headers: Record<string, string> = { Accept: "application/json" };
  if (args.token) headers["Authorization"] = `Bearer ${args.token}`;
  const res = await fetch(url, { headers });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} from ${url}: ${await res.text()}`);
  }
  const body = (await res.json()) as { schedules: Schedule[] } | Schedule[];
  return Array.isArray(body) ? body : body.schedules;
}

async function fetchWs(args: Args): Promise<Schedule[]> {
  // Lazily import so users without `agents` installed can still use HTTP mode.
  let AgentClient: any;
  try {
    ({ AgentClient } = await import("agents/client"));
  } catch {
    throw new Error(
      "Could not import 'agents/client'. Install `agents` or use --mode http.",
    );
  }
  const proto = args.host.includes("localhost") ? "ws" : "wss";
  const client = new AgentClient({
    agent: "agent", // namespace; adjust if your routing differs
    name: args.agentName,
    host: `${proto}://${args.host}`,
    headers: args.token ? { Authorization: `Bearer ${args.token}` } : undefined,
  });
  await client.ready;
  // Calls a `@callable() listSchedules()` method on the agent.
  // Implement on the agent: `@callable() listSchedules() { return this.getSchedules(); }`
  const out = (await client.call("listSchedules")) as Schedule[];
  await client.close();
  return out;
}

function fmtTime(unixSec: number): string {
  const d = new Date(unixSec * 1000);
  const now = Date.now();
  const deltaMs = unixSec * 1000 - now;
  const sign = deltaMs >= 0 ? "in" : "ago";
  const absSec = Math.abs(deltaMs) / 1000;
  let rel: string;
  if (absSec < 60) rel = `${absSec.toFixed(0)}s`;
  else if (absSec < 3600) rel = `${(absSec / 60).toFixed(1)}m`;
  else if (absSec < 86400) rel = `${(absSec / 3600).toFixed(1)}h`;
  else rel = `${(absSec / 86400).toFixed(1)}d`;
  return `${d.toISOString()}  (${sign} ${rel})`;
}

function fmtPayload(p: unknown): string {
  try {
    const s = JSON.stringify(p);
    return s && s.length > 60 ? s.slice(0, 57) + "..." : s ?? "—";
  } catch {
    return "<unserializable>";
  }
}

function fmtTrigger(s: Schedule): string {
  switch (s.type) {
    case "cron":
      return `cron(${s.cron})`;
    case "delayed":
      return `delay(${s.delayInSeconds}s)`;
    case "interval":
      return `every(${s.intervalSeconds}s)`;
    case "scheduled":
      return `at(date)`;
    default:
      return s.type;
  }
}

function pad(s: string, n: number): string {
  return s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length);
}

function printTable(schedules: Schedule[]) {
  if (schedules.length === 0) {
    console.log("(no schedules)");
    return;
  }
  schedules.sort((a, b) => a.time - b.time);
  const header = [
    pad("ID", 18),
    pad("TYPE", 18),
    pad("CALLBACK", 22),
    pad("NEXT FIRE", 38),
    "PAYLOAD",
  ].join("  ");
  console.log(header);
  console.log("-".repeat(header.length));
  for (const s of schedules) {
    console.log(
      [
        pad(s.id.slice(0, 18), 18),
        pad(fmtTrigger(s), 18),
        pad(s.callback, 22),
        pad(fmtTime(s.time), 38),
        fmtPayload(s.payload),
      ].join("  "),
    );
  }
  console.log("-".repeat(header.length));
  console.log(`${schedules.length} schedule(s)`);
}

async function main() {
  const args = parseArgs(process.argv);
  const schedules =
    args.mode === "http" ? await fetchHttp(args) : await fetchWs(args);
  const filtered = args.filter
    ? schedules.filter((s) => s.type === args.filter)
    : schedules;
  printTable(filtered);
}

main().catch((err) => {
  console.error("schedule-introspect failed:", err?.message ?? err);
  process.exit(1);
});

/* ============================================================
 * Recipe — adding the debug HTTP route to your Agent
 * ============================================================
 *
 * In your Agent class:
 *
 *   class MyAgent extends Agent<Env, State> {
 *     async onRequest(req: Request) {
 *       const url = new URL(req.url);
 *       if (url.pathname.endsWith("/__schedules")) {
 *         // Optional bearer-token guard
 *         const auth = req.headers.get("Authorization");
 *         if (this.env.SCHEDULE_TOKEN &&
 *             auth !== `Bearer ${this.env.SCHEDULE_TOKEN}`) {
 *           return new Response("unauthorized", { status: 401 });
 *         }
 *         const schedules = this.getSchedules();
 *         return Response.json({ schedules });
 *       }
 *       return super.onRequest(req);
 *     }
 *   }
 *
 * Or, for the WebSocket path, add a callable:
 *
 *   import { callable } from "agents";
 *   class MyAgent extends Agent<Env, State> {
 *     @callable()
 *     listSchedules() {
 *       return this.getSchedules();
 *     }
 *   }
 *
 * Then run:
 *   tsx schedule-introspect.ts <agent-name> --host my-agent.example.com \
 *        --token "$SCHEDULE_TOKEN"
 */
