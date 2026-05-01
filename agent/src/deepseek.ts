import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

import type { Env } from "~/index";

export const JSON_EXTRACTION_PATTERN = /{[\s\S]*}/;

export function stripThinkingTags(text: string): string {
	return text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
}

export function buildDeepSeekProvider(env: Env): ReturnType<typeof createOpenAICompatible> {
	const gatewayBaseUrl = `https://gateway.ai.cloudflare.com/v1/${env.CLOUDFLARE_ACCOUNT_ID}/${env.AIG_GATEWAY_ID}/deepseek`;
	return createOpenAICompatible({
		name: "deepseek",
		baseURL: gatewayBaseUrl,
		apiKey: env.DEEPSEEK_API_KEY,
	});
}

export function unwrapJsonFences(text: string): string {
	let t = text.trim();
	if (t.startsWith("```")) {
		t = t.replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?```\s*$/i, "");
	}
	return t.trim();
}
