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
import worker, { type Env } from "~/index";

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

		const result = await worker.fetch(makeRequest("/agents/ideator/session-1"), mockEnv, {} as ExecutionContext);

		expect(vi.mocked(routeAgentRequest)).toHaveBeenCalledWith(
			expect.any(Request),
			mockEnv,
			{ cors: true },
		);
		expect(result).toBe(agentResponse);
	});

	it("returns 404 when routeAgentRequest returns null", async () => {
		vi.mocked(routeAgentRequest).mockResolvedValueOnce(null);

		const result = await worker.fetch(makeRequest("/unknown"), mockEnv, {} as ExecutionContext);

		expect(result.status).toBe(404);
		expect(await result.text()).toBe("Not Found");
	});
});
