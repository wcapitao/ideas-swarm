import { describe, it, expect } from "vitest";
import { PaperAnalysisSchema, IdeaCardSchema } from "~/schema";

describe("PaperAnalysisSchema", () => {
	it("accepts a valid paper analysis with doi ID", () => {
		const valid = {
			paper_id: "doi:10.1016/S0140-6736(84)91816-6",
			tags: ["gastritis", "h-pylori", "peptic-ulcer", "microbial-etiology"],
			categories: { primary: "microbiology", secondary: ["gastroenterology"] },
			classification: {
				research_type: "empirical",
				contribution_type: ["analysis"],
				maturity: "journal",
				domain: "gastric microbiology",
			},
			topic: {
				what: "Curved bacilli associated with gastritis.",
				how: "Gastric biopsies cultured and examined.",
				why_matters: "First evidence linking bacteria to gastritis.",
			},
			characteristics: [
				{
					dimension: "bacilli_prevalence",
					what_it_measures: "Proportion with bacilli",
					unit: "patients",
					direction: "higher_is_better",
					value: "58 of 100",
					value_numeric: 58,
					value_class: "quantitative-strong",
					vs_baseline: "No prior study",
					evidence: "Prospective cohort",
					confidence: "high",
					context: "100 consecutive patients",
				},
			],
			applicability: {
				good_for: ["establishing microbial etiology"],
				not_for: ["treatment protocols"],
				requires: ["endoscopy with biopsy"],
			},
			novelty: ["First culture of gastric curved bacillus"],
			open_problems: ["Koch's postulates not fulfilled"],
			_meta: {
				analyzed_at: "2026-05-01T00:00:00+00:00",
				model: "claude-opus-4-6",
				input_kind: "abstract_only",
				input_chars: 0,
				prompt_tokens: 0,
				completion_tokens: 0,
				total_tokens: 0,
				latency_s: 0,
				finish_reason: "manual",
			},
		};
		const result = PaperAnalysisSchema.safeParse(valid);
		expect(result.success).toBe(true);
	});

	it("accepts pmid, text, isbn, and arxiv paper IDs", () => {
		const makeMinimal = (id: string) => ({
			paper_id: id,
			tags: ["a", "b", "c", "d"],
			categories: { primary: "x", secondary: [] },
			classification: { research_type: "empirical", contribution_type: [], maturity: "preprint", domain: "test" },
			topic: { what: "x", how: "y", why_matters: "z" },
			characteristics: [],
			applicability: { good_for: [], not_for: [], requires: [] },
			novelty: [],
			open_problems: [],
			_meta: { analyzed_at: "", model: "", input_kind: "", input_chars: 0, prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, latency_s: 0, finish_reason: "" },
		});
		expect(PaperAnalysisSchema.safeParse(makeMinimal("pmid:12345678")).success).toBe(true);
		expect(PaperAnalysisSchema.safeParse(makeMinimal("text:beaumont-1833")).success).toBe(true);
		expect(PaperAnalysisSchema.safeParse(makeMinimal("isbn:978-0805098105")).success).toBe(true);
		expect(PaperAnalysisSchema.safeParse(makeMinimal("arxiv:2509.21043v1")).success).toBe(true);
	});

	it("rejects paper_id with unknown prefix", () => {
		const invalid = {
			paper_id: "unknown:12345",
			tags: ["a", "b", "c", "d"],
			categories: { primary: "x", secondary: [] },
			classification: { research_type: "empirical", contribution_type: [], maturity: "preprint", domain: "test" },
			topic: { what: "x", how: "y", why_matters: "z" },
			characteristics: [],
			applicability: { good_for: [], not_for: [], requires: [] },
			novelty: [],
			open_problems: [],
			_meta: { analyzed_at: "", model: "", input_kind: "", input_chars: 0, prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, latency_s: 0, finish_reason: "" },
		};
		const result = PaperAnalysisSchema.safeParse(invalid);
		expect(result.success).toBe(false);
	});

	it("accepts characteristics with null value_numeric", () => {
		const withNull = {
			paper_id: "doi:10.1234/test",
			tags: ["a", "b", "c", "d"],
			categories: { primary: "x", secondary: [] },
			classification: { research_type: "empirical", contribution_type: [], maturity: "preprint", domain: "test" },
			topic: { what: "x", how: "y", why_matters: "z" },
			characteristics: [{
				dimension: "test",
				what_it_measures: "test",
				unit: "",
				direction: "higher_is_better",
				value: "qualitative result",
				value_numeric: null,
				value_class: "qualitative-strong",
				vs_baseline: "none",
				evidence: "observation",
				confidence: "high",
				context: "lab setting",
			}],
			applicability: { good_for: [], not_for: [], requires: [] },
			novelty: [],
			open_problems: [],
			_meta: { analyzed_at: "", model: "", input_kind: "", input_chars: 0, prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, latency_s: 0, finish_reason: "" },
		};
		const result = PaperAnalysisSchema.safeParse(withNull);
		expect(result.success).toBe(true);
	});
});

describe("IdeaCardSchema", () => {
	it("accepts a valid idea card with doi IDs", () => {
		const valid = {
			title: "Cross-Domain Gastritis Insight",
			paper_a: { id: "doi:10.1016/test", insight: "Bacterial etiology" },
			paper_b: { id: "pmid:12345678", insight: "Herbal gastroprotection" },
			combined_idea: "Combine bacterial targeting with herbal defense.",
			why_novel: "No prior work bridges microbiology and ethnopharmacology.",
			potential_applications: ["integrative gastritis treatment"],
			scores: { novelty: 8, feasibility: 6, impact: 7 },
		};
		const result = IdeaCardSchema.safeParse(valid);
		expect(result.success).toBe(true);
	});

	it("rejects scores outside 1-10 range", () => {
		const invalid = {
			title: "Test",
			paper_a: { id: "doi:10.1016/test", insight: "A" },
			paper_b: { id: "pmid:12345678", insight: "B" },
			combined_idea: "C",
			why_novel: "D",
			potential_applications: ["E"],
			scores: { novelty: 0, feasibility: 11, impact: 5 },
		};
		const result = IdeaCardSchema.safeParse(invalid);
		expect(result.success).toBe(false);
	});
});
