import { describe, expect, it } from "vitest";
import { buildIdeaPrompt, buildSystemPrompt } from "~/prompt";
import type { PaperAnalysis } from "~/schema";

function makePaper(overrides: Partial<PaperAnalysis> & { paper_id: string }): PaperAnalysis {
	return {
		tags: ["tag-a", "tag-b", "tag-c", "tag-d", "tag-e"],
		categories: { primary: "cs.AI", secondary: [] },
		classification: {
			research_type: "empirical",
			contribution_type: [],
			maturity: "preprint",
			domain: "AI",
		},
		topic: { what: "Does X.", how: "Via Y.", why_matters: "Because Z." },
		characteristics: [],
		applicability: { good_for: ["A"], not_for: ["B"], requires: ["C"] },
		novelty: ["First to do X"],
		open_problems: ["How to scale X"],
		_meta: {
			analyzed_at: "",
			model: "",
			input_kind: "",
			input_chars: 0,
			prompt_tokens: 0,
			completion_tokens: 0,
			total_tokens: 0,
			latency_s: 0,
			finish_reason: "",
		},
		...overrides,
	};
}

describe("buildSystemPrompt", () => {
	it("returns a non-empty string mentioning combinatorial creativity", () => {
		const prompt = buildSystemPrompt();
		expect(prompt.length).toBeGreaterThan(100);
		expect(prompt.toLowerCase()).toContain("combinatorial");
	});
});

describe("buildIdeaPrompt", () => {
	it("includes both papers' topics and the user's problem", () => {
		const paperA = makePaper({ paper_id: "arxiv:2509.21043v1" });
		const paperB = makePaper({ paper_id: "arxiv:2409.04109v1" });
		const prompt = buildIdeaPrompt("How to improve LLM creativity?", paperA, paperB);
		expect(prompt).toContain("arxiv:2509.21043v1");
		expect(prompt).toContain("arxiv:2409.04109v1");
		expect(prompt).toContain("How to improve LLM creativity?");
		expect(prompt).toContain("Does X.");
	});

	it("includes novelty claims and open problems", () => {
		const paperA = makePaper({ paper_id: "arxiv:2509.21043v1", novelty: ["Novel claim A"] });
		const paperB = makePaper({ paper_id: "arxiv:2409.04109v1", open_problems: ["Open problem B"] });
		const prompt = buildIdeaPrompt("topic", paperA, paperB);
		expect(prompt).toContain("Novel claim A");
		expect(prompt).toContain("Open problem B");
	});
});
