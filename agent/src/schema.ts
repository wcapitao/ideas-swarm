import { z } from "zod";

// Supports doi, pmid, text, isbn, and arxiv paper ID prefixes
const paperIdPattern = /^(doi|pmid|text|isbn|arxiv):.+$/;

const CharacteristicSchema = z.object({
	dimension: z.string(),
	what_it_measures: z.string(),
	unit: z.string(),
	direction: z.string(),
	value: z.string(),
	value_numeric: z.number().nullable(),
	value_class: z.string(),
	vs_baseline: z.string(),
	evidence: z.string(),
	confidence: z.string(),
	context: z.string(),
});

export type Characteristic = z.infer<typeof CharacteristicSchema>;

const MetaSchema = z.object({
	analyzed_at: z.string(),
	model: z.string(),
	input_kind: z.string(),
	input_chars: z.number(),
	prompt_tokens: z.number(),
	completion_tokens: z.number(),
	total_tokens: z.number(),
	latency_s: z.number(),
	finish_reason: z.string(),
});

export const PaperAnalysisSchema = z.object({
	paper_id: z.string().regex(paperIdPattern),
	tags: z.array(z.string()).min(4).max(15),
	categories: z.object({
		primary: z.string(),
		secondary: z.array(z.string()),
	}),
	classification: z.object({
		research_type: z.string(),
		contribution_type: z.array(z.string()),
		maturity: z.string(),
		domain: z.string(),
	}),
	topic: z.object({
		what: z.string(),
		how: z.string(),
		why_matters: z.string(),
	}),
	characteristics: z.array(CharacteristicSchema),
	applicability: z.object({
		good_for: z.array(z.string()),
		not_for: z.array(z.string()),
		requires: z.array(z.string()),
	}),
	novelty: z.array(z.string()),
	open_problems: z.array(z.string()),
	_meta: MetaSchema,
});

export type PaperAnalysis = z.infer<typeof PaperAnalysisSchema>;

export const IdeaCardSchema = z.object({
	title: z.string(),
	paper_a: z.object({
		id: z.string().regex(paperIdPattern),
		insight: z.string(),
	}),
	paper_b: z.object({
		id: z.string().regex(paperIdPattern),
		insight: z.string(),
	}),
	combined_idea: z.string(),
	why_novel: z.string(),
	potential_applications: z.array(z.string()).min(1).max(3),
	scores: z.object({
		novelty: z.number().int().min(1).max(10),
		feasibility: z.number().int().min(1).max(10),
		impact: z.number().int().min(1).max(10),
	}),
});

export type IdeaCard = z.infer<typeof IdeaCardSchema>;

export const EvalResultSchema = z.object({
	evidence_gaps: z.array(z.string()),
	safety_flags: z.array(z.string()),
	adjusted_scores: z.object({
		novelty: z.number().int().min(1).max(10),
		feasibility: z.number().int().min(1).max(10),
		impact: z.number().int().min(1).max(10),
	}),
	confidence: z.enum(["promising", "needs_validation", "risky"]),
	one_liner: z.string(),
});

export type EvalResult = z.infer<typeof EvalResultSchema>;
