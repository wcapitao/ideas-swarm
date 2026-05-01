# MVP Ideator Agent — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a single Cloudflare Workers agent that takes a user's topic, selects 4 maximally-distant arXiv paper pairs, generates 4 novel ideas via DeepSeek, and streams them as structured cards to a chat UI.

**Architecture:** A single `AIChatAgent` Durable Object handles the entire flow. Pre-analyzed paper JSONs are bundled as static data. Paper selection uses Jaccard distance (pure math, no LLM). The frontend uses `useAgentChat` from `agents/ai-react` over WebSocket. DeepSeek calls go through Cloudflare AI Gateway using `@ai-sdk/openai-compatible` with the `ai` package's `streamText`.

**Tech Stack:** Cloudflare Workers + Durable Objects, `agents` SDK (AIChatAgent), `ai` v4 (streamText), `@ai-sdk/openai-compatible` (DeepSeek via AI Gateway), Zod, React 19 + `agents/ai-react` (useAgentChat), Tailwind CSS, Vitest + `@cloudflare/vitest-pool-workers`.

---

## File Map

| File | Responsibility |
|------|---------------|
| `agent/src/schema.ts` | Zod schemas for PaperAnalysis input and IdeaCard output |
| `agent/src/paper-selector.ts` | Jaccard distance computation + greedy pair selection |
| `agent/src/prompt.ts` | System prompt + per-call prompt builder |
| `agent/src/ideator-agent.ts` | AIChatAgent DO — onChatMessage orchestration |
| `agent/src/index.ts` | Worker entrypoint — routeAgentRequest + static asset serving |
| `agent/data/papers/*.json` | 10 sample pre-analyzed paper JSONs (PaperAnalysis schema) |
| `agent/frontend/index.html` | HTML shell for the SPA |
| `agent/frontend/App.tsx` | React chat UI with idea cards |
| `agent/frontend/styles.css` | Tailwind CSS |
| `agent/test/schema.test.ts` | Zod schema validation tests |
| `agent/test/paper-selector.test.ts` | Jaccard + pair selection tests |
| `agent/test/prompt.test.ts` | Prompt builder tests |

---

## Task 1: Install Dependencies & Update Config

**Files:**
- Modify: `agent/package.json`
- Modify: `agent/tsconfig.json`
- Modify: `agent/wrangler.jsonc`

- [ ] **Step 1: Install runtime + frontend dependencies**

```bash
cd agent
npm install @ai-sdk/openai-compatible react react-dom
npm install -D @types/react @types/react-dom tailwindcss @tailwindcss/vite vite
```

- [ ] **Step 2: Simplify wrangler.jsonc for MVP**

The full architecture config has D1, R2, Vectorize, queues — MVP needs only the IdeatorAgent DO and AI Gateway vars. Replace `agent/wrangler.jsonc` with:

```jsonc
{
  "name": "ai-ideator",
  "main": "src/index.ts",
  "compatibility_date": "2025-04-01",
  "compatibility_flags": ["nodejs_compat"],

  "durable_objects": {
    "bindings": [
      { "name": "IDEATOR", "class_name": "IdeatorAgent" }
    ]
  },

  "migrations": [
    {
      "tag": "v1",
      "new_sqlite_classes": ["IdeatorAgent"]
    }
  ],

  "vars": {
    "ENVIRONMENT": "development",
    "AIG_GATEWAY_ID": "ai-ideator"
  },

  "assets": {
    "directory": "./public"
  }
}
```

- [ ] **Step 3: Update tsconfig.json to include frontend files**

Add `"frontend/**/*.tsx"` to the `include` array in `agent/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "types": ["@cloudflare/workers-types/2023-07-01"],
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "esModuleInterop": true,
    "jsx": "react-jsx",
    "jsxImportSource": "react",
    "paths": {
      "~/*": ["./src/*"]
    }
  },
  "include": ["src/**/*.ts", "src/**/*.tsx", "frontend/**/*.tsx", "test/**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 4: Remove empty scaffold directories**

```bash
cd agent
rm -rf src/agents src/workers src/types src/stubs
```

- [ ] **Step 5: Commit**

```bash
git add agent/package.json agent/package-lock.json agent/wrangler.jsonc agent/tsconfig.json
git commit -m "chore: install MVP deps, simplify wrangler config for single-agent architecture"
```

---

## Task 2: Zod Schemas (`schema.ts`)

**Files:**
- Create: `agent/src/schema.ts`
- Create: `agent/test/schema.test.ts`

- [ ] **Step 1: Write the failing test**

Create `agent/test/schema.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { PaperAnalysisSchema, IdeaCardSchema } from "~/schema";

describe("PaperAnalysisSchema", () => {
	it("accepts a valid paper analysis", () => {
		const valid = {
			paper_id: "arxiv:2509.21043v1",
			tags: ["combinatorial-creativity", "novelty-utility", "scaling-laws", "llm-evaluation", "generalization"],
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
			classification: { research_type: "empirical", contribution_type: [], maturity: "preprint", domain: "test" },
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
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd agent && npx vitest run test/schema.test.ts
```

Expected: FAIL — `Cannot find module '~/schema'`

- [ ] **Step 3: Write minimal implementation**

Create `agent/src/schema.ts`:

```typescript
import { z } from "zod";

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
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd agent && npx vitest run test/schema.test.ts
```

Expected: PASS (2 suites, 4 tests)

- [ ] **Step 5: Commit**

```bash
git add agent/src/schema.ts agent/test/schema.test.ts
git commit -m "feat: add Zod schemas for PaperAnalysis input and IdeaCard output"
```

---

## Task 3: Paper Selector (`paper-selector.ts`)

**Files:**
- Create: `agent/src/paper-selector.ts`
- Create: `agent/test/paper-selector.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `agent/test/paper-selector.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { jaccardDistance, buildFeatureSet, selectPairs } from "~/paper-selector";
import type { PaperAnalysis } from "~/schema";

function makePaper(overrides: Partial<PaperAnalysis> & { paper_id: string }): PaperAnalysis {
	return {
		tags: ["tag-a", "tag-b", "tag-c", "tag-d", "tag-e"],
		categories: { primary: "cs.AI", secondary: [] },
		classification: { research_type: "empirical", contribution_type: [], maturity: "preprint", domain: "AI" },
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
			classification: { research_type: "empirical", contribution_type: [], maturity: "preprint", domain: "computational creativity" },
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
				classification: { research_type: "empirical", contribution_type: [], maturity: "preprint", domain: i < 5 ? "AI" : "NLP" },
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
				classification: { research_type: "empirical", contribution_type: [], maturity: "preprint", domain: "AI" },
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
				classification: { research_type: "empirical", contribution_type: [], maturity: "preprint", domain: "AI" },
			}),
		);
		const pairs = selectPairs(papers);
		expect(pairs.length).toBeLessThanOrEqual(2);
		expect(pairs.length).toBeGreaterThan(0);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd agent && npx vitest run test/paper-selector.test.ts
```

Expected: FAIL — `Cannot find module '~/paper-selector'`

- [ ] **Step 3: Write minimal implementation**

Create `agent/src/paper-selector.ts`:

```typescript
import type { PaperAnalysis } from "~/schema";

export function jaccardDistance(a: Set<string>, b: Set<string>): number {
	if (a.size === 0 && b.size === 0) return 0;
	let intersection = 0;
	for (const item of a) {
		if (b.has(item)) intersection++;
	}
	const union = a.size + b.size - intersection;
	return 1 - intersection / union;
}

export function buildFeatureSet(paper: PaperAnalysis): Set<string> {
	const features = new Set<string>();
	for (const tag of paper.tags) features.add(tag);
	features.add(paper.categories.primary);
	features.add(paper.classification.domain);
	return features;
}

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
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd agent && npx vitest run test/paper-selector.test.ts
```

Expected: PASS (3 suites, 6 tests)

- [ ] **Step 5: Commit**

```bash
git add agent/src/paper-selector.ts agent/test/paper-selector.test.ts
git commit -m "feat: add Jaccard-based paper pair selector (Stella: pure math, no LLM)"
```

---

## Task 4: Prompt Builder (`prompt.ts`)

**Files:**
- Create: `agent/src/prompt.ts`
- Create: `agent/test/prompt.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `agent/test/prompt.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { buildSystemPrompt, buildIdeaPrompt } from "~/prompt";
import type { PaperAnalysis } from "~/schema";

function makePaper(overrides: Partial<PaperAnalysis> & { paper_id: string }): PaperAnalysis {
	return {
		tags: ["tag-a", "tag-b", "tag-c", "tag-d", "tag-e"],
		categories: { primary: "cs.AI", secondary: [] },
		classification: { research_type: "empirical", contribution_type: [], maturity: "preprint", domain: "AI" },
		topic: { what: "Does X.", how: "Via Y.", why_matters: "Because Z." },
		applicability: { good_for: ["A"], not_for: ["B"], requires: ["C"] },
		novelty: ["First to do X"],
		open_problems: ["How to scale X"],
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
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd agent && npx vitest run test/prompt.test.ts
```

Expected: FAIL — `Cannot find module '~/prompt'`

- [ ] **Step 3: Write minimal implementation**

Create `agent/src/prompt.ts`:

```typescript
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

export function buildIdeaPrompt(userTopic: string, paperA: PaperAnalysis, paperB: PaperAnalysis): string {
	return `# User's Problem / Topic

${userTopic}

# Papers to Combine

${formatPaper("Paper A", paperA)}

${formatPaper("Paper B", paperB)}

# Task

Generate a novel research idea that combines insights from Paper A and Paper B to address the user's problem/topic. Respond with the JSON structure specified in your instructions.`;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd agent && npx vitest run test/prompt.test.ts
```

Expected: PASS (2 suites, 4 tests)

- [ ] **Step 5: Commit**

```bash
git add agent/src/prompt.ts agent/test/prompt.test.ts
git commit -m "feat: add system prompt and per-call prompt builder for idea generation"
```

---

## Task 5: Sample Paper Data

**Files:**
- Create: `agent/data/papers/` directory with 10 JSON files

- [ ] **Step 1: Create the data directory**

```bash
mkdir -p agent/data/papers
```

- [ ] **Step 2: Create 10 sample paper JSONs**

These are hand-crafted from the real KB research-batch data, transformed into the PaperAnalysis schema. Each file is named by arxiv ID. Create the following 10 files in `agent/data/papers/`:

`agent/data/papers/arxiv-2509.21043v1.json`:
```json
{
  "paper_id": "arxiv:2509.21043v1",
  "tags": ["combinatorial-creativity", "novelty-utility", "scaling-laws", "llm-evaluation", "generalization"],
  "categories": { "primary": "cs.AI", "secondary": ["cs.CL"] },
  "classification": { "research_type": "empirical", "contribution_type": ["benchmark", "analysis"], "maturity": "preprint", "domain": "computational creativity" },
  "topic": {
    "what": "Introduces combinatorial creativity as a distinct generalization ability with a fundamental novelty-utility tradeoff.",
    "how": "Proposes scaling-law analysis of creativity and depth/width sweeps across LLMs.",
    "why_matters": "Shows that even at scale, LLM creativity hits a Pareto frontier — the ideation-execution gap is real."
  },
  "applicability": { "good_for": ["evaluating creative AI", "understanding LLM limits"], "not_for": ["routine generation tasks"], "requires": ["large-scale LLM access"] },
  "novelty": ["Identifies fundamental novelty-utility tradeoff in LLMs", "Maps creativity as a generalization axis distinct from accuracy"],
  "open_problems": ["How to shift the Pareto frontier", "Whether fine-tuning can overcome the tradeoff"]
}
```

`agent/data/papers/arxiv-2409.04109v1.json`:
```json
{
  "paper_id": "arxiv:2409.04109v1",
  "tags": ["llm-ideation", "human-evaluation", "research-ideas", "novelty-assessment", "expert-study"],
  "categories": { "primary": "cs.CL", "secondary": ["cs.AI"] },
  "classification": { "research_type": "empirical", "contribution_type": ["benchmark", "analysis"], "maturity": "preprint", "domain": "NLP" },
  "topic": {
    "what": "Evaluates whether LLMs can generate novel research ideas via a large-scale human study.",
    "how": "100+ NLP researchers blind-rate LLM ideas vs human ideas on novelty, feasibility, and impact.",
    "why_matters": "LLM ideas rated as more novel than expert ideas, but less feasible — first large-scale evidence."
  },
  "applicability": { "good_for": ["benchmarking AI creativity", "research augmentation"], "not_for": ["replacing human researchers"], "requires": ["expert evaluators"] },
  "novelty": ["First large-scale blind comparison of LLM vs human research ideas", "Quantifies the novelty-feasibility gap"],
  "open_problems": ["How to improve feasibility of LLM ideas", "Whether novelty ratings generalize beyond NLP"]
}
```

`agent/data/papers/arxiv-2310.06775v1.json`:
```json
{
  "paper_id": "arxiv:2310.06775v1",
  "tags": ["tree-of-thoughts", "deliberate-reasoning", "problem-solving", "search-algorithms", "llm-planning"],
  "categories": { "primary": "cs.AI", "secondary": ["cs.CL"] },
  "classification": { "research_type": "systems", "contribution_type": ["framework", "algorithm"], "maturity": "conference", "domain": "agentic reasoning" },
  "topic": {
    "what": "Introduces Tree of Thoughts, enabling LLMs to explore multiple reasoning paths via tree search.",
    "how": "Generates candidate thoughts at each step, evaluates them, and uses BFS/DFS to explore the solution space.",
    "why_matters": "Transforms LLM reasoning from linear chain-of-thought to deliberate exploration with backtracking."
  },
  "applicability": { "good_for": ["complex multi-step reasoning", "creative problem solving"], "not_for": ["simple factual QA"], "requires": ["multiple LLM calls per problem"] },
  "novelty": ["First to apply classical search algorithms to LLM reasoning", "Enables backtracking in language model problem-solving"],
  "open_problems": ["Cost of multiple LLM calls", "Optimal branching factor selection"]
}
```

`agent/data/papers/arxiv-2303.17651v1.json`:
```json
{
  "paper_id": "arxiv:2303.17651v1",
  "tags": ["self-refine", "iterative-refinement", "feedback-loop", "llm-self-improvement", "no-training"],
  "categories": { "primary": "cs.CL", "secondary": ["cs.AI"] },
  "classification": { "research_type": "empirical", "contribution_type": ["framework", "technique"], "maturity": "conference", "domain": "agentic reasoning" },
  "topic": {
    "what": "Proposes Self-Refine: LLMs iteratively improve their own outputs via self-generated feedback.",
    "how": "Generate → critique → refine loop without any training, supervised data, or reward models.",
    "why_matters": "Shows LLMs can substantially improve output quality through multi-turn self-feedback alone."
  },
  "applicability": { "good_for": ["code generation", "creative writing", "reasoning tasks"], "not_for": ["tasks where first draft is already optimal"], "requires": ["sufficiently capable base LLM"] },
  "novelty": ["Demonstrates training-free self-improvement via iterative feedback", "No external reward model needed"],
  "open_problems": ["Convergence guarantees", "When self-critique fails (hallucinated improvements)"]
}
```

`agent/data/papers/arxiv-2305.14325v1.json`:
```json
{
  "paper_id": "arxiv:2305.14325v1",
  "tags": ["graph-of-thoughts", "reasoning-topology", "graph-algorithms", "thought-transformations", "llm-architecture"],
  "categories": { "primary": "cs.AI", "secondary": ["cs.CL", "cs.DS"] },
  "classification": { "research_type": "systems", "contribution_type": ["framework", "algorithm"], "maturity": "conference", "domain": "agentic reasoning" },
  "topic": {
    "what": "Extends Tree-of-Thoughts to arbitrary graph structures for LLM reasoning.",
    "how": "Models thoughts as vertices in a directed graph with aggregation, refinement, and generation operations.",
    "why_matters": "Enables merging partial solutions and non-linear reasoning paths, improving on tree-only approaches."
  },
  "applicability": { "good_for": ["complex reasoning with mergeable sub-solutions", "sorting and set operations"], "not_for": ["simple linear reasoning"], "requires": ["graph execution controller"] },
  "novelty": ["First to model LLM reasoning as arbitrary directed graphs", "Introduces thought aggregation operations"],
  "open_problems": ["Automated graph topology design", "Scaling to very large thought graphs"]
}
```

`agent/data/papers/arxiv-2402.11453v1.json`:
```json
{
  "paper_id": "arxiv:2402.11453v1",
  "tags": ["research-agent", "automated-research", "literature-review", "multi-step-reasoning", "knowledge-synthesis"],
  "categories": { "primary": "cs.AI", "secondary": ["cs.CL", "cs.IR"] },
  "classification": { "research_type": "systems", "contribution_type": ["framework", "tool"], "maturity": "preprint", "domain": "AI-assisted research" },
  "topic": {
    "what": "ResearchAgent automates the full research ideation pipeline: review, plan, experiment design, writeup.",
    "how": "Multi-agent pipeline with core, reviewer, and academic search integration; iterative refinement loop.",
    "why_matters": "First end-to-end agent for research ideation that connects literature review to experiment design."
  },
  "applicability": { "good_for": ["research ideation", "literature synthesis", "experiment planning"], "not_for": ["executing actual experiments"], "requires": ["academic search API access"] },
  "novelty": ["End-to-end research pipeline from survey to experiment design", "Integrates real-time literature search"],
  "open_problems": ["Evaluation of generated research proposals", "Avoiding circular reasoning in self-review"]
}
```

`agent/data/papers/arxiv-2408.09776v1.json`:
```json
{
  "paper_id": "arxiv:2408.09776v1",
  "tags": ["scideator", "scientific-ideation", "concept-recombination", "retrieval-augmented", "faceted-generation"],
  "categories": { "primary": "cs.CL", "secondary": ["cs.AI", "cs.DL"] },
  "classification": { "research_type": "systems", "contribution_type": ["tool", "framework"], "maturity": "preprint", "domain": "computational creativity" },
  "topic": {
    "what": "Scideator: a tool for scientific ideation through faceted retrieval and recombination of research concepts.",
    "how": "Decomposes papers into four facets (purpose, mechanism, evaluation, finding), retrieves analogous facets from other papers, and recombines them.",
    "why_matters": "Operationalizes the theory of conceptual combination for scientific discovery with retrieval grounding."
  },
  "applicability": { "good_for": ["scientific ideation", "cross-domain inspiration"], "not_for": ["ideation without a seed paper"], "requires": ["facet-annotated paper corpus"] },
  "novelty": ["Faceted decomposition for structured concept recombination", "Retrieval-grounded ideation (not pure generation)"],
  "open_problems": ["Scaling facet extraction beyond Semantic Scholar corpus", "Quality of cross-domain facet matching"]
}
```

`agent/data/papers/arxiv-2406.13155v1.json`:
```json
{
  "paper_id": "arxiv:2406.13155v1",
  "tags": ["multi-agent-debate", "consensus-building", "diverse-perspectives", "reasoning-improvement", "llm-collaboration"],
  "categories": { "primary": "cs.AI", "secondary": ["cs.MA", "cs.CL"] },
  "classification": { "research_type": "empirical", "contribution_type": ["technique", "analysis"], "maturity": "conference", "domain": "multi-agent systems" },
  "topic": {
    "what": "Studies multi-agent debate as a mechanism for improving LLM reasoning through diverse perspectives.",
    "how": "Multiple LLM agents debate a question, presenting arguments and counterarguments until consensus.",
    "why_matters": "Shows that adversarial multi-agent dynamics can correct individual LLM errors and improve accuracy."
  },
  "applicability": { "good_for": ["fact verification", "complex reasoning", "reducing hallucinations"], "not_for": ["latency-sensitive applications"], "requires": ["multiple LLM instances"] },
  "novelty": ["Systematic study of debate dynamics among LLM agents", "Shows diversity of initial positions improves final accuracy"],
  "open_problems": ["Optimal number of agents", "Preventing convergence to incorrect consensus"]
}
```

`agent/data/papers/arxiv-2310.02304v1.json`:
```json
{
  "paper_id": "arxiv:2310.02304v1",
  "tags": ["mixture-of-agents", "layered-architecture", "llm-collaboration", "quality-amplification", "ensemble-methods"],
  "categories": { "primary": "cs.CL", "secondary": ["cs.AI", "cs.LG"] },
  "classification": { "research_type": "empirical", "contribution_type": ["framework", "technique"], "maturity": "preprint", "domain": "multi-agent systems" },
  "topic": {
    "what": "Mixture-of-Agents (MoA): a layered architecture where each LLM layer refines outputs from the previous layer.",
    "how": "Multiple LLMs in each layer generate responses; next-layer LLMs see all prior outputs as context for refinement.",
    "why_matters": "Achieves quality beyond any single model by leveraging the collaborativeness of LLMs across layers."
  },
  "applicability": { "good_for": ["maximizing output quality", "combining diverse model strengths"], "not_for": ["low-latency applications", "single-query use"], "requires": ["multiple LLM API keys", "orchestration layer"] },
  "novelty": ["Layered LLM refinement architecture", "Formal analysis of LLM collaborativeness property"],
  "open_problems": ["Reducing layer count while maintaining quality", "Cost-quality Pareto optimization"]
}
```

`agent/data/papers/arxiv-2407.08837v1.json`:
```json
{
  "paper_id": "arxiv:2407.08837v1",
  "tags": ["sciagents", "graph-reasoning", "knowledge-graph", "multi-agent-discovery", "ontology-driven"],
  "categories": { "primary": "cs.AI", "secondary": ["cs.MA", "cs.CL"] },
  "classification": { "research_type": "systems", "contribution_type": ["framework", "tool"], "maturity": "preprint", "domain": "AI-assisted research" },
  "topic": {
    "what": "SciAgents: multi-agent system for scientific discovery driven by knowledge graph reasoning.",
    "how": "Agents traverse an ontology-grounded knowledge graph, identify distant concept pairs, and generate hypotheses.",
    "why_matters": "Shows that graph-structured knowledge enables more systematic and traceable scientific ideation than flat retrieval."
  },
  "applicability": { "good_for": ["cross-domain hypothesis generation", "materials science discovery"], "not_for": ["domains without structured ontologies"], "requires": ["domain knowledge graph", "multi-agent orchestrator"] },
  "novelty": ["Ontology-driven agent traversal for ideation", "Combines graph reasoning with LLM generation"],
  "open_problems": ["Building ontologies for new domains", "Evaluating generated hypotheses experimentally"]
}
```

- [ ] **Step 3: Create a barrel export for paper loading**

Create `agent/src/papers.ts`:

```typescript
import type { PaperAnalysis } from "~/schema";
import { PaperAnalysisSchema } from "~/schema";

import paper0 from "../data/papers/arxiv-2509.21043v1.json";
import paper1 from "../data/papers/arxiv-2409.04109v1.json";
import paper2 from "../data/papers/arxiv-2310.06775v1.json";
import paper3 from "../data/papers/arxiv-2303.17651v1.json";
import paper4 from "../data/papers/arxiv-2305.14325v1.json";
import paper5 from "../data/papers/arxiv-2402.11453v1.json";
import paper6 from "../data/papers/arxiv-2408.09776v1.json";
import paper7 from "../data/papers/arxiv-2406.13155v1.json";
import paper8 from "../data/papers/arxiv-2310.02304v1.json";
import paper9 from "../data/papers/arxiv-2407.08837v1.json";

const rawPapers = [paper0, paper1, paper2, paper3, paper4, paper5, paper6, paper7, paper8, paper9];

let cachedPapers: PaperAnalysis[] | null = null;

export function loadPapers(): PaperAnalysis[] {
	if (cachedPapers) return cachedPapers;
	cachedPapers = rawPapers.map((p) => PaperAnalysisSchema.parse(p));
	return cachedPapers;
}
```

- [ ] **Step 4: Commit**

```bash
git add agent/data/papers/ agent/src/papers.ts
git commit -m "feat: add 10 sample paper analyses and loader module"
```

---

## Task 6: IdeatorAgent Durable Object (`ideator-agent.ts`)

**Files:**
- Create: `agent/src/ideator-agent.ts`

- [ ] **Step 1: Write the IdeatorAgent**

Create `agent/src/ideator-agent.ts`:

```typescript
import { AIChatAgent } from "agents/ai-chat-agent";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { streamText } from "ai";
import type { StreamTextOnFinishCallback, ToolSet } from "ai";
import { loadPapers } from "~/papers";
import { selectPairs } from "~/paper-selector";
import { buildSystemPrompt, buildIdeaPrompt } from "~/prompt";
import { IdeaCardSchema } from "~/schema";
import type { IdeaCard } from "~/schema";

interface Env {
	DEEPSEEK_API_KEY: string;
	AIG_GATEWAY_ID: string;
	CLOUDFLARE_ACCOUNT_ID: string;
}

export class IdeatorAgent extends AIChatAgent<Env> {
	async onChatMessage(
		onFinish: StreamTextOnFinishCallback<ToolSet>,
		options?: { abortSignal: AbortSignal | undefined },
	): Promise<Response> {
		const lastMessage = this.messages.at(-1);
		if (!lastMessage || lastMessage.role !== "user") {
			return new Response("No user message found", { status: 400 });
		}

		const userTopic =
			typeof lastMessage.content === "string"
				? lastMessage.content
				: lastMessage.content
						.filter((p): p is Extract<typeof p, { type: "text" }> => p.type === "text")
						.map((p) => p.text)
						.join(" ");

		const papers = loadPapers();
		const pairs = selectPairs(papers);

		const deepseek = createOpenAICompatible({
			name: "deepseek",
			baseURL: `https://gateway.ai.cloudflare.com/v1/${this.env.CLOUDFLARE_ACCOUNT_ID}/${this.env.AIG_GATEWAY_ID}/deepseek`,
			apiKey: this.env.DEEPSEEK_API_KEY,
		});

		const systemPrompt = buildSystemPrompt();
		const ideaPromises = pairs.map(([paperA, paperB]) => {
			const userPrompt = buildIdeaPrompt(userTopic, paperA, paperB);
			return streamText({
				model: deepseek("deepseek-chat"),
				system: systemPrompt,
				prompt: userPrompt,
				abortSignal: options?.abortSignal,
				maxTokens: 1024,
			});
		});

		const results = await Promise.all(ideaPromises);
		const ideas: IdeaCard[] = [];

		for (const result of results) {
			const text = await result.text;
			try {
				const jsonMatch = text.match(/\{[\s\S]*\}/);
				if (jsonMatch) {
					const parsed = IdeaCardSchema.parse(JSON.parse(jsonMatch[0]));
					ideas.push(parsed);
				}
			} catch {
				// skip malformed ideas
			}
		}

		const responseText = ideas
			.map(
				(idea, i) =>
					`## Idea ${i + 1}: ${idea.title}\n\n` +
					`**Paper A** (${idea.paper_a.id}): ${idea.paper_a.insight}\n\n` +
					`**Paper B** (${idea.paper_b.id}): ${idea.paper_b.insight}\n\n` +
					`**Combined Idea:** ${idea.combined_idea}\n\n` +
					`**Why Novel:** ${idea.why_novel}\n\n` +
					`**Applications:** ${idea.potential_applications.join(", ")}\n\n` +
					`**Scores:** Novelty ${idea.scores.novelty}/10 | Feasibility ${idea.scores.feasibility}/10 | Impact ${idea.scores.impact}/10`,
			)
			.join("\n\n---\n\n");

		const finalResponse = ideas.length > 0
			? responseText
			: "I couldn't generate ideas from the paper pairs. Please try rephrasing your topic.";

		return streamText({
			model: deepseek("deepseek-chat"),
			prompt: finalResponse,
			system: "Repeat the following text exactly as given. Do not modify, summarize, or add anything.",
			abortSignal: options?.abortSignal,
			onFinish,
		}).toDataStreamResponse();
	}
}
```

- [ ] **Step 2: Commit**

```bash
git add agent/src/ideator-agent.ts
git commit -m "feat: add IdeatorAgent DO — orchestrates paper selection + parallel idea generation"
```

---

## Task 7: Worker Entrypoint (`index.ts`)

**Files:**
- Create: `agent/src/index.ts`

- [ ] **Step 1: Write the Worker entrypoint**

Create `agent/src/index.ts`:

```typescript
import { routeAgentRequest } from "agents";
import { IdeatorAgent } from "~/ideator-agent";

interface Env {
	IDEATOR: DurableObjectNamespace;
	DEEPSEEK_API_KEY: string;
	AIG_GATEWAY_ID: string;
	CLOUDFLARE_ACCOUNT_ID: string;
}

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const url = new URL(request.url);

		if (url.pathname === "/" || url.pathname === "/index.html") {
			return new Response(getIndexHtml(), {
				headers: { "Content-Type": "text/html; charset=utf-8" },
			});
		}

		const agentResponse = await routeAgentRequest(request, env, { cors: true });
		if (agentResponse) return agentResponse;

		return new Response("Not Found", { status: 404 });
	},
} satisfies ExportedHandler<Env>;

export { IdeatorAgent };

function getIndexHtml(): string {
	return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>AI Ideator</title>
	<script src="https://cdn.tailwindcss.com"></script>
	<script type="importmap">
	{
		"imports": {
			"react": "https://esm.sh/react@19",
			"react-dom/client": "https://esm.sh/react-dom@19/client",
			"react/jsx-runtime": "https://esm.sh/react@19/jsx-runtime",
			"partysocket": "https://esm.sh/partysocket@1.1.3",
			"partysocket/react": "https://esm.sh/partysocket@1.1.3/react",
			"agents/react": "https://esm.sh/agents@0.0.80/react",
			"agents/ai-react": "https://esm.sh/agents@0.0.80/ai-react"
		}
	}
	</script>
</head>
<body class="bg-gray-950 text-gray-100 min-h-screen">
	<div id="root"></div>
	<script type="module">
		import React from "react";
		import { createElement as h, useState } from "react";
		import { createRoot } from "react-dom/client";
		import { useAgent } from "agents/react";
		import { useAgentChat } from "agents/ai-react";

		function IdeaCard({ idea }) {
			const scores = idea.scores || {};
			return h("div", { className: "bg-gray-800 rounded-xl p-6 border border-gray-700 space-y-4" },
				h("h3", { className: "text-xl font-bold text-blue-400" }, idea.title),
				h("div", { className: "grid grid-cols-2 gap-4 text-sm" },
					h("div", { className: "bg-gray-900 rounded-lg p-3" },
						h("div", { className: "text-gray-400 text-xs mb-1" }, "Paper A — " + (idea.paper_a?.id || "")),
						h("div", null, idea.paper_a?.insight || "")
					),
					h("div", { className: "bg-gray-900 rounded-lg p-3" },
						h("div", { className: "text-gray-400 text-xs mb-1" }, "Paper B — " + (idea.paper_b?.id || "")),
						h("div", null, idea.paper_b?.insight || "")
					)
				),
				h("div", null,
					h("h4", { className: "text-sm font-semibold text-gray-400 mb-1" }, "Combined Idea"),
					h("p", null, idea.combined_idea)
				),
				h("div", null,
					h("h4", { className: "text-sm font-semibold text-gray-400 mb-1" }, "Why Novel"),
					h("p", { className: "text-gray-300" }, idea.why_novel)
				),
				idea.potential_applications && h("div", { className: "flex flex-wrap gap-2" },
					...idea.potential_applications.map((app, i) =>
						h("span", { key: i, className: "bg-gray-700 text-gray-300 px-3 py-1 rounded-full text-xs" }, app)
					)
				),
				h("div", { className: "flex gap-4 pt-2" },
					h("span", { className: "bg-purple-900/50 text-purple-300 px-3 py-1 rounded-full text-xs" }, "Novelty " + (scores.novelty || "?") + "/10"),
					h("span", { className: "bg-green-900/50 text-green-300 px-3 py-1 rounded-full text-xs" }, "Feasibility " + (scores.feasibility || "?") + "/10"),
					h("span", { className: "bg-orange-900/50 text-orange-300 px-3 py-1 rounded-full text-xs" }, "Impact " + (scores.impact || "?") + "/10")
				)
			);
		}

		function parseIdeas(text) {
			const ideas = [];
			const sections = text.split(/---/);
			for (const section of sections) {
				const titleMatch = section.match(/## Idea \\d+: (.+)/);
				const paperAMatch = section.match(/\\*\\*Paper A\\*\\* \\(([^)]+)\\): (.+)/);
				const paperBMatch = section.match(/\\*\\*Paper B\\*\\* \\(([^)]+)\\): (.+)/);
				const combinedMatch = section.match(/\\*\\*Combined Idea:\\*\\* (.+)/);
				const novelMatch = section.match(/\\*\\*Why Novel:\\*\\* (.+)/);
				const appsMatch = section.match(/\\*\\*Applications:\\*\\* (.+)/);
				const scoresMatch = section.match(/Novelty (\\d+)\\/10 \\| Feasibility (\\d+)\\/10 \\| Impact (\\d+)\\/10/);
				if (titleMatch && combinedMatch) {
					ideas.push({
						title: titleMatch[1],
						paper_a: paperAMatch ? { id: paperAMatch[1], insight: paperAMatch[2] } : null,
						paper_b: paperBMatch ? { id: paperBMatch[1], insight: paperBMatch[2] } : null,
						combined_idea: combinedMatch[1],
						why_novel: novelMatch ? novelMatch[1] : "",
						potential_applications: appsMatch ? appsMatch[1].split(", ") : [],
						scores: scoresMatch ? { novelty: +scoresMatch[1], feasibility: +scoresMatch[2], impact: +scoresMatch[3] } : {}
					});
				}
			}
			return ideas;
		}

		function App() {
			const agent = useAgent({ agent: "ideator" });
			const { messages, input, handleInputChange, handleSubmit, status } = useAgentChat({ agent });
			const isLoading = status === "streaming" || status === "submitted";

			return h("div", { className: "max-w-4xl mx-auto px-4 py-8 min-h-screen flex flex-col" },
				h("header", { className: "text-center mb-8" },
					h("h1", { className: "text-4xl font-bold bg-gradient-to-r from-blue-400 to-purple-500 bg-clip-text text-transparent" }, "AI Ideator"),
					h("p", { className: "text-gray-400 mt-2" }, "Combine arXiv papers to generate novel research ideas")
				),
				h("div", { className: "flex-1 space-y-6 mb-8" },
					...messages.map((msg, i) => {
						if (msg.role === "user") {
							return h("div", { key: i, className: "bg-blue-900/30 rounded-xl p-4 border border-blue-800/50" },
								h("div", { className: "text-xs text-blue-400 mb-1" }, "Your topic"),
								h("p", null, typeof msg.content === "string" ? msg.content : "")
							);
						}
						const text = typeof msg.content === "string" ? msg.content : "";
						const ideas = parseIdeas(text);
						if (ideas.length > 0) {
							return h("div", { key: i, className: "space-y-4" },
								...ideas.map((idea, j) => h(IdeaCard, { key: j, idea }))
							);
						}
						return h("div", { key: i, className: "bg-gray-800 rounded-xl p-4" },
							h("pre", { className: "whitespace-pre-wrap text-sm" }, text)
						);
					}),
					isLoading && h("div", { className: "space-y-4" },
						...[0,1,2,3].map(i =>
							h("div", { key: i, className: "bg-gray-800 rounded-xl p-6 border border-gray-700 animate-pulse" },
								h("div", { className: "h-6 bg-gray-700 rounded w-2/3 mb-4" }),
								h("div", { className: "h-4 bg-gray-700 rounded w-full mb-2" }),
								h("div", { className: "h-4 bg-gray-700 rounded w-5/6" })
							)
						)
					)
				),
				h("form", { onSubmit: handleSubmit, className: "sticky bottom-4 flex gap-3" },
					h("input", {
						value: input,
						onChange: handleInputChange,
						placeholder: "Describe a problem or research topic...",
						className: "flex-1 bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-gray-100 placeholder-gray-500 focus:outline-none focus:border-blue-500",
						disabled: isLoading
					}),
					h("button", {
						type: "submit",
						disabled: isLoading || !input.trim(),
						className: "bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 disabled:text-gray-500 text-white px-6 py-3 rounded-xl font-medium transition-colors"
					}, isLoading ? "Generating..." : "Ideate")
				)
			);
		}

		createRoot(document.getElementById("root")).render(h(App));
	</script>
</body>
</html>`;
}
```

- [ ] **Step 2: Commit**

```bash
git add agent/src/index.ts
git commit -m "feat: add Worker entrypoint with inline HTML frontend and agent routing"
```

---

## Task 8: Vitest Configuration

**Files:**
- Create: `agent/vitest.config.ts`

- [ ] **Step 1: Create vitest config**

Create `agent/vitest.config.ts`:

```typescript
import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
	test: {
		globals: true,
		poolOptions: {
			workers: {
				wrangler: { configPath: "./wrangler.jsonc" },
			},
		},
	},
	resolve: {
		alias: {
			"~": new URL("./src", import.meta.url).pathname,
		},
	},
});
```

- [ ] **Step 2: Verify all tests pass**

```bash
cd agent && npx vitest run
```

Expected: PASS — 3 test files, 14 tests total.

- [ ] **Step 3: Commit**

```bash
git add agent/vitest.config.ts
git commit -m "chore: add vitest config with Workers pool and path aliases"
```

---

## Task 9: Environment Setup & Local Dev Verification

**Files:**
- Create: `agent/.dev.vars`

- [ ] **Step 1: Create .dev.vars for local development secrets**

Create `agent/.dev.vars` (this file is .gitignored — never commit):

```
DEEPSEEK_API_KEY=your-key-here
CLOUDFLARE_ACCOUNT_ID=your-account-id-here
```

- [ ] **Step 2: Ensure .dev.vars is gitignored**

Check/add to `agent/.gitignore`:

```bash
echo ".dev.vars" >> agent/.gitignore
```

- [ ] **Step 3: Run lint**

```bash
cd agent && npx biome check .
```

Fix any lint issues.

- [ ] **Step 4: Run typecheck**

```bash
cd agent && npx tsc --noEmit
```

Fix any type errors.

- [ ] **Step 5: Run all tests**

```bash
cd agent && npx vitest run
```

Expected: All tests pass.

- [ ] **Step 6: Start dev server for manual verification**

```bash
cd agent && npx wrangler dev
```

Open `http://localhost:8787` in a browser. Verify:
- The HTML page loads with "AI Ideator" header
- Input field and "Ideate" button are visible
- Submitting a topic generates idea cards (requires valid DeepSeek key in `.dev.vars`)

- [ ] **Step 7: Commit**

```bash
git add agent/.gitignore
git commit -m "chore: add .dev.vars to gitignore, verify local dev setup"
```

---

## Task 10: Final Integration Test & Cleanup

**Files:**
- Modify: `agent/src/ideator-agent.ts` (if needed based on testing)
- Modify: `agent/src/index.ts` (if needed based on testing)

- [ ] **Step 1: Run full test suite**

```bash
cd agent && npx vitest run && npx tsc --noEmit && npx biome check .
```

All three must pass.

- [ ] **Step 2: Manual end-to-end test**

Start `npx wrangler dev`, open browser, submit a topic. Verify:
1. 4 idea cards appear (or fewer if corpus is small)
2. Each card shows: title, paper insights, combined idea, why novel, applications, scores
3. Loading skeletons appear during generation
4. No console errors

- [ ] **Step 3: Final commit**

```bash
git add -A
git commit -m "feat: complete MVP ideator agent — paper selection, idea generation, chat UI"
```

---

## Dependency Summary

| Task | Depends On |
|------|-----------|
| Task 1 (deps/config) | — |
| Task 2 (schemas) | Task 1 |
| Task 3 (paper selector) | Task 2 |
| Task 4 (prompts) | Task 2 |
| Task 5 (paper data) | Task 2 |
| Task 6 (agent DO) | Tasks 2, 3, 4, 5 |
| Task 7 (entrypoint) | Task 6 |
| Task 8 (vitest config) | Task 1 |
| Task 9 (env setup) | Task 7, 8 |
| Task 10 (integration) | Task 9 |

Tasks 3, 4, and 5 can run in parallel after Task 2. Task 8 can run in parallel with Tasks 2-5.
