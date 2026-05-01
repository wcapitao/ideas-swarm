/**
 * eval-judge.ts — judge model for LLM-in-the-loop evals.
 *
 * Default: Anthropic via AI Gateway with structured tool-use output.
 * Cheaper tier: Workers AI `@cf/meta/llama-3.1-8b-instruct`.
 *
 * Rubrics live in evals/rubrics/<id>.md. Each rubric file contains:
 *   - The judge's role (1-2 sentences).
 *   - The 1-5 scoring scale with anchor descriptions.
 *   - Any forbidden patterns to flag.
 *
 * Usage:
 *   const r = await judgeWithRubric("coherence", { input, finalText, toolCallsObserved });
 *   // r.score: 1-5, r.reason: free-text justification
 */

import Anthropic from "@anthropic-ai/sdk";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export interface JudgeInput {
  input: Array<{ role: string; content: string }>;
  finalText: string;
  toolCallsObserved: string[];
}

export interface JudgeResult {
  score: number;        // 1-5 integer
  reason: string;       // <= 200 chars
  pass: boolean;        // score >= 4
}

const JUDGE_TOOL = {
  name: "score",
  description: "Score the agent's response per the rubric.",
  input_schema: {
    type: "object" as const,
    properties: {
      score: {
        type: "integer",
        enum: [1, 2, 3, 4, 5],
        description: "Score per the rubric anchor descriptions"
      },
      reason: {
        type: "string",
        description: "One-sentence justification, <=200 chars"
      }
    },
    required: ["score", "reason"]
  }
};

let cachedClient: Anthropic | null = null;
function client(): Anthropic {
  if (cachedClient) return cachedClient;
  const accountId = process.env.CF_ACCOUNT_ID;
  const gw = process.env.CF_AIG_NAME ?? "default";
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!accountId || !apiKey) {
    throw new Error("Set CF_ACCOUNT_ID, CF_AIG_NAME, ANTHROPIC_API_KEY");
  }
  cachedClient = new Anthropic({
    baseURL: `https://gateway.ai.cloudflare.com/v1/${accountId}/${gw}/anthropic`,
    apiKey,
    defaultHeaders: {
      "cf-aig-cache-ttl": "0",                                  // judge calls should not be cached
      "cf-aig-metadata": JSON.stringify({ purpose: "eval-judge" })
    }
  });
  return cachedClient;
}

async function loadRubric(id: string): Promise<string> {
  const path = join(process.cwd(), "evals", "rubrics", `${id}.md`);
  return readFile(path, "utf8");
}

export async function judgeWithRubric(
  rubricId: string,
  ctx: JudgeInput
): Promise<JudgeResult> {
  const rubric = await loadRubric(rubricId);
  const transcript = ctx.input
    .map(m => `${m.role.toUpperCase()}: ${m.content}`)
    .concat([`AGENT FINAL: ${ctx.finalText}`])
    .concat(ctx.toolCallsObserved.length ? [`TOOL CALLS: ${ctx.toolCallsObserved.join(", ")}`] : [])
    .join("\n\n");

  const r = await client().messages.create({
    model: "claude-3-5-sonnet-20241022",
    max_tokens: 256,
    temperature: 0,
    tools: [JUDGE_TOOL],
    tool_choice: { type: "tool", name: "score" },
    system: `You are an evaluation judge. Apply the rubric exactly. Be strict — a 5 is rare and means the response was perfect; a 4 means good with minor issues; below 4 fails.`,
    messages: [{
      role: "user",
      content: `RUBRIC:\n${rubric}\n\n----\n\nTRANSCRIPT:\n${transcript}\n\n----\n\nScore via the score tool.`
    }]
  });

  const block = r.content.find(b => b.type === "tool_use");
  if (!block || block.type !== "tool_use") {
    return { score: 1, reason: "judge did not return tool use", pass: false };
  }
  const out = block.input as { score: number; reason: string };
  return { score: out.score, reason: out.reason, pass: out.score >= 4 };
}
