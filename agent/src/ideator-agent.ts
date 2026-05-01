import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { AIChatAgent } from "agents/ai-chat-agent";
import { generateText, streamText } from "ai";
import type { StreamTextOnFinishCallback, ToolSet } from "ai";

import type { Env } from "~/index";
import { selectPairs } from "~/paper-selector";
import { loadPapers } from "~/papers";
import { buildIdeaPrompt, buildSystemPrompt } from "~/prompt";
import { IdeaCardSchema } from "~/schema";
import type { IdeaCard } from "~/schema";

// The agents package bundles ai v4 internally while this project imports ai v6.
// The AIChatAgent base class is typed against ai v4's StreamTextOnFinishCallback,
// which has a narrower event shape than v6. We derive the base type here and cast
// when forwarding to ai v6's streamText — safe because both are the same JS value
// at runtime (the framework owns and calls this callback, we only forward it).
type OnChatMessageFinish = Parameters<AIChatAgent<Env>["onChatMessage"]>[0];

// Maximum token budget per idea-generation call to keep costs bounded.
const IDEA_GEN_MAX_TOKENS = 1024;

// Maximum token budget for the final formatting/streaming response.
const FORMAT_MAX_TOKENS = 2048;

// Regex to extract the first JSON object from a raw LLM response string.
// DeepSeek sometimes wraps JSON in markdown code fences or leading prose.
const JSON_EXTRACTION_PATTERN = /{[\s\S]*}/;

/**
 * Builds the DeepSeek provider pointed at Cloudflare AI Gateway.
 * AI Gateway provides logging, caching, and rate-limit protection at the edge.
 */
function buildDeepSeekProvider(env: Env): ReturnType<typeof createOpenAICompatible> {
	const gatewayBaseUrl = `https://gateway.ai.cloudflare.com/v1/${env.CLOUDFLARE_ACCOUNT_ID}/${env.AIG_GATEWAY_ID}/deepseek`;
	return createOpenAICompatible({
		name: "deepseek",
		baseURL: gatewayBaseUrl,
		apiKey: env.DEEPSEEK_API_KEY,
	});
}

/**
 * Extracts the user's topic from the most recent user message in the conversation.
 * Falls back to a generic prompt when no user message is found.
 * Stella Principle: pure string traversal — no LLM involved.
 */
function extractUserTopic(messages: { role: string; content: unknown }[]): string {
	for (let i = messages.length - 1; i >= 0; i--) {
		const message = messages[i];
		if (message.role !== "user") continue;

		const content = message.content;
		if (typeof content === "string") return content;

		// Handle array content parts (e.g., multi-modal messages with text parts)
		if (Array.isArray(content)) {
			const textPart = content.find(
				(part): part is { type: "text"; text: string } =>
					typeof part === "object" &&
					part !== null &&
					(part as Record<string, unknown>).type === "text",
			);
			if (textPart) return textPart.text;
		}
	}
	return "novel research ideas combining insights from different domains";
}

/**
 * Attempts to parse a raw LLM response string into a validated IdeaCard.
 * Returns null when the response is missing, malformed, or fails schema validation.
 * Stella Principle: JSON extraction and Zod validation are deterministic — no LLM involved.
 */
function parseIdeaCard(rawText: string): IdeaCard | null {
	const match = rawText.match(JSON_EXTRACTION_PATTERN);
	if (!match) return null;

	let parsed: unknown;
	try {
		parsed = JSON.parse(match[0]);
	} catch {
		return null;
	}

	const result = IdeaCardSchema.safeParse(parsed);
	return result.success ? result.data : null;
}

/**
 * Formats a validated IdeaCard into a markdown section for display.
 * Stella Principle: pure string formatting — no LLM involved.
 */
function formatIdeaCard(card: IdeaCard, index: number): string {
	const scoreBar = (score: number): string => "█".repeat(score) + "░".repeat(10 - score);

	return [
		`## Idea ${index + 1}: ${card.title}`,
		"",
		"### Source Papers",
		`- **Paper A** (\`${card.paper_a.id}\`): ${card.paper_a.insight}`,
		`- **Paper B** (\`${card.paper_b.id}\`): ${card.paper_b.insight}`,
		"",
		"### Combined Idea",
		card.combined_idea,
		"",
		"### Why This Is Novel",
		card.why_novel,
		"",
		"### Potential Applications",
		...card.potential_applications.map((app) => `- ${app}`),
		"",
		"### Scores",
		`- Novelty:      ${scoreBar(card.scores.novelty)} ${card.scores.novelty}/10`,
		`- Feasibility:  ${scoreBar(card.scores.feasibility)} ${card.scores.feasibility}/10`,
		`- Impact:       ${scoreBar(card.scores.impact)} ${card.scores.impact}/10`,
	].join("\n");
}

/**
 * Assembles the final markdown document from validated idea cards.
 * Returns a human-readable fallback when no valid cards were produced.
 * Stella Principle: pure string assembly — no LLM involved.
 */
function buildFinalDocument(userTopic: string, validCards: IdeaCard[], totalPairs: number): string {
	if (validCards.length === 0) {
		return [
			`I attempted to generate combinatorial research ideas for: "${userTopic}"`,
			"",
			"Unfortunately, all idea generation attempts produced malformed or invalid responses.",
			"Please try again — this may be a transient model issue.",
		].join("\n");
	}

	const cardSections = validCards.map((card, index) => formatIdeaCard(card, index));
	return [
		"# Combinatorial Research Ideas",
		"",
		`**Topic:** ${userTopic}`,
		`**Ideas generated:** ${validCards.length} of ${totalPairs} pairs`,
		"",
		...cardSections.flatMap((section) => [section, ""]),
	].join("\n");
}

/**
 * IdeatorAgent — Durable Object that orchestrates combinatorial idea generation.
 *
 * Flow:
 * 1. Load papers from the knowledge base (deterministic, cached in module scope).
 * 2. Select up to 4 maximally-distant paper pairs via Jaccard distance (deterministic).
 * 3. Generate one idea per pair in parallel via DeepSeek (up to 4 concurrent LLM calls).
 * 4. Parse and validate each idea card with Zod, skipping malformed responses.
 * 5. Assemble a formatted markdown document from all valid cards.
 * 6. Stream the document back to the client via the AIChatAgent response pipeline.
 */
export class IdeatorAgent extends AIChatAgent<Env> {
	async onChatMessage(
		onFinish: OnChatMessageFinish,
		options?: { abortSignal: AbortSignal | undefined },
	): Promise<Response | undefined> {
		const provider = buildDeepSeekProvider(this.env);
		const model = provider("deepseek-chat");

		const userTopic = extractUserTopic(this.messages);

		// Steps 1 & 2: deterministic — no LLM
		const papers = loadPapers();
		const pairs = selectPairs(papers);

		if (pairs.length === 0) {
			// Graceful degradation: stream an informative error when the KB is empty
			const result = streamText({
				model,
				system: buildSystemPrompt(),
				prompt:
					"The knowledge base has no papers loaded. Please add papers to the knowledge base before generating ideas.",
				maxOutputTokens: FORMAT_MAX_TOKENS,
				abortSignal: options?.abortSignal,
				// Cast bridges the ai v4 (agents internal) / ai v6 (our import) type boundary.
				// At runtime this is the same JS function — the framework owns and calls it.
				onFinish: onFinish as unknown as StreamTextOnFinishCallback<ToolSet>,
			});
			return result.toUIMessageStreamResponse();
		}

		const systemPrompt = buildSystemPrompt();

		// Step 3: parallel idea generation — one generateText call per pair.
		// generateText (not streamText) is used here because we need the complete JSON
		// response from each call before we can validate it with IdeaCardSchema.safeParse().
		const ideaResults = await Promise.allSettled(
			pairs.map(([paperA, paperB]) =>
				generateText({
					model,
					system: systemPrompt,
					prompt: buildIdeaPrompt(userTopic, paperA, paperB),
					maxOutputTokens: IDEA_GEN_MAX_TOKENS,
					abortSignal: options?.abortSignal,
				}),
			),
		);

		// Step 4: parse and validate — deterministic, Stella-compliant
		const validCards: IdeaCard[] = [];
		for (const result of ideaResults) {
			if (result.status === "rejected") continue;
			const card = parseIdeaCard(result.value.text);
			if (card !== null) validCards.push(card);
		}

		// Step 5: assemble the formatted document (deterministic)
		const finalDocument = buildFinalDocument(userTopic, validCards, pairs.length);

		// Step 6: stream the document back through the AIChatAgent pipeline.
		// We pass the pre-formatted markdown as the prompt and instruct the model to
		// reproduce it verbatim. This keeps formatting deterministic while using streamText
		// so AIChatAgent can persist the assistant message via the onFinish callback.
		const streamResult = streamText({
			model,
			system:
				"Reproduce the following document exactly as provided, without any changes or additions.",
			prompt: finalDocument,
			maxOutputTokens: FORMAT_MAX_TOKENS,
			abortSignal: options?.abortSignal,
			// Cast bridges the ai v4 (agents internal) / ai v6 (our import) type boundary.
			// At runtime this is the same JS function — the framework owns and calls it.
			onFinish: onFinish as unknown as StreamTextOnFinishCallback<ToolSet>,
		});

		return streamResult.toUIMessageStreamResponse();
	}
}
