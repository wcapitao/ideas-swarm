import { describe, expect, it } from "vitest";
import { buildFeatureSet, jaccardDistance, selectPairs } from "~/paper-selector";
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
		topic: { what: "x", how: "y", why_matters: "z" },
		applicability: { good_for: [], not_for: [], requires: [] },
		novelty: [],
		open_problems: [],
		...overrides,
	};
}

describe("jaccardDistance", () => {
	it("returns 0 for identical sets", () => {
		const a = new Set(["x", "y", "z"]);
		expect(jaccardDistance(a, a)).toBe(0);
	});

	it("returns 1 for completely disjoint sets", () => {
		const a = new Set(["x", "y"]);
		const b = new Set(["a", "b"]);
		expect(jaccardDistance(a, b)).toBe(1);
	});

	it("returns correct value for partial overlap", () => {
		const a = new Set(["x", "y", "z"]);
		const b = new Set(["y", "z", "w"]);
		// intersection=2, union=4, distance=1-2/4=0.5
		expect(jaccardDistance(a, b)).toBeCloseTo(0.5);
	});
});

describe("buildFeatureSet", () => {
	it("combines tags + primary category + domain", () => {
		const paper = makePaper({
			paper_id: "arxiv:2509.21043v1",
			tags: ["creativity", "scaling", "llm", "novelty", "tradeoff"],
			categories: { primary: "cs.AI", secondary: ["cs.CL"] },
			classification: {
				research_type: "empirical",
				contribution_type: [],
				maturity: "preprint",
				domain: "computational creativity",
			},
		});
		const features = buildFeatureSet(paper);
		expect(features.has("creativity")).toBe(true);
		expect(features.has("cs.AI")).toBe(true);
		expect(features.has("computational creativity")).toBe(true);
		expect(features.has("cs.CL")).toBe(false); // only primary
	});
});

describe("selectPairs", () => {
	it("returns 4 pairs from 8+ papers", () => {
		const papers = Array.from({ length: 10 }, (_, i) =>
			makePaper({
				paper_id: `arxiv:2500.0000${i}v1`,
				tags: [`unique-tag-${i}`, "shared", "common", "base", "filler"],
				categories: { primary: i < 5 ? "cs.AI" : "cs.CL", secondary: [] },
				classification: {
					research_type: "empirical",
					contribution_type: [],
					maturity: "preprint",
					domain: i < 5 ? "AI" : "NLP",
				},
			}),
		);
		const pairs = selectPairs(papers);
		expect(pairs).toHaveLength(4);
		for (const [a, b] of pairs) {
			expect(a.paper_id).not.toBe(b.paper_id);
		}
	});

	it("ensures no paper appears more than twice", () => {
		const papers = Array.from({ length: 10 }, (_, i) =>
			makePaper({
				paper_id: `arxiv:2500.0000${i}v1`,
				tags: [`unique-tag-${i}`, "shared", "common", "base", "filler"],
				categories: { primary: "cs.AI", secondary: [] },
				classification: {
					research_type: "empirical",
					contribution_type: [],
					maturity: "preprint",
					domain: "AI",
				},
			}),
		);
		const pairs = selectPairs(papers);
		const counts = new Map<string, number>();
		for (const [a, b] of pairs) {
			counts.set(a.paper_id, (counts.get(a.paper_id) ?? 0) + 1);
			counts.set(b.paper_id, (counts.get(b.paper_id) ?? 0) + 1);
		}
		for (const count of counts.values()) {
			expect(count).toBeLessThanOrEqual(2);
		}
	});

	it("reduces pairs when corpus < 8 papers", () => {
		const papers = Array.from({ length: 4 }, (_, i) =>
			makePaper({
				paper_id: `arxiv:2500.0000${i}v1`,
				tags: [`tag-${i}`, "shared", "common", "base", "filler"],
				categories: { primary: "cs.AI", secondary: [] },
				classification: {
					research_type: "empirical",
					contribution_type: [],
					maturity: "preprint",
					domain: "AI",
				},
			}),
		);
		const pairs = selectPairs(papers);
		expect(pairs.length).toBeLessThanOrEqual(2);
		expect(pairs.length).toBeGreaterThan(0);
	});
});
