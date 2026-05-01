import type { PaperAnalysis } from "~/schema";

export function buildSystemPrompt(): string {
	return `You are a combinatorial creativity engine. Your task is to generate novel research ideas by combining insights from two different papers.

Given two papers from different domains, you must:
1. Identify the key insight from each paper
2. Find a non-obvious connection between them
3. Propose a concrete, actionable research idea that combines both insights
4. Explain why this combination is novel
5. List 2-3 potential applications
6. Self-score the idea on novelty (1-10), feasibility (1-10), and impact (1-10)

Be specific and concrete. Avoid generic combinations. The best ideas come from connecting concepts that seem unrelated at first glance.

Respond with valid JSON matching this exact structure:
{
  "title": "short descriptive title",
  "paper_a": { "id": "arxiv ID", "insight": "key insight extracted" },
  "paper_b": { "id": "arxiv ID", "insight": "key insight extracted" },
  "combined_idea": "detailed description of the combined idea",
  "why_novel": "explanation of why this combination is novel",
  "potential_applications": ["application 1", "application 2"],
  "scores": { "novelty": 8, "feasibility": 6, "impact": 7 }
}`;
}

function formatPaper(label: string, paper: PaperAnalysis): string {
	return `## ${label}: ${paper.paper_id}

**What:** ${paper.topic.what}
**How:** ${paper.topic.how}
**Why it matters:** ${paper.topic.why_matters}

**Tags:** ${paper.tags.join(", ")}
**Domain:** ${paper.classification.domain}

**Novelty claims:**
${paper.novelty.map((n) => `- ${n}`).join("\n")}

**Open problems:**
${paper.open_problems.map((p) => `- ${p}`).join("\n")}

**Good for:** ${paper.applicability.good_for.join(", ")}
**Not for:** ${paper.applicability.not_for.join(", ")}
**Requires:** ${paper.applicability.requires.join(", ")}`;
}

export function buildIdeaPrompt(
	userTopic: string,
	paperA: PaperAnalysis,
	paperB: PaperAnalysis,
): string {
	return `# User's Problem / Topic

${userTopic}

# Papers to Combine

${formatPaper("Paper A", paperA)}

${formatPaper("Paper B", paperB)}

# Task

Generate a novel research idea that combines insights from Paper A and Paper B to address the user's problem/topic. Respond with the JSON structure specified in your instructions.`;
}
