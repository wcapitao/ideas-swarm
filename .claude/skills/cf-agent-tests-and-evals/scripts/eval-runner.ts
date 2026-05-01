/**
 * eval-runner.ts — the canonical eval harness for a Cloudflare Agent.
 *
 * Run from the project root:
 *   npx tsx .claude/skills/cf-agent-tests-and-evals/scripts/eval-runner.ts \
 *     --cases evals/cases \
 *     --out evals/reports/$(date +%Y-%m-%d) \
 *     --judge anthropic-via-aig \
 *     --baseline evals/baseline/snapshots
 *
 * Modes:
 *   - first-time: produce snapshots, save under <baseline>. Manual review gate.
 *   - regression: diff vs baseline. Deterministic asserts hard-fail; rubric scores require >=4/5.
 *
 * Output: JUnit XML + HTML report with diff vs last green run, cost rollup,
 * regression flag.
 *
 * This is a stub structure — fill in the SDK calls for your environment.
 */

import { readFile, readdir, writeFile, mkdir } from "node:fs/promises";
import { join, basename } from "node:path";
import { judgeWithRubric, type JudgeResult } from "./eval-judge";

interface Case {
  id: string;
  description?: string;
  input: Array<{ role: "user" | "assistant" | "system"; content: string }>;
  expect: {
    toolCalls?: string[];               // tool names that MUST be invoked
    toolCallsForbidden?: string[];      // tool names that MUST NOT be invoked
    finalContains?: string[];           // strings the final message must contain
    finalNotContains?: string[];
    rubric?: string[];                  // judge rubric IDs (coherence, safety, etc.)
    minRubricScore?: number;            // default 4 (out of 5)
    maxCostUsd?: number;                // default 0.10
    maxLatencyMs?: number;              // default 30_000
  };
}

interface RunResult {
  caseId: string;
  pass: boolean;
  failures: string[];
  rubricScores: Record<string, number>;
  costUsd: number;
  latencyMs: number;
  toolCallsObserved: string[];
  finalText: string;
}

async function loadCases(dir: string): Promise<Case[]> {
  const files = (await readdir(dir)).filter(f => f.endsWith(".jsonl"));
  const cases: Case[] = [];
  for (const f of files) {
    const lines = (await readFile(join(dir, f), "utf8")).split("\n").filter(Boolean);
    for (const line of lines) cases.push(JSON.parse(line));
  }
  return cases;
}

async function runOneCase(c: Case): Promise<RunResult> {
  const failures: string[] = [];
  const rubricScores: Record<string, number> = {};
  const t0 = Date.now();
  let costUsd = 0;
  const toolCallsObserved: string[] = [];
  let finalText = "";

  try {
    // --- Replace this block with your agent driver ---
    // Example:
    //   const { run } = await import("../../../../agent/src/test-driver");
    //   const out = await run(c.input, { onToolCall: (n) => toolCallsObserved.push(n) });
    //   finalText = out.finalText;
    //   costUsd = out.costUsd;
    // -------------------------------------------------
    const out = await runAgentForCase(c);
    finalText = out.finalText;
    costUsd = out.costUsd;
    toolCallsObserved.push(...out.toolCallsObserved);
  } catch (e) {
    failures.push(`agent threw: ${(e as Error).message}`);
    return {
      caseId: c.id, pass: false, failures, rubricScores,
      costUsd, latencyMs: Date.now() - t0, toolCallsObserved, finalText
    };
  }

  // Deterministic assertions
  for (const t of c.expect.toolCalls ?? []) {
    if (!toolCallsObserved.includes(t)) failures.push(`missing tool call: ${t}`);
  }
  for (const t of c.expect.toolCallsForbidden ?? []) {
    if (toolCallsObserved.includes(t)) failures.push(`forbidden tool called: ${t}`);
  }
  for (const s of c.expect.finalContains ?? []) {
    if (!finalText.includes(s)) failures.push(`final missing substring: ${s}`);
  }
  for (const s of c.expect.finalNotContains ?? []) {
    if (finalText.includes(s)) failures.push(`final contains forbidden substring: ${s}`);
  }
  if (c.expect.maxCostUsd !== undefined && costUsd > c.expect.maxCostUsd) {
    failures.push(`cost ${costUsd.toFixed(4)} > cap ${c.expect.maxCostUsd}`);
  }
  const latencyMs = Date.now() - t0;
  if (c.expect.maxLatencyMs !== undefined && latencyMs > c.expect.maxLatencyMs) {
    failures.push(`latency ${latencyMs}ms > cap ${c.expect.maxLatencyMs}ms`);
  }

  // Judge-graded assertions
  const minScore = c.expect.minRubricScore ?? 4;
  for (const rubricId of c.expect.rubric ?? []) {
    const r: JudgeResult = await judgeWithRubric(rubricId, {
      input: c.input, finalText, toolCallsObserved
    });
    rubricScores[rubricId] = r.score;
    if (r.score < minScore) {
      failures.push(`rubric ${rubricId} = ${r.score}/5 (< ${minScore}). reason: ${r.reason}`);
    }
  }

  return {
    caseId: c.id,
    pass: failures.length === 0,
    failures, rubricScores, costUsd, latencyMs,
    toolCallsObserved, finalText
  };
}

// Stub — replace with your agent driver
async function runAgentForCase(_c: Case): Promise<{
  finalText: string; costUsd: number; toolCallsObserved: string[];
}> {
  throw new Error("runAgentForCase: implement against your test driver");
}

function junitXml(results: RunResult[]): string {
  const passed = results.filter(r => r.pass).length;
  const failed = results.length - passed;
  const cases = results.map(r => `
    <testcase classname="agent.evals" name="${r.caseId}" time="${(r.latencyMs / 1000).toFixed(3)}">
      ${r.pass ? "" : `<failure message="${r.failures.join("; ").replace(/&/g, "&amp;").replace(/"/g, "&quot;")}"/>`}
    </testcase>`).join("");
  return `<?xml version="1.0" encoding="UTF-8"?>
<testsuite name="agent-evals" tests="${results.length}" failures="${failed}" errors="0" skipped="0">
${cases}
</testsuite>`;
}

async function main() {
  const args = Object.fromEntries(
    process.argv.slice(2).reduce<Array<[string, string]>>((acc, _, i, a) => {
      if (a[i].startsWith("--")) acc.push([a[i].slice(2), a[i + 1] ?? ""]);
      return acc;
    }, [])
  );
  const casesDir = args.cases ?? "evals/cases";
  const outDir = args.out ?? "evals/reports/latest";

  const cases = await loadCases(casesDir);
  console.log(`loaded ${cases.length} cases from ${casesDir}`);

  const results: RunResult[] = [];
  for (const c of cases) {
    process.stdout.write(`  ${c.id} ... `);
    const r = await runOneCase(c);
    results.push(r);
    console.log(r.pass ? "PASS" : `FAIL (${r.failures.join("; ")})`);
  }

  await mkdir(outDir, { recursive: true });
  await writeFile(join(outDir, "junit.xml"), junitXml(results));
  await writeFile(join(outDir, "results.json"), JSON.stringify(results, null, 2));
  const totalCost = results.reduce((s, r) => s + r.costUsd, 0);
  const passed = results.filter(r => r.pass).length;
  console.log(`\n${passed}/${results.length} passed, total cost $${totalCost.toFixed(4)}`);
  process.exit(passed === results.length ? 0 : 1);
}

if (require.main === module) main();
