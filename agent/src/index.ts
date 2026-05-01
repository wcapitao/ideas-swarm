import { routeAgentRequest } from "agents";

export { IdeatorAgent } from "~/ideator-agent";

export interface Env {
	IDEATOR: DurableObjectNamespace;
	DEEPSEEK_API_KEY: string;
	AIG_GATEWAY_ID: string;
	CLOUDFLARE_ACCOUNT_ID: string;
}

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const agentResponse = await routeAgentRequest<Env>(request, env, { cors: true });
		if (agentResponse !== null) {
			return agentResponse;
		}
		return new Response("Not Found", { status: 404 });
	},
} satisfies ExportedHandler<Env>;
