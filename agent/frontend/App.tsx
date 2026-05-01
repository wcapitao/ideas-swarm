import { useAgentChat } from "agents/ai-react";
import { useAgent } from "agents/react";
import { type FormEvent, useCallback, useEffect, useMemo, useRef } from "react";

function generateSessionId(): string {
	return `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

const sessionId = generateSessionId();

// ── Parser types ──

interface ParsedScores {
	novelty: number;
	feasibility: number;
	impact: number;
}

interface ParsedEvaluation {
	verdict: "promising" | "needs_validation" | "risky";
	assessment: string;
	adjustedScores: ParsedScores;
	evidenceGaps: string[];
	safetyFlags: string[];
}

interface ParsedIdeaCard {
	number: number;
	title: string;
	paperA: { id: string; insight: string } | null;
	paperB: { id: string; insight: string } | null;
	combinedIdea: string;
	whyNovel: string;
	applications: string[];
	scores: ParsedScores;
	evaluation: ParsedEvaluation | null;
}

interface ParsedResponse {
	topic: string;
	generatedCount: string;
	cards: ParsedIdeaCard[];
}

// ── Parser ──

function extractSection(text: string, name: string): string {
	const pattern = new RegExp(`### ${name}\\s*\\n([\\s\\S]*?)(?=\\n### |\\n## |$)`);
	return text.match(pattern)?.[1]?.trim() ?? "";
}

function extractScore(text: string, label: string): number {
	const match = text.match(new RegExp(`${label}:.*?(\\d+)\\/10`));
	return match ? Number.parseInt(match[1], 10) : 0;
}

function parseEvaluation(text: string): ParsedEvaluation | null {
	if (!text) return null;
	const verdictMatch = text.match(/\*\*Verdict:\*\*\s*(promising|needs[_ ]validation|risky)/i);
	if (!verdictMatch) return null;

	const verdict = verdictMatch[1].toLowerCase().replace(/\s+/g, "_") as ParsedEvaluation["verdict"];
	const assessment = text.match(/\*\*Assessment:\*\*\s*(.+)/)?.[1]?.trim() ?? "";

	const adjText = text.match(/\*\*Adjusted Scores\*\*\n([\s\S]*?)(?=\n\*\*|$)/)?.[1] ?? "";
	const adjustedScores: ParsedScores = {
		novelty: extractScore(adjText, "Novelty"),
		feasibility: extractScore(adjText, "Feasibility"),
		impact: extractScore(adjText, "Impact"),
	};

	const gapsRaw = text.match(/\*\*Evidence gaps:\*\*\n([\s\S]*?)(?=\n\*\*|$)/)?.[1]?.trim() ?? "";
	const evidenceGaps =
		gapsRaw === "*(none)*" || !gapsRaw
			? []
			: gapsRaw
					.split("\n")
					.filter((l) => l.startsWith("- "))
					.map((l) => l.slice(2).trim());

	const flagsRaw =
		text.match(/\*\*Safety flags:\*\*\n([\s\S]*?)(?=\n\*\*|\n## |$)/)?.[1]?.trim() ?? "";
	const safetyFlags =
		flagsRaw === "*(none)*" || !flagsRaw
			? []
			: flagsRaw
					.split("\n")
					.filter((l) => l.startsWith("- "))
					.map((l) => l.slice(2).trim());

	return { verdict, assessment, adjustedScores, evidenceGaps, safetyFlags };
}

function parseIdeaResponse(content: string): ParsedResponse | null {
	if (!content.includes("## Idea ")) return null;

	const topic = content.match(/\*\*Topic:\*\*\s*(.+)/)?.[1]?.trim() ?? "";
	const generatedCount = content.match(/\*\*Ideas generated:\*\*\s*(.+)/)?.[1]?.trim() ?? "";

	const headerRegex = /## Idea (\d+): ([^\n]+)/g;
	const matches = [...content.matchAll(headerRegex)];

	const cards: ParsedIdeaCard[] = matches.map((m, idx) => {
		const start = m.index ?? 0;
		const end =
			idx < matches.length - 1 ? (matches[idx + 1].index ?? content.length) : content.length;
		const section = content.slice(start, end);

		const number = Number.parseInt(m[1], 10);
		const title = m[2].trim();

		const paperAMatch = section.match(/\*\*Paper A\*\*\s*\(`([^`]+)`\):\s*(.+)/);
		const paperBMatch = section.match(/\*\*Paper B\*\*\s*\(`([^`]+)`\):\s*(.+)/);
		const paperA = paperAMatch ? { id: paperAMatch[1], insight: paperAMatch[2].trim() } : null;
		const paperB = paperBMatch ? { id: paperBMatch[1], insight: paperBMatch[2].trim() } : null;

		const combinedIdea = extractSection(section, "Combined Idea");
		const whyNovel = extractSection(section, "Why This Is Novel");

		const appsRaw = extractSection(section, "Potential Applications");
		const applications = appsRaw
			.split("\n")
			.filter((l) => l.startsWith("- "))
			.map((l) => l.slice(2).trim());

		const scoresRaw = extractSection(section, "Scores");
		const scores: ParsedScores = {
			novelty: extractScore(scoresRaw, "Novelty"),
			feasibility: extractScore(scoresRaw, "Feasibility"),
			impact: extractScore(scoresRaw, "Impact"),
		};

		const evalRaw = extractSection(section, "Evaluation");
		const evaluation = parseEvaluation(evalRaw);

		return {
			number,
			title,
			paperA,
			paperB,
			combinedIdea,
			whyNovel,
			applications,
			scores,
			evaluation,
		};
	});

	return { topic, generatedCount, cards };
}

// ── Constants ──

const SUGGESTIONS = [
	{
		title: "Gut Microbiome",
		desc: "Novel interventions for gastritis treatment",
		query: "Gut microbiome interventions for gastritis",
	},
	{
		title: "H. pylori",
		desc: "New approaches to eradication therapy",
		query: "Novel approaches to H. pylori eradication",
	},
	{
		title: "Gastric Barrier",
		desc: "Mechanisms for mucosal repair",
		query: "Gastric barrier repair mechanisms",
	},
];

// ── App ──

export function App() {
	const agent = useAgent({ agent: "ideator", name: sessionId });
	const { messages, input, handleInputChange, handleSubmit, append, status, clearHistory } =
		useAgentChat({ agent, streamProtocol: "text" });

	const scrollRef = useRef<HTMLDivElement>(null);
	const textareaRef = useRef<HTMLTextAreaElement>(null);
	const isStreaming = status === "streaming" || status === "submitted";

	// biome-ignore lint/correctness/useExhaustiveDependencies: scroll on new messages
	useEffect(() => {
		scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
	}, [messages]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: resize textarea on input change
	useEffect(() => {
		const ta = textareaRef.current;
		if (!ta) return;
		ta.style.height = "auto";
		ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
	}, [input]);

	const onSubmit = useCallback(
		(e: FormEvent) => {
			e.preventDefault();
			if (!input.trim() || isStreaming) return;
			handleSubmit(e);
		},
		[input, isStreaming, handleSubmit],
	);

	const onKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
		if (e.key === "Enter" && !e.shiftKey) {
			e.preventDefault();
			const form = e.currentTarget.closest("form");
			form?.requestSubmit();
		}
	}, []);

	return (
		<div className="flex flex-col h-screen bg-[#0a0a0b] text-zinc-100">
			<header className="flex items-center justify-between px-6 py-3 border-b border-zinc-800/60 bg-[#0a0a0b]/80 backdrop-blur-sm sticky top-0 z-10">
				<div className="flex items-center gap-3">
					<div className="w-8 h-8 rounded-lg bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center text-sm font-bold text-white">
						AI
					</div>
					<div>
						<h1 className="text-sm font-semibold tracking-tight">AI Ideator</h1>
						<p className="text-[11px] text-zinc-500">Combinatorial creativity engine</p>
					</div>
				</div>
				<button
					type="button"
					onClick={clearHistory}
					className="text-xs text-zinc-500 hover:text-zinc-300 px-3 py-1.5 rounded-lg border border-zinc-800 hover:border-zinc-700 hover:bg-zinc-900 transition-all"
				>
					+ New chat
				</button>
			</header>

			<div ref={scrollRef} className="flex-1 overflow-y-auto scrollbar-thin">
				<div className="max-w-4xl mx-auto px-4 py-6">
					{messages.length === 0 ? (
						<EmptyState onSelect={(q) => append({ role: "user", content: q })} />
					) : (
						<div className="space-y-6">
							{messages.map((msg) => (
								<div key={msg.id}>
									{msg.role === "user" ? (
										<UserMessage content={String(msg.content)} />
									) : (
										<AssistantMessage
											content={String(msg.content)}
											isStreaming={isStreaming && msg.id === messages[messages.length - 1]?.id}
										/>
									)}
								</div>
							))}

							{isStreaming && messages[messages.length - 1]?.role !== "assistant" && (
								<div className="flex items-center gap-2 py-4">
									<div className="flex gap-1">
										<span className="w-2 h-2 bg-amber-500/60 rounded-full animate-bounce [animation-delay:0ms]" />
										<span className="w-2 h-2 bg-amber-500/60 rounded-full animate-bounce [animation-delay:150ms]" />
										<span className="w-2 h-2 bg-amber-500/60 rounded-full animate-bounce [animation-delay:300ms]" />
									</div>
									<span className="text-xs text-zinc-500">Generating ideas...</span>
								</div>
							)}
						</div>
					)}
				</div>
			</div>

			<div className="border-t border-zinc-800/60 bg-[#0a0a0b]/80 backdrop-blur-sm">
				<form onSubmit={onSubmit} className="max-w-4xl mx-auto px-4 py-4">
					<div className="relative flex items-end gap-2 bg-zinc-900 border border-zinc-800 rounded-2xl px-4 py-3 focus-within:border-zinc-600 transition-colors">
						<textarea
							ref={textareaRef}
							value={input}
							onChange={handleInputChange}
							onKeyDown={onKeyDown}
							placeholder="Describe a research topic to explore..."
							aria-label="Research topic"
							disabled={isStreaming}
							rows={1}
							className="flex-1 bg-transparent text-sm placeholder:text-zinc-600 focus:outline-none disabled:opacity-50 resize-none min-h-[24px] max-h-[200px] leading-6"
						/>
						<button
							type="submit"
							disabled={isStreaming || !input.trim()}
							className="shrink-0 w-8 h-8 rounded-lg bg-amber-500 hover:bg-amber-400 disabled:bg-zinc-700 disabled:text-zinc-500 text-black flex items-center justify-center transition-colors"
						>
							{isStreaming ? <SpinnerIcon /> : <ArrowUpIcon />}
						</button>
					</div>
					<p className="text-[11px] text-zinc-600 text-center mt-2">
						Combines insights from research papers to generate novel ideas
					</p>
				</form>
			</div>
		</div>
	);
}

// ── Components ──

function EmptyState({ onSelect }: { onSelect: (query: string) => void }) {
	return (
		<div className="flex flex-col items-center justify-center min-h-[60vh] text-center">
			<div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-amber-500/20 to-orange-600/20 border border-amber-500/20 flex items-center justify-center mb-6">
				<span className="text-3xl">&#x1f9ea;</span>
			</div>
			<h2 className="text-2xl font-semibold text-zinc-200 mb-2">What should we explore?</h2>
			<p className="text-sm text-zinc-500 max-w-md mb-8">
				Enter a research topic and I'll combine insights from different papers to generate novel
				cross-domain ideas.
			</p>
			<div className="grid grid-cols-1 sm:grid-cols-3 gap-3 max-w-2xl w-full">
				{SUGGESTIONS.map((s) => (
					<button
						key={s.query}
						type="button"
						onClick={() => onSelect(s.query)}
						className="text-left p-4 rounded-xl border border-zinc-800 hover:border-zinc-700 bg-zinc-900/50 hover:bg-zinc-900 transition-all group"
					>
						<p className="text-sm font-medium text-zinc-300 group-hover:text-zinc-100 mb-1">
							{s.title}
						</p>
						<p className="text-xs text-zinc-500">{s.desc}</p>
					</button>
				))}
			</div>
		</div>
	);
}

function UserMessage({ content }: { content: string }) {
	return (
		<div className="flex justify-end">
			<div className="bg-zinc-800 rounded-2xl rounded-br-md px-4 py-3 max-w-lg">
				<p className="text-sm leading-relaxed">{content}</p>
			</div>
		</div>
	);
}

function AssistantMessage({ content, isStreaming }: { content: string; isStreaming: boolean }) {
	const parsed = useMemo(() => parseIdeaResponse(content), [content]);

	if (!parsed) {
		return (
			<div className="text-sm text-zinc-300 leading-relaxed whitespace-pre-wrap animate-fade-in">
				{content}
			</div>
		);
	}

	return (
		<div className="space-y-4 animate-fade-in">
			{parsed.topic && (
				<div className="flex flex-wrap items-center gap-3 text-xs text-zinc-500">
					<span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-zinc-900 border border-zinc-800">
						<span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
						{parsed.topic}
					</span>
					{parsed.generatedCount && <span>{parsed.generatedCount}</span>}
				</div>
			)}

			<div className="grid gap-4">
				{parsed.cards.map((card, i) => (
					<IdeaCard key={card.number} card={card} index={i} />
				))}
			</div>

			{isStreaming && (
				<div className="flex items-center gap-2 text-xs text-zinc-500 py-1">
					<SpinnerIcon />
					<span>Generating more ideas...</span>
				</div>
			)}
		</div>
	);
}

const VERDICT_STYLES = {
	promising: {
		bg: "bg-emerald-500/10",
		border: "border-emerald-500/20",
		text: "text-emerald-400",
		dot: "bg-emerald-400",
	},
	needs_validation: {
		bg: "bg-amber-500/10",
		border: "border-amber-500/20",
		text: "text-amber-400",
		dot: "bg-amber-400",
	},
	risky: {
		bg: "bg-red-500/10",
		border: "border-red-500/20",
		text: "text-red-400",
		dot: "bg-red-400",
	},
} as const;

const VERDICT_LABELS: Record<string, string> = {
	promising: "Promising",
	needs_validation: "Needs Validation",
	risky: "Risky",
};

function IdeaCard({ card, index }: { card: ParsedIdeaCard; index: number }) {
	return (
		<div
			className="rounded-xl border border-zinc-800/80 bg-zinc-900/40 overflow-hidden animate-fade-in-up hover:border-zinc-700/80 transition-colors"
			style={{ animationDelay: `${index * 120}ms` }}
		>
			<div className="h-1 bg-gradient-to-r from-amber-500/60 via-orange-500/40 to-transparent" />

			<div className="px-5 pt-4 pb-3">
				<div className="flex items-start gap-3">
					<span className="shrink-0 w-7 h-7 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-xs font-bold text-amber-400">
						{card.number}
					</span>
					<h3 className="text-base font-semibold text-zinc-100 leading-snug pt-0.5">
						{card.title}
					</h3>
				</div>
			</div>

			{(card.paperA || card.paperB) && (
				<div className="px-5 pb-3">
					<SectionLabel>Source Papers</SectionLabel>
					<div className="space-y-1.5 mt-1.5">
						{card.paperA && (
							<PaperRef label="A" id={card.paperA.id} insight={card.paperA.insight} />
						)}
						{card.paperB && (
							<PaperRef label="B" id={card.paperB.id} insight={card.paperB.insight} />
						)}
					</div>
				</div>
			)}

			{card.combinedIdea && (
				<div className="px-5 pb-3">
					<SectionLabel>Combined Idea</SectionLabel>
					<p className="text-sm text-zinc-300 leading-relaxed mt-1.5">{card.combinedIdea}</p>
				</div>
			)}

			{card.whyNovel && (
				<div className="px-5 pb-3">
					<SectionLabel>Why This Is Novel</SectionLabel>
					<div className="mt-1.5 pl-3 border-l-2 border-amber-500/20">
						<p className="text-sm text-zinc-400 leading-relaxed">{card.whyNovel}</p>
					</div>
				</div>
			)}

			{card.applications.length > 0 && (
				<div className="px-5 pb-3">
					<SectionLabel>Applications</SectionLabel>
					<div className="flex flex-wrap gap-1.5 mt-2">
						{card.applications.map((app, i) => (
							<span
								key={`${card.number}-app-${i}`}
								className="text-xs px-2.5 py-1 rounded-full bg-zinc-800 text-zinc-400 border border-zinc-700/50"
							>
								{app}
							</span>
						))}
					</div>
				</div>
			)}

			{(card.scores.novelty > 0 || card.scores.feasibility > 0 || card.scores.impact > 0) && (
				<div className="px-5 pb-4">
					<SectionLabel>Scores</SectionLabel>
					<div className="space-y-2.5 mt-2">
						<ScoreBar label="Novelty" value={card.scores.novelty} color="violet" />
						<ScoreBar label="Feasibility" value={card.scores.feasibility} color="emerald" />
						<ScoreBar label="Impact" value={card.scores.impact} color="blue" />
					</div>
				</div>
			)}

			{card.evaluation && <EvaluationSection evaluation={card.evaluation} />}
		</div>
	);
}

function EvaluationSection({ evaluation }: { evaluation: ParsedEvaluation }) {
	const style = VERDICT_STYLES[evaluation.verdict];
	return (
		<div className={`mx-5 mb-4 rounded-lg border p-4 ${style.bg} ${style.border}`}>
			<div className="flex items-center gap-2 mb-2">
				<span className={`w-2 h-2 rounded-full ${style.dot}`} />
				<span className={`text-sm font-medium ${style.text}`}>
					{VERDICT_LABELS[evaluation.verdict]}
				</span>
			</div>

			{evaluation.assessment && (
				<p className="text-sm text-zinc-300 mb-3">{evaluation.assessment}</p>
			)}

			<div className="space-y-2 mb-3">
				<p className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wider">
					Adjusted Scores
				</p>
				<ScoreBar
					label="Novelty"
					value={evaluation.adjustedScores.novelty}
					color="violet"
					compact
				/>
				<ScoreBar
					label="Feasibility"
					value={evaluation.adjustedScores.feasibility}
					color="emerald"
					compact
				/>
				<ScoreBar label="Impact" value={evaluation.adjustedScores.impact} color="blue" compact />
			</div>

			{evaluation.evidenceGaps.length > 0 && (
				<div className="mb-2">
					<p className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wider mb-1">
						Evidence Gaps
					</p>
					<ul className="text-xs text-zinc-400 space-y-0.5">
						{evaluation.evidenceGaps.map((g) => (
							<li key={g} className="flex items-start gap-1.5">
								<span className="text-zinc-600 mt-0.5">&#x2022;</span>
								<span>{g}</span>
							</li>
						))}
					</ul>
				</div>
			)}

			{evaluation.safetyFlags.length > 0 && (
				<div>
					<p className="text-[11px] font-semibold text-red-400/80 uppercase tracking-wider mb-1">
						Safety Flags
					</p>
					<ul className="text-xs text-zinc-400 space-y-0.5">
						{evaluation.safetyFlags.map((f) => (
							<li key={f} className="flex items-start gap-1.5">
								<span className="text-red-500/60 mt-0.5">&#x2022;</span>
								<span>{f}</span>
							</li>
						))}
					</ul>
				</div>
			)}
		</div>
	);
}

const SCORE_COLORS = {
	violet: { bar: "from-violet-600 to-violet-400", bg: "bg-violet-500/10" },
	emerald: { bar: "from-emerald-600 to-emerald-400", bg: "bg-emerald-500/10" },
	blue: { bar: "from-blue-600 to-blue-400", bg: "bg-blue-500/10" },
} as const;

function ScoreBar({
	label,
	value,
	color,
	compact,
}: { label: string; value: number; color: keyof typeof SCORE_COLORS; compact?: boolean }) {
	const pct = (value / 10) * 100;
	const c = SCORE_COLORS[color];
	return (
		<div className="flex items-center gap-3">
			<span className={`${compact ? "w-16" : "w-20"} text-xs text-zinc-500 shrink-0`}>{label}</span>
			<div className={`flex-1 h-1.5 rounded-full ${c.bg} overflow-hidden`}>
				<div
					className={`h-full rounded-full bg-gradient-to-r ${c.bar} score-bar-fill`}
					style={{ width: `${pct}%` }}
				/>
			</div>
			<span className="text-xs text-zinc-400 w-8 text-right font-mono tabular-nums">
				{value}/10
			</span>
		</div>
	);
}

function PaperRef({ label, id, insight }: { label: string; id: string; insight: string }) {
	return (
		<div className="flex items-start gap-2 text-sm">
			<span className="shrink-0 text-[10px] font-mono px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-500 mt-0.5 border border-zinc-700/50">
				{label}
			</span>
			<div className="min-w-0">
				<span className="text-[11px] font-mono text-zinc-500 break-all">{id}</span>
				<p className="text-zinc-400 text-sm leading-relaxed">{insight}</p>
			</div>
		</div>
	);
}

function SectionLabel({ children }: { children: React.ReactNode }) {
	return (
		<p className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wider">{children}</p>
	);
}

function ArrowUpIcon() {
	return (
		<svg
			width="16"
			height="16"
			viewBox="0 0 16 16"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
			role="img"
			aria-label="Send"
		>
			<title>Send</title>
			<path d="M8 12V4M4 8l4-4 4 4" />
		</svg>
	);
}

function SpinnerIcon() {
	return (
		<svg
			className="animate-spin w-4 h-4"
			viewBox="0 0 24 24"
			fill="none"
			role="img"
			aria-label="Loading"
		>
			<title>Loading</title>
			<circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
			<path
				className="opacity-75"
				fill="currentColor"
				d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
			/>
		</svg>
	);
}
