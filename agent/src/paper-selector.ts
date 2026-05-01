import type { PaperAnalysis } from "~/schema";

/**
 * Computes Jaccard distance between two string sets.
 * Returns 0 for identical sets and 1 for completely disjoint sets.
 * Stella Principle: pure math — no LLM involved.
 */
export function jaccardDistance(a: Set<string>, b: Set<string>): number {
	if (a.size === 0 && b.size === 0) return 0;
	let intersection = 0;
	for (const item of a) {
		if (b.has(item)) intersection++;
	}
	const union = a.size + b.size - intersection;
	return 1 - intersection / union;
}

/**
 * Builds a feature set from a paper using tags + primary category + domain.
 * Secondary categories are intentionally excluded to keep the signal focused
 * on the paper's primary identity rather than its incidental cross-listings.
 */
export function buildFeatureSet(paper: PaperAnalysis): Set<string> {
	const features = new Set<string>();
	for (const tag of paper.tags) features.add(tag);
	features.add(paper.categories.primary);
	features.add(paper.classification.domain);
	return features;
}

/**
 * Selects up to 4 maximally-distant paper pairs from a corpus.
 *
 * Algorithm: greedy selection over all candidate pairs sorted by descending
 * Jaccard distance, capping each paper's participation at 2 pairs to prevent
 * a single highly-distinct paper from dominating all slots.
 *
 * When the corpus has fewer than 8 papers, the pair count scales down as
 * floor(n / 2) to avoid exhausting the corpus.
 */
export function selectPairs(papers: PaperAnalysis[]): [PaperAnalysis, PaperAnalysis][] {
	const maxPairs = Math.min(4, Math.floor(papers.length / 2));
	if (maxPairs === 0) return [];

	const features = papers.map((p) => buildFeatureSet(p));

	const candidates: { i: number; j: number; distance: number }[] = [];
	for (let i = 0; i < papers.length; i++) {
		for (let j = i + 1; j < papers.length; j++) {
			candidates.push({ i, j, distance: jaccardDistance(features[i], features[j]) });
		}
	}
	candidates.sort((a, b) => b.distance - a.distance);

	const selected: [PaperAnalysis, PaperAnalysis][] = [];
	const usageCount = new Map<number, number>();

	for (const { i, j } of candidates) {
		if (selected.length >= maxPairs) break;
		const countI = usageCount.get(i) ?? 0;
		const countJ = usageCount.get(j) ?? 0;
		if (countI >= 2 || countJ >= 2) continue;
		selected.push([papers[i], papers[j]]);
		usageCount.set(i, countI + 1);
		usageCount.set(j, countJ + 1);
	}

	return selected;
}
