import { describe, expect, it, vi } from "vitest";

// Stub the `agents` module before importing the worker so routeAgentRequest
// is interceptable without a real Durable Object runtime.
vi.mock("agents", () => ({
	routeAgentRequest: vi.fn(),
}));

// Stub the ideator-agent module — the DO class is not needed for routing tests.
vi.mock("~/ideator-agent", () => ({
	IdeatorAgent: class {},
}));

import { routeAgentRequest } from "agents";
import type { Env } from "~/index";

// Import the default export as a plain object so we can call .fetch directly
// without hitting the optional-property typing on ExportedHandler.
const worker = (await import("~/index")).default as {
	fetch: (request: Request, env: Env) => Promise<Response>;
};

const mockEnv: Env = {
	IDEATOR: {} as DurableObjectNamespace,
	DEEPSEEK_API_KEY: "sk-test",
	AIG_GATEWAY_ID: "ai-ideator",
	CLOUDFLARE_ACCOUNT_ID: "acct-test",
};

function makeRequest(path = "/"): Request {
	return new Request(`https://example.com${path}`);
}

describe("fetch handler", () => {
	it("returns the agent response when routeAgentRequest resolves a Response", async () => {
		const agentResponse = new Response("ok", { status: 200 });
		vi.mocked(routeAgentRequest).mockResolvedValueOnce(agentResponse);

		const result = await worker.fetch(makeRequest("/agents/ideator/session-1"), mockEnv);

		expect(vi.mocked(routeAgentRequest)).toHaveBeenCalledWith(expect.any(Request), mockEnv, {
			cors: true,
		});
		expect(result).toBe(agentResponse);
	});

	it("returns 404 when routeAgentRequest returns null", async () => {
		vi.mocked(routeAgentRequest).mockResolvedValueOnce(null);

		const result = await worker.fetch(makeRequest("/unknown"), mockEnv);

		expect(result.status).toBe(404);
		expect(await result.text()).toBe("Not Found");
	});
});
