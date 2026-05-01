import { describe, expect, it } from "vitest";
import { IdeaCardSchema, PaperAnalysisSchema } from "~/schema";

describe("PaperAnalysisSchema", () => {
	it("accepts a valid paper analysis", () => {
		const valid = {
			paper_id: "arxiv:2509.21043v1",
			tags: [
				"combinatorial-creativity",
				"novelty-utility",
				"scaling-laws",
				"llm-evaluation",
				"generalization",
			],
			categories: { primary: "cs.AI", secondary: ["cs.CL"] },
			classification: {
				research_type: "empirical",
				contribution_type: ["benchmark", "analysis"],
				maturity: "preprint",
				domain: "computational creativity",
			},
			topic: {
				what: "Introduces combinatorial creativity as a distinct generalization ability.",
				how: "Proposes novelty-utility tradeoff framework with scaling-law analysis.",
				why_matters: "Shows that LLM creativity has fundamental limits even at scale.",
			},
			applicability: {
				good_for: ["evaluating creative AI systems"],
				not_for: ["routine text generation"],
				requires: ["large-scale LLM access"],
			},
			novelty: ["Identifies fundamental novelty-utility tradeoff"],
			open_problems: ["How to shift the Pareto frontier"],
		};
		const result = PaperAnalysisSchema.safeParse(valid);
		expect(result.success).toBe(true);
	});

	it("rejects paper_id with wrong format", () => {
		const invalid = {
			paper_id: "not-an-arxiv-id",
			tags: ["a", "b", "c", "d", "e"],
			categories: { primary: "cs.AI", secondary: [] },
			classification: {
				research_type: "empirical",
				contribution_type: [],
				maturity: "preprint",
				domain: "test",
			},
			topic: { what: "x", how: "y", why_matters: "z" },
			applicability: { good_for: [], not_for: [], requires: [] },
			novelty: [],
			open_problems: [],
		};
		const result = PaperAnalysisSchema.safeParse(invalid);
		expect(result.success).toBe(false);
	});
});

describe("IdeaCardSchema", () => {
	it("accepts a valid idea card", () => {
		const valid = {
			title: "Cross-Domain Creative Scaling",
			paper_a: { id: "arxiv:2509.21043v1", insight: "Novelty-utility tradeoff" },
			paper_b: { id: "arxiv:2409.04109v1", insight: "Human evaluation of LLM ideas" },
			combined_idea: "Use the novelty-utility tradeoff to filter LLM-generated ideas.",
			why_novel: "No prior work combines these two evaluation frameworks.",
			potential_applications: ["AI research evaluation", "automated ideation"],
			scores: { novelty: 8, feasibility: 6, impact: 7 },
		};
		const result = IdeaCardSchema.safeParse(valid);
		expect(result.success).toBe(true);
	});

	it("rejects scores outside 1-10 range", () => {
		const invalid = {
			title: "Test",
			paper_a: { id: "arxiv:2509.21043v1", insight: "A" },
			paper_b: { id: "arxiv:2409.04109v1", insight: "B" },
			combined_idea: "C",
			why_novel: "D",
			potential_applications: ["E"],
			scores: { novelty: 0, feasibility: 11, impact: 5 },
		};
		const result = IdeaCardSchema.safeParse(invalid);
		expect(result.success).toBe(false);
	});
});
