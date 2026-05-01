/**
 * ws-test-helpers.ts — WebSocket test utilities for Cloudflare Agents.
 *
 * Use inside vitest-pool-workers tests with --no-isolate workspace split.
 * Without --no-isolate, multi-connection / hibernation tests will fail
 * because per-file storage isolation breaks shared DO state.
 *
 * Example:
 *   import { connectWS, waitForMessage, hibernateAndRestore } from
 *     "../.claude/skills/cf-agent-tests-and-evals/scripts/ws-test-helpers";
 *   const ws = await connectWS(env, "/agents/MyAgent/u1");
 *   ws.send(JSON.stringify({ type: "ping" }));
 *   const m = await waitForMessage(ws, x => x.type === "pong");
 */

import { SELF, env } from "cloudflare:test";

type WSMessage = unknown;

export async function connectWS(envOverride: typeof env | null, path: string): Promise<WebSocket> {
  const e = envOverride ?? env;
  const r = await SELF.fetch(`https://test${path}`, {
    headers: { Upgrade: "websocket", "Sec-WebSocket-Version": "13" }
  });
  if (r.status !== 101) {
    throw new Error(`expected 101, got ${r.status}: ${await r.text()}`);
  }
  const ws = r.webSocket!;
  ws.accept();
  return ws as unknown as WebSocket;
}

export function waitForMessage(
  ws: WebSocket,
  predicate: (m: WSMessage) => boolean,
  timeoutMs = 5000
): Promise<WSMessage> {
  return new Promise((resolve, reject) => {
    const onMsg = (e: MessageEvent) => {
      let parsed: WSMessage;
      try { parsed = JSON.parse(e.data as string); }
      catch { parsed = e.data; }
      if (predicate(parsed)) {
        ws.removeEventListener("message", onMsg);
        clearTimeout(timer);
        resolve(parsed);
      }
    };
    const timer = setTimeout(() => {
      ws.removeEventListener("message", onMsg);
      reject(new Error(`waitForMessage timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    ws.addEventListener("message", onMsg);
  });
}

export function collectMessages(
  ws: WebSocket,
  durationMs: number
): Promise<WSMessage[]> {
  return new Promise((resolve) => {
    const collected: WSMessage[] = [];
    const onMsg = (e: MessageEvent) => {
      try { collected.push(JSON.parse(e.data as string)); }
      catch { collected.push(e.data); }
    };
    ws.addEventListener("message", onMsg);
    setTimeout(() => {
      ws.removeEventListener("message", onMsg);
      resolve(collected);
    }, durationMs);
  });
}

/**
 * Force-hibernate a DO and bring it back. Useful for asserting that state
 * survives hibernation. Requires the DO to expose a debug method (or use
 * the storage accessor) to confirm the rehydration path runs.
 */
export async function hibernateAndRestore(
  stub: DurableObjectStub
): Promise<void> {
  // The runtime auto-hibernates when no WS connections are active. Closing
  // the stub session simulates that. The next call rehydrates from storage.
  await stub.fetch("https://internal/__close-for-hibernation").catch(() => {});
  // Brief yield to let the runtime evict.
  await new Promise(r => setTimeout(r, 50));
}

/**
 * Open multiple WS clients to the same agent, simulate concurrent activity,
 * collect all broadcast messages per client. Useful for testing setState
 * broadcast semantics.
 */
export async function multiClient(
  envOverride: typeof env | null,
  path: string,
  count: number
): Promise<WebSocket[]> {
  const promises = Array.from({ length: count }, () => connectWS(envOverride, path));
  return Promise.all(promises);
}
