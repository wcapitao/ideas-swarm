import { useRef, useEffect } from "react";
import { useAgent } from "agents/react";
import { useAgentChat } from "agents/ai-react";

function generateSessionId(): string {
  return `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

const sessionId = generateSessionId();

export function GraphLoading() {
  const backgroundNodes = [
    { x: "10%", y: "18%" },
    { x: "14%", y: "42%" },
    { x: "18%", y: "70%" },
    { x: "26%", y: "22%" },
    { x: "28%", y: "58%" },
    { x: "34%", y: "80%" },
    { x: "40%", y: "18%" },
    { x: "45%", y: "34%" },
    { x: "49%", y: "58%" },
    { x: "54%", y: "76%" },
    { x: "62%", y: "20%" },
    { x: "66%", y: "48%" },
    { x: "72%", y: "72%" },
    { x: "80%", y: "28%" },
    { x: "88%", y: "58%" },
  ];
  const backgroundLinks = [
    "M104 62 C168 86, 222 104, 286 126",
    "M142 136 C224 146, 292 152, 370 158",
    "M182 224 C256 206, 322 194, 404 176",
    "M260 74 C332 84, 402 102, 470 126",
    "M318 186 C388 182, 452 178, 516 176",
    "M444 64 C518 86, 586 102, 662 116",
    "M496 174 C568 168, 630 154, 700 126",
    "M558 236 C640 216, 712 194, 812 170",
    "M632 82 C714 98, 786 124, 864 156",
  ];
  const traversalEdges = [
    { path: "M500 160 C470 150, 430 144, 388 136", side: "left", delay: "0.1s" },
    { path: "M388 136 C340 128, 294 118, 246 106", side: "left", delay: "0.55s" },
    { path: "M246 106 C196 98, 154 94, 110 92", side: "left", delay: "1s" },
    { path: "M500 160 C470 168, 432 182, 394 202", side: "left", delay: "0.22s" },
    { path: "M394 202 C344 220, 288 232, 226 236", side: "left", delay: "0.75s" },
    { path: "M226 236 C176 238, 140 234, 104 224", side: "left", delay: "1.2s" },
    { path: "M500 160 C536 150, 574 144, 616 138", side: "right", delay: "0.1s" },
    { path: "M616 138 C668 132, 718 126, 770 116", side: "right", delay: "0.58s" },
    { path: "M770 116 C818 108, 856 102, 898 98", side: "right", delay: "1.05s" },
    { path: "M500 160 C536 172, 578 186, 622 206", side: "right", delay: "0.24s" },
    { path: "M622 206 C678 222, 734 232, 792 234", side: "right", delay: "0.82s" },
    { path: "M792 234 C834 234, 868 228, 900 218", side: "right", delay: "1.28s" },
  ];
  const traversedNodes = [
    { x: "50%", y: "50%", delay: "0s", tier: "hub" },
    { x: "38.8%", y: "42.5%", delay: "0.35s", tier: "branch" },
    { x: "24.6%", y: "33.5%", delay: "0.85s", tier: "branch" },
    { x: "11%", y: "29.5%", delay: "1.35s", tier: "terminal" },
    { x: "39.4%", y: "63.5%", delay: "0.5s", tier: "branch" },
    { x: "22.6%", y: "74%", delay: "1s", tier: "branch" },
    { x: "10.4%", y: "72%", delay: "1.48s", tier: "terminal" },
    { x: "61.6%", y: "43%", delay: "0.35s", tier: "branch" },
    { x: "77%", y: "37%", delay: "0.9s", tier: "branch" },
    { x: "89.8%", y: "31.2%", delay: "1.4s", tier: "terminal" },
    { x: "62.2%", y: "64.5%", delay: "0.52s", tier: "branch" },
    { x: "79.2%", y: "73.2%", delay: "1.05s", tier: "branch" },
    { x: "90%", y: "69.8%", delay: "1.52s", tier: "terminal" },
  ];

  return (
    <div className="graph-loader rounded-3xl border border-zinc-800 bg-zinc-900/80 p-6">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <p className="text-[11px] uppercase tracking-[0.24em] text-zinc-500">Traversing graph</p>
          <h3 className="mt-1 text-sm font-medium text-zinc-200">Walking outward from a shared cluster into disconnected papers</h3>
        </div>
        <div className="text-xs text-zinc-500">124 papers</div>
      </div>

      <div className="graph-stage">
        {backgroundNodes.map((node, index) => (
          <span
            key={`${node.x}-${node.y}`}
            className="graph-faint-node"
            style={
              {
                left: node.x,
                top: node.y,
                animationDelay: `${index * 180}ms`,
              }
            }
          />
        ))}

        <svg className="graph-links" viewBox="0 0 1000 320" preserveAspectRatio="none" aria-hidden="true">
          {backgroundLinks.map((path) => (
            <path key={path} d={path} />
          ))}
        </svg>

        <svg className="graph-links graph-links-active" viewBox="0 0 1000 320" preserveAspectRatio="none" aria-hidden="true">
          {traversalEdges.map((edge) => (
            <path
              key={edge.path}
              d={edge.path}
              className={`graph-traversal-line ${edge.side}`}
              style={{ animationDelay: edge.delay }}
            />
          ))}
        </svg>

        {traversedNodes.map((node, index) => (
          <span
            key={`${node.x}-${node.y}-${index}`}
            className={`graph-active-node ${node.tier}`}
            style={
              {
                left: node.x,
                top: node.y,
                animationDelay: node.delay,
              }
            }
          />
        ))}

        <div className="graph-core" />

        <div className="paper-anchor left">
          <div className="paper-dot" />
          <div className="paper-card" aria-hidden="true">
            <span className="paper-label">Frontier paper</span>
            <div className="paper-lines">
              <span className="paper-line paper-line-title" />
              <span className="paper-line paper-line-medium" />
              <span className="paper-line paper-line-short" />
            </div>
          </div>
        </div>

        <div className="paper-anchor right">
          <div className="paper-dot" />
          <div className="paper-card" aria-hidden="true">
            <span className="paper-label">Frontier paper</span>
            <div className="paper-lines">
              <span className="paper-line paper-line-title" />
              <span className="paper-line paper-line-medium" />
              <span className="paper-line paper-line-short" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function App() {
  const agent = useAgent({ agent: "ideator", name: sessionId });
  const { messages, input, handleInputChange, handleSubmit, append, status, clearHistory } =
    useAgentChat({ agent });

  const scrollRef = useRef<HTMLDivElement>(null);
  const isStreaming = status === "streaming" || status === "submitted";

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  return (
    <div className="flex flex-col h-screen bg-zinc-950 text-zinc-100">
      <header className="flex items-center justify-between px-6 py-4 border-b border-zinc-800">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">AI Ideator</h1>
          <p className="text-xs text-zinc-500">Combinatorial creativity from research papers</p>
        </div>
        <button
          type="button"
          onClick={clearHistory}
          className="text-xs text-zinc-500 hover:text-zinc-300 px-3 py-1.5 rounded border border-zinc-800 hover:border-zinc-600 transition-colors"
        >
          New session
        </button>
      </header>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-6 space-y-6">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center space-y-4">
            <div className="text-4xl">&#x1f9ea;</div>
            <h2 className="text-xl font-medium text-zinc-300">What should we explore?</h2>
            <p className="text-sm text-zinc-500 max-w-md">
              Enter a research topic and I'll combine insights from different papers to generate
              novel ideas.
            </p>
            <div className="flex flex-wrap gap-2 justify-center max-w-lg">
              {[
                "Gut microbiome interventions for gastritis",
                "Novel approaches to H. pylori eradication",
                "Gastric barrier repair mechanisms",
              ].map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() =>
                    append({ role: "user", content: suggestion })
                  }
                  className="text-xs px-3 py-1.5 rounded-full border border-zinc-800 text-zinc-400 hover:text-zinc-200 hover:border-zinc-600 transition-colors"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <div key={msg.id} className={msg.role === "user" ? "flex justify-end" : ""}>
            {msg.role === "user" ? (
              <div className="bg-zinc-800 rounded-2xl rounded-br-sm px-4 py-2.5 max-w-md">
                <p className="text-sm">{String(msg.content)}</p>
              </div>
            ) : (
              <div className="prose prose-invert prose-sm max-w-none">
                <MessageContent content={String(msg.content)} />
              </div>
            )}
          </div>
        ))}

        {isStreaming && messages.at(-1)?.role !== "assistant" && <GraphLoading />}
      </div>

      <form
        onSubmit={handleSubmit}
        className="px-6 py-4 border-t border-zinc-800"
      >
        <div className="flex gap-3 max-w-3xl mx-auto">
          <input
            value={input}
            onChange={handleInputChange}
            placeholder="Enter a research topic..."
            disabled={isStreaming}
            className="flex-1 bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 text-sm placeholder:text-zinc-600 focus:outline-none focus:border-zinc-600 disabled:opacity-50 transition-colors"
          />
          <button
            type="submit"
            disabled={isStreaming || !input.trim()}
            className="bg-zinc-100 text-zinc-900 font-medium text-sm px-5 py-3 rounded-xl hover:bg-white disabled:opacity-30 disabled:hover:bg-zinc-100 transition-colors"
          >
            {isStreaming ? "Thinking..." : "Generate"}
          </button>
        </div>
      </form>
    </div>
  );
}

function MessageContent({ content }: { content: string }) {
  const lines = content.split("\n");
  const elements: React.ReactNode[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.startsWith("# ")) {
      elements.push(<h1 key={i} className="text-xl font-bold mt-4 mb-2">{line.slice(2)}</h1>);
    } else if (line.startsWith("## ")) {
      elements.push(<h2 key={i} className="text-lg font-semibold mt-6 mb-2 text-amber-400">{line.slice(3)}</h2>);
    } else if (line.startsWith("### ")) {
      elements.push(<h3 key={i} className="text-sm font-semibold mt-3 mb-1 text-zinc-400 uppercase tracking-wider">{line.slice(4)}</h3>);
    } else if (line.startsWith("- **")) {
      const match = line.match(/^- \*\*(.+?)\*\*:?\s*(.*)/);
      if (match) {
        elements.push(
          <div key={i} className="ml-4 my-1">
            <span className="font-semibold text-zinc-200">{match[1]}</span>
            {match[2] && <span className="text-zinc-400">: {match[2]}</span>}
          </div>
        );
      } else {
        elements.push(<li key={i} className="ml-4 my-1 text-zinc-300">{line.slice(2)}</li>);
      }
    } else if (line.startsWith("- ")) {
      elements.push(<li key={i} className="ml-4 my-1 text-zinc-300">{line.slice(2)}</li>);
    } else if (line.startsWith("**") && line.endsWith("**")) {
      elements.push(<p key={i} className="font-semibold my-1">{line.slice(2, -2)}</p>);
    } else if (line.startsWith("**")) {
      const match = line.match(/^\*\*(.+?)\*\*:?\s*(.*)/);
      if (match) {
        elements.push(
          <p key={i} className="my-1">
            <span className="font-semibold">{match[1]}:</span> {match[2]}
          </p>
        );
      } else {
        elements.push(<p key={i} className="my-1">{line}</p>);
      }
    } else if (line.trim() === "") {
      continue;
    } else {
      elements.push(<p key={i} className="my-1 text-zinc-300 leading-relaxed">{line}</p>);
    }
  }

  return <>{elements}</>;
}
