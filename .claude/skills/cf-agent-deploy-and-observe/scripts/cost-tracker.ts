#!/usr/bin/env -S npx ts-node
/**
 * cost-tracker.ts — roll up daily cost per agent from Cloudflare
 * Workers Analytics Engine SQL + AI Gateway logs.
 *
 * Reads:
 *   - Workers Analytics Engine SQL endpoint (per-agent metrics writes
 *     done via env.METRICS.writeDataPoint). Weights by _sample_interval
 *     to undo Cloudflare's automatic sampling. Costs $1.50/M reads.
 *   - AI Gateway logs API for per-LLM-call cost attribution.
 *
 * Aggregates:
 *   - per-day total cost
 *   - per-agent (indexed by AE blob1, e.g. agent_id) breakdown
 *   - top-N most expensive runs (by AIG cost field)
 *   - YoY-style: cost vs prior 7-day average
 *
 * Outputs:
 *   - JSON to stdout (machine-readable, for cron pipelines)
 *   - Markdown to stderr (Slack-friendly when --format markdown)
 *
 * Usage:
 *   ts-node cost-tracker.ts \
 *     --account-id $CF_ACCOUNT_ID \
 *     --api-token $CF_API_TOKEN \
 *     --aig-id ai-ideator \
 *     --dataset ai_ideator_metrics \
 *     --since 1d \
 *     [--format markdown]
 */

interface Args {
  accountId: string;
  apiToken: string;
  aigId: string;
  dataset: string;
  since: string;
  format: "json" | "markdown" | "both";
}

interface AERunRow {
  day: string;       // YYYY-MM-DD
  agent_id: string;
  cost_usd: number;
  runs: number;
  tokens: number;
}

interface AIGLogRow {
  id: string;
  created_at: string;
  model: string;
  cost: number;
  metadata?: Record<string, string>;
}

interface CostSummary {
  since: string;
  total_runs: number;
  total_cost_usd: number;
  by_day: Record<string, number>;
  by_agent: Record<string, { runs: number; cost_usd: number; tokens: number }>;
  top_runs: Array<{
    id: string;
    agent_id: string;
    model: string;
    cost_usd: number;
    created_at: string;
  }>;
  prior_week_avg_per_day: number | null;
  delta_vs_prior_week: number | null;
}

// ─── argv ──────────────────────────────────────────────────────────

function parseArgs(): Args {
  const out: Partial<Args> = { format: "json" };
  const a = process.argv.slice(2);
  for (let i = 0; i < a.length; i++) {
    const k = a[i];
    const v = a[i + 1];
    switch (k) {
      case "--account-id": out.accountId = v; i++; break;
      case "--api-token":  out.apiToken = v; i++; break;
      case "--aig-id":     out.aigId = v; i++; break;
      case "--dataset":    out.dataset = v; i++; break;
      case "--since":      out.since = v; i++; break;
      case "--format":     out.format = v as Args["format"]; i++; break;
      case "-h": case "--help":
        console.error(usage()); process.exit(0);
      default: break;
    }
  }
  for (const k of ["accountId", "apiToken", "aigId", "dataset", "since"]) {
    if (!(out as Record<string, unknown>)[k]) {
      console.error(`missing required flag: --${k.replace(/[A-Z]/g, c => "-" + c.toLowerCase())}`);
      console.error(usage());
      process.exit(2);
    }
  }
  return out as Args;
}

function usage(): string {
  return `cost-tracker.ts --account-id <id> --api-token <token> --aig-id <gateway-id> --dataset <ae-dataset> --since <1d|7d|...> [--format json|markdown|both]`;
}

// ─── since helpers ────────────────────────────────────────────────

function sinceToInterval(since: string): string {
  const m = since.match(/^(\d+)([dhm])$/);
  if (!m) throw new Error(`bad --since: ${since} (use 1d, 6h, 30m)`);
  const [, n, unit] = m;
  return ({ d: "DAY", h: "HOUR", m: "MINUTE" } as const)[unit as "d" | "h" | "m"]
    ? `INTERVAL '${n}' ${({ d: "DAY", h: "HOUR", m: "MINUTE" } as const)[unit as "d" | "h" | "m"]}`
    : (() => { throw new Error(`bad unit ${unit}`); })();
}

function sinceISO(since: string): string {
  const m = since.match(/^(\d+)([dhm])$/)!;
  const n = parseInt(m[1], 10);
  const ms = ({ d: 86400_000, h: 3600_000, m: 60_000 } as const)[m[2] as "d" | "h" | "m"];
  return new Date(Date.now() - n * ms).toISOString();
}

// ─── Analytics Engine SQL ──────────────────────────────────────────

async function aeQuery(args: Args, sql: string): Promise<unknown[]> {
  const url = `https://api.cloudflare.com/client/v4/accounts/${args.accountId}/analytics_engine/sql`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${args.apiToken}`,
      "Content-Type": "text/plain",
    },
    body: sql,
  });
  if (!res.ok) {
    throw new Error(`AE SQL ${res.status}: ${await res.text()}`);
  }
  const body = (await res.json()) as { data?: unknown[]; error?: string };
  if (!body.data) {
    throw new Error(`AE SQL: no data field — ${JSON.stringify(body)}`);
  }
  return body.data;
}

async function getAERuns(args: Args): Promise<AERunRow[]> {
  // Convention: writeDataPoint with
  //   indexes = [agent_id]
  //   blobs   = [agent_id, model, outcome, ...]
  //   doubles = [cost_usd, tokens, duration_ms, ...]
  const sql = `
    SELECT
      formatDateTime(timestamp, '%F') AS day,
      blob1                         AS agent_id,
      SUM(double1 * _sample_interval) AS cost_usd,
      SUM(_sample_interval)           AS runs,
      SUM(double2 * _sample_interval) AS tokens
    FROM ${args.dataset}
    WHERE timestamp > NOW() - ${sinceToInterval(args.since)}
    GROUP BY day, agent_id
    ORDER BY day DESC, cost_usd DESC
    FORMAT JSON
  `;
  const rows = (await aeQuery(args, sql)) as AERunRow[];
  return rows.map(r => ({
    day: r.day,
    agent_id: r.agent_id || "<unknown>",
    cost_usd: Number(r.cost_usd) || 0,
    runs: Number(r.runs) || 0,
    tokens: Number(r.tokens) || 0,
  }));
}

async function getAEPriorWeekAvg(args: Args): Promise<number | null> {
  // Daily cost averaged over the prior 7-day window before --since.
  const sql = `
    SELECT
      AVG(daily_cost) AS avg_cost_usd
    FROM (
      SELECT formatDateTime(timestamp, '%F') AS day,
             SUM(double1 * _sample_interval) AS daily_cost
      FROM ${args.dataset}
      WHERE timestamp BETWEEN
        NOW() - ${sinceToInterval(args.since)} - INTERVAL '7' DAY
        AND NOW() - ${sinceToInterval(args.since)}
      GROUP BY day
    )
    FORMAT JSON
  `;
  try {
    const rows = (await aeQuery(args, sql)) as Array<{ avg_cost_usd: number }>;
    if (!rows.length) return null;
    return Number(rows[0].avg_cost_usd) || null;
  } catch {
    return null;
  }
}

// ─── AI Gateway logs ──────────────────────────────────────────────

async function getAIGLogs(args: Args): Promise<AIGLogRow[]> {
  const sinceIso = sinceISO(args.since);
  const url = `https://api.cloudflare.com/client/v4/accounts/${args.accountId}/ai-gateway/gateways/${args.aigId}/logs?per_page=100&start_date=${encodeURIComponent(sinceIso)}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${args.apiToken}` },
  });
  if (!res.ok) {
    process.stderr.write(`WARN: AIG logs ${res.status}: ${await res.text()}\n`);
    return [];
  }
  const body = (await res.json()) as { result?: AIGLogRow[] };
  return (body.result || []).filter(r => typeof r.cost === "number");
}

// ─── aggregation ───────────────────────────────────────────────────

function summarize(
  args: Args,
  ae: AERunRow[],
  aig: AIGLogRow[],
  priorAvg: number | null,
): CostSummary {
  const byDay: Record<string, number> = {};
  const byAgent: Record<string, { runs: number; cost_usd: number; tokens: number }> = {};
  let totalCost = 0;
  let totalRuns = 0;

  for (const r of ae) {
    byDay[r.day] = (byDay[r.day] || 0) + r.cost_usd;
    if (!byAgent[r.agent_id]) byAgent[r.agent_id] = { runs: 0, cost_usd: 0, tokens: 0 };
    byAgent[r.agent_id].runs += r.runs;
    byAgent[r.agent_id].cost_usd += r.cost_usd;
    byAgent[r.agent_id].tokens += r.tokens;
    totalCost += r.cost_usd;
    totalRuns += r.runs;
  }

  // Top runs from AIG (most expensive single LLM call).
  const sortedAig = [...aig].sort((a, b) => b.cost - a.cost).slice(0, 10);
  const topRuns = sortedAig.map(r => ({
    id: r.id,
    agent_id: (r.metadata && (r.metadata.agent_id || r.metadata.run_id)) || "<unknown>",
    model: r.model,
    cost_usd: r.cost,
    created_at: r.created_at,
  }));

  const todayCost = Object.entries(byDay).reduce((a, [_, v]) => a + v, 0)
    / Math.max(1, Object.keys(byDay).length);

  return {
    since: args.since,
    total_runs: Math.round(totalRuns),
    total_cost_usd: round(totalCost),
    by_day: Object.fromEntries(Object.entries(byDay).map(([k, v]) => [k, round(v)])),
    by_agent: Object.fromEntries(Object.entries(byAgent).map(([k, v]) => [k, {
      runs: Math.round(v.runs),
      cost_usd: round(v.cost_usd),
      tokens: Math.round(v.tokens),
    }])),
    top_runs: topRuns,
    prior_week_avg_per_day: priorAvg !== null ? round(priorAvg) : null,
    delta_vs_prior_week: priorAvg ? round((todayCost - priorAvg) / priorAvg) : null,
  };
}

function round(n: number): number {
  return Math.round(n * 10000) / 10000;
}

// ─── markdown ──────────────────────────────────────────────────────

function toMarkdown(s: CostSummary): string {
  const lines: string[] = [];
  lines.push(`*Agent cost rollup (last ${s.since})*`);
  lines.push(`Total runs: ${s.total_runs}    Total cost: \`$${s.total_cost_usd}\``);
  if (s.delta_vs_prior_week !== null) {
    const arrow = s.delta_vs_prior_week >= 0 ? "↑" : "↓";
    const pct = Math.abs(s.delta_vs_prior_week * 100).toFixed(1);
    const flag = Math.abs(s.delta_vs_prior_week) > 0.5 ? " :warning:" : "";
    lines.push(`vs prior 7-day avg ($${s.prior_week_avg_per_day}/day): ${arrow} ${pct}%${flag}`);
  }
  lines.push("");

  lines.push("*By day*");
  for (const [day, cost] of Object.entries(s.by_day).sort()) {
    lines.push(`  ${day}: \`$${cost}\``);
  }
  lines.push("");

  lines.push("*By agent (top 5 by cost)*");
  const agentsSorted = Object.entries(s.by_agent)
    .sort(([, a], [, b]) => b.cost_usd - a.cost_usd)
    .slice(0, 5);
  for (const [aid, info] of agentsSorted) {
    lines.push(`  ${aid}: \`$${info.cost_usd}\` (${info.runs} runs, ${info.tokens} tokens)`);
  }
  lines.push("");

  if (s.top_runs.length) {
    lines.push("*Top 10 most expensive LLM calls (from AI Gateway)*");
    for (const r of s.top_runs) {
      lines.push(`  \`$${r.cost_usd.toFixed(4)}\` ${r.model} ${r.agent_id} ${r.created_at}`);
    }
  }

  return lines.join("\n");
}

// ─── main ──────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs();
  const [ae, aig, priorAvg] = await Promise.all([
    getAERuns(args),
    getAIGLogs(args),
    getAEPriorWeekAvg(args),
  ]);
  const summary = summarize(args, ae, aig, priorAvg);

  if (args.format === "json" || args.format === "both") {
    process.stdout.write(JSON.stringify(summary, null, 2) + "\n");
  }
  if (args.format === "markdown" || args.format === "both") {
    process.stderr.write(toMarkdown(summary) + "\n");
  }
}

main().catch(e => {
  process.stderr.write(`ERROR: ${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
});
