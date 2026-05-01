import { useRef, useEffect } from "react";
import { useAgent } from "agents/react";
import { useAgentChat } from "agents/ai-react";

function generateSessionId(): string {
  return `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

const sessionId = generateSessionId();

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

        {isStreaming && messages.at(-1)?.role !== "assistant" && (
          <div className="flex gap-1.5 py-2">
            <span className="w-2 h-2 bg-zinc-600 rounded-full animate-bounce [animation-delay:0ms]" />
            <span className="w-2 h-2 bg-zinc-600 rounded-full animate-bounce [animation-delay:150ms]" />
            <span className="w-2 h-2 bg-zinc-600 rounded-full animate-bounce [animation-delay:300ms]" />
          </div>
        )}
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
