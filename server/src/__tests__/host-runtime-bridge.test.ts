import { afterEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import {
  executeViaHostRuntimeBridge,
  testEnvironmentViaHostRuntimeBridge,
} from "../services/host-runtime-bridge.ts";

async function startBridgeServer(handler: Parameters<typeof createServer>[0]) {
  const server = createServer(handler);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Could not resolve bridge server address.");
  }
  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}`,
  };
}

async function stopServer(server: Server) {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

afterEach(() => {
  delete process.env.PAPERCLIP_HOST_BRIDGE_URL;
  delete process.env.PAPERCLIP_HOST_BRIDGE_TOKEN;
  delete process.env.PAPERCLIP_AGENT_API_URL;
  delete process.env.PAPERCLIP_PUBLIC_URL;
});

describe("host runtime bridge client", () => {
  it("streams logs, meta, spawn, and result events from the host bridge", async () => {
    const seenAuthHeaders: string[] = [];
    const seenPaperclipApiUrls: string[] = [];
    const { server, baseUrl } = await startBridgeServer(async (req, res) => {
      seenAuthHeaders.push(req.headers.authorization ?? "");
      if (req.url === "/v1/execute") {
        let raw = "";
        for await (const chunk of req) {
          raw += chunk.toString("utf8");
        }
        const payload = JSON.parse(raw) as { paperclipApiUrl?: string };
        seenPaperclipApiUrls.push(payload.paperclipApiUrl ?? "");
        res.writeHead(200, { "content-type": "application/x-ndjson" });
        res.write(`${JSON.stringify({ type: "log", stream: "stdout", chunk: "hello\n" })}\n`);
        res.write(`${JSON.stringify({ type: "meta", meta: { adapterType: "codex_local", command: "codex" } })}\n`);
        res.write(`${JSON.stringify({ type: "spawn", meta: { pid: 42, startedAt: "2026-03-23T00:00:00.000Z" } })}\n`);
        res.end(`${JSON.stringify({
          type: "result",
          result: {
            exitCode: 0,
            signal: null,
            timedOut: false,
            summary: "done",
          },
        })}\n`);
        return;
      }
      res.writeHead(404).end();
    });

    process.env.PAPERCLIP_HOST_BRIDGE_URL = baseUrl;
    process.env.PAPERCLIP_HOST_BRIDGE_TOKEN = "bridge-token";
    process.env.PAPERCLIP_PUBLIC_URL = "https://desk.example.com";

    const logs: string[] = [];
    const meta: Array<Record<string, unknown>> = [];
    const spawn: Array<Record<string, unknown>> = [];
    const result = await executeViaHostRuntimeBridge("codex_local", {
      runId: "run-1",
      agent: {
        id: "agent-1",
        companyId: "company-1",
        name: "Host Codex",
        adapterType: "codex_local",
        adapterConfig: {},
      },
      runtime: {
        sessionId: null,
        sessionParams: null,
        sessionDisplayId: null,
        taskKey: null,
      },
      config: {
        executionLocation: "host",
      },
      context: {},
      onLog: async (_stream, chunk) => {
        logs.push(chunk);
      },
      onMeta: async (entry) => {
        meta.push(entry as unknown as Record<string, unknown>);
      },
      onSpawn: async (entry) => {
        spawn.push(entry as unknown as Record<string, unknown>);
      },
    });

    await stopServer(server);

    expect(seenAuthHeaders).toEqual(["Bearer bridge-token"]);
    expect(seenPaperclipApiUrls).toEqual(["https://desk.example.com"]);
    expect(logs).toEqual(["hello\n"]);
    expect(meta[0]).toMatchObject({ adapterType: "codex_local", command: "codex" });
    expect(spawn[0]).toMatchObject({ pid: 42 });
    expect(result).toMatchObject({ exitCode: 0, summary: "done" });
  });

  it("reports auth failures as environment-test errors", async () => {
    const { server, baseUrl } = await startBridgeServer((_req, res) => {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "bad token" }));
    });

    process.env.PAPERCLIP_HOST_BRIDGE_URL = baseUrl;
    process.env.PAPERCLIP_HOST_BRIDGE_TOKEN = "wrong-token";

    const result = await testEnvironmentViaHostRuntimeBridge({
      companyId: "company-1",
      adapterType: "claude_local",
      config: { executionLocation: "host" },
    });

    await stopServer(server);

    expect(result.status).toBe("fail");
    expect(result.checks[0]).toMatchObject({
      code: "host_bridge_auth_failed",
      level: "error",
      message: "bad token",
    });
  });

  it("returns host_bridge_unavailable when the bridge is missing", async () => {
    process.env.PAPERCLIP_HOST_BRIDGE_URL = "http://127.0.0.1:9";
    process.env.PAPERCLIP_HOST_BRIDGE_TOKEN = "bridge-token";

    const result = await executeViaHostRuntimeBridge("claude_local", {
      runId: "run-missing",
      agent: {
        id: "agent-1",
        companyId: "company-1",
        name: "Host Claude",
        adapterType: "claude_local",
        adapterConfig: {},
      },
      runtime: {
        sessionId: null,
        sessionParams: null,
        sessionDisplayId: null,
        taskKey: null,
      },
      config: {
        executionLocation: "host",
      },
      context: {},
      onLog: async () => {},
    });

    expect(result.errorCode).toBe("host_bridge_unavailable");
  });

  it("coalesces log chunks when the host bridge consumer lags", async () => {
    const { server, baseUrl } = await startBridgeServer((req, res) => {
      if (req.url !== "/v1/execute") {
        res.writeHead(404).end();
        return;
      }
      res.writeHead(200, { "content-type": "application/x-ndjson" });
      for (let idx = 0; idx < 240; idx += 1) {
        res.write(`${JSON.stringify({ type: "log", stream: "stdout", chunk: `burst-${idx}\n` })}\n`);
      }
      res.end(`${JSON.stringify({
        type: "result",
        result: {
          exitCode: 0,
          signal: null,
          timedOut: false,
          summary: "done",
        },
      })}\n`);
    });

    process.env.PAPERCLIP_HOST_BRIDGE_URL = baseUrl;
    process.env.PAPERCLIP_HOST_BRIDGE_TOKEN = "bridge-token";

    const logs: string[] = [];
    const result = await executeViaHostRuntimeBridge("codex_local", {
      runId: "run-lagged",
      agent: {
        id: "agent-1",
        companyId: "company-1",
        name: "Host Codex",
        adapterType: "codex_local",
        adapterConfig: {},
      },
      runtime: {
        sessionId: null,
        sessionParams: null,
        sessionDisplayId: null,
        taskKey: null,
      },
      config: {
        executionLocation: "host",
      },
      context: {},
      onLog: async (_stream, chunk) => {
        logs.push(chunk);
        await new Promise((resolve) => setTimeout(resolve, 10));
      },
    });

    await stopServer(server);

    expect(result).toMatchObject({ exitCode: 0, summary: "done" });
    expect(logs.some((chunk) => chunk.includes("Host bridge log consumer lagged"))).toBe(true);
    expect(logs.some((chunk) => chunk.includes("burst-239"))).toBe(true);
  });
});
