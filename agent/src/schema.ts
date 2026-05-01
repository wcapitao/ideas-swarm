import { z } from "zod";

// arXiv paper ID format: arxiv:YYMM.NNNNNvV (4 or 5 digit number, optional version suffix)
const arxivIdPattern = /^arxiv:[0-9]{4}\.[0-9]{4,5}(v[0-9]+)?$/;

export const PaperAnalysisSchema = z.object({
	paper_id: z.string().regex(arxivIdPattern),
	tags: z.array(z.string()).min(5).max(15),
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
	applicability: z.object({
		good_for: z.array(z.string()),
		not_for: z.array(z.string()),
		requires: z.array(z.string()),
	}),
	novelty: z.array(z.string()),
	open_problems: z.array(z.string()),
});

export type PaperAnalysis = z.infer<typeof PaperAnalysisSchema>;

export const IdeaCardSchema = z.object({
	title: z.string(),
	paper_a: z.object({
		id: z.string().regex(arxivIdPattern),
		insight: z.string(),
	}),
	paper_b: z.object({
		id: z.string().regex(arxivIdPattern),
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
