import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { generateText } from "ai";

import type { Env } from "~/index";
import { EvalResultSchema } from "~/schema";
import type { EvalResult, IdeaCard } from "~/schema";

const EVAL_MAX_TOKENS = 512;

const JSON_EXTRACTION_PATTERN = /{[\s\S]*}/;

function buildDeepSeekProvider(env: Env): ReturnType<typeof createOpenAICompatible> {
	const gatewayBaseUrl = `https://gateway.ai.cloudflare.com/v1/${env.CLOUDFLARE_ACCOUNT_ID}/${env.AIG_GATEWAY_ID}/deepseek`;
	return createOpenAICompatible({
		name: "deepseek",
		baseURL: gatewayBaseUrl,
		apiKey: env.DEEPSEEK_API_KEY,
	});
}

function unwrapJsonFences(text: string): string {
	let t = text.trim();
	if (t.startsWith("```")) {
		t = t.replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?```\s*$/i, "");
	}
	return t.trim();
}

export function buildEvalSystemPrompt(): string {
	return [
		"You are a medical evidence evaluator. Stress-test proposed research ideas against what the literature plausibly supports.",
		"Be critical: list evidence gaps (e.g. mechanisms not shown in humans), safety flags (contraindications, interactions, population risks), and fix over-inflated scores.",
		"If the generator's self-scores are poorly supported, change adjusted_scores. Do not copy self-scores without a clear reason.",
		"Return JSON only — one object, no markdown, no commentary.",
	].join(" ");
}

export function buildEvalPrompt(card: IdeaCard): string {
	const self = card.scores;
	return [
		"Evaluate this combinatorial research idea. Output JSON matching exactly:",
		"{ evidence_gaps: string[], safety_flags: string[], adjusted_scores: { novelty, feasibility, impact (1-10 ints) }, confidence: 'promising'|'needs_validation'|'risky', one_liner: string }",
		"",
		"This is a research synthesis tool — flag anything needing clinical validation before patient use.",
		"",
		`combined_idea: ${card.combined_idea}`,
		`why_novel: ${card.why_novel}`,
		`paper_a_id: ${card.paper_a.id}`,
		`paper_a_insight: ${card.paper_a.insight}`,
		`paper_b_id: ${card.paper_b.id}`,
		`paper_b_insight: ${card.paper_b.insight}`,
		`generator_self_scores: novelty=${self.novelty}, feasibility=${self.feasibility}, impact=${self.impact}`,
	].join("\n");
}

export function parseEvalResult(rawText: string): EvalResult | null {
	const stripped = unwrapJsonFences(rawText);
	const match = stripped.match(JSON_EXTRACTION_PATTERN);
	if (!match) return null;

	let parsed: unknown;
	try {
		parsed = JSON.parse(match[0]);
	} catch {
		return null;
	}

	const result = EvalResultSchema.safeParse(parsed);
	return result.success ? result.data : null;
}

export async function evaluateIdea(
	card: IdeaCard,
	env: Env,
	options?: { abortSignal?: AbortSignal },
): Promise<EvalResult | null> {
	try {
		const provider = buildDeepSeekProvider(env);
		const model = provider("deepseek-chat");
		const { text } = await generateText({
			model,
			system: buildEvalSystemPrompt(),
			prompt: buildEvalPrompt(card),
			maxOutputTokens: EVAL_MAX_TOKENS,
			abortSignal: options?.abortSignal,
		});
		return parseEvalResult(text);
	} catch {
		return null;
	}
}
