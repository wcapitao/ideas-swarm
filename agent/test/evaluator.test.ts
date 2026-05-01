import { describe, expect, it } from "vitest";
import { buildEvalPrompt, parseEvalResult } from "~/evaluator";
import { EvalResultSchema } from "~/schema";
import type { IdeaCard } from "~/schema";

function makeCard(overrides: Partial<IdeaCard> = {}): IdeaCard {
	return {
		title: "Cross-Domain Insight",
		paper_a: { id: "doi:10.1016/test", insight: "Insight A" },
		paper_b: { id: "pmid:12345678", insight: "Insight B" },
		combined_idea: "SYNTHESIS_LINE_UNIQUE",
		why_novel: "Novelty claim.",
		potential_applications: ["application"],
		scores: { novelty: 6, feasibility: 8, impact: 7 },
		...overrides,
	};
}

describe("EvalResultSchema", () => {
	it("accepts a valid eval result", () => {
		const valid = {
			evidence_gaps: ["gap"],
			safety_flags: [],
			adjusted_scores: { novelty: 5, feasibility: 6, impact: 7 },
			confidence: "promising" as const,
			one_liner: "Looks plausible.",
		};
		expect(EvalResultSchema.safeParse(valid).success).toBe(true);
	});

	it("rejects confidence outside the enum", () => {
		const invalid = {
			evidence_gaps: [],
			safety_flags: [],
			adjusted_scores: { novelty: 5, feasibility: 5, impact: 5 },
			confidence: "maybe",
			one_liner: "x",
		};
		expect(EvalResultSchema.safeParse(invalid).success).toBe(false);
	});

	it("rejects adjusted scores outside 1–10", () => {
		const invalid = {
			evidence_gaps: [],
			safety_flags: [],
			adjusted_scores: { novelty: 0, feasibility: 5, impact: 11 },
			confidence: "risky",
			one_liner: "x",
		};
		expect(EvalResultSchema.safeParse(invalid).success).toBe(false);
	});
});

describe("buildEvalPrompt", () => {
	it("includes combined_idea and both paper IDs", () => {
		const card = makeCard({
			combined_idea: "TARGET_COMBINED_TEXT",
			paper_a: { id: "arxiv:1111.00001v1", insight: "a" },
			paper_b: { id: "pmid:999", insight: "b" },
		});
		const p = buildEvalPrompt(card);
		expect(p).toContain("TARGET_COMBINED_TEXT");
		expect(p).toContain("arxiv:1111.00001v1");
		expect(p).toContain("pmid:999");
	});
});

describe("parseEvalResult", () => {
	it("returns null for non-JSON input", () => {
		expect(parseEvalResult("not json")).toBeNull();
	});

	it("accepts JSON wrapped in markdown code fences", () => {
		const raw =
			'```json\n{"evidence_gaps":[],"safety_flags":[],"adjusted_scores":{"novelty":5,"feasibility":6,"impact":7},"confidence":"promising","one_liner":"ok"}\n```';
		const parsed = parseEvalResult(raw);
		expect(parsed).not.toBeNull();
		expect(parsed?.confidence).toBe("promising");
	});
});
