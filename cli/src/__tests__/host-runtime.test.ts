import net from "node:net";
import { createServer, type Server } from "node:http";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { hostRuntimeServe } from "../commands/host-runtime.js";

async function allocatePort() {
  const server = net.createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  if (!address || typeof address === "string") {
    throw new Error("Could not allocate port.");
  }
  return address.port;
}

afterEach(() => {
  delete process.env.BETTER_AUTH_SECRET;
  delete process.env.PAPERCLIP_AGENT_JWT_SECRET;
  delete process.env.PAPERCLIP_HOST_BRIDGE_TOKEN;
  delete process.env.PAPERCLIP_HOST_BRIDGE_URL;
  delete process.env.DATABASE_URL;
});

async function startJsonServer(handler: Parameters<typeof createServer>[0]) {
  const server = createServer(handler);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Could not resolve JSON server address.");
  }
  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}`,
  };
}

async function stopServer(server: Server) {
  await new Promise<void>((resolve, reject) => {
    server.close((err?: Error | null) => (err ? reject(err) : resolve()));
  });
}

function parseNdjsonResult(body: string) {
  return body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe("host-runtime serve", () => {
  it("requires auth for health and reports configured capabilities", async () => {
    const port = await allocatePort();
    const server = await hostRuntimeServe({
      listen: `127.0.0.1:${port}`,
      token: "bridge-token",
      capability: ["codex", "browser"],
      pathMap: ["/workspace=/srv/repo"],
    });

    const unauthorized = await fetch(`http://127.0.0.1:${port}/health`);
    const authorized = await fetch(`http://127.0.0.1:${port}/health`, {
      headers: {
        authorization: "Bearer bridge-token",
      },
    });
    const body = await authorized.json() as Record<string, unknown>;

    await new Promise<void>((resolve, reject) => {
      server.close((err?: Error | null) => (err ? reject(err) : resolve()));
    });

    expect(unauthorized.status).toBe(401);
    expect(body).toMatchObject({
      ok: true,
      capabilities: {
        codex: true,
        claude: false,
        browser: true,
      },
      pathMaps: [
        {
          containerPath: "/workspace",
          hostPath: "/srv/repo",
        },
      ],
    });
  });

  it("does not forward bridge or server secrets into host-executed child env", async () => {
    const containerRoot = "/paperclip-test";
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-host-runtime-env-"));
    const workspace = path.join(root, "workspace");
    const commandPath = path.join(root, "codex");
    const capturePath = path.join(root, "capture.json");
    const instructionsDir = path.join(workspace, "instructions");
    const instructionsPath = path.join(instructionsDir, "AGENTS.md");
    const containerWorkspace = `${containerRoot}/workspace`;
    const containerCommandPath = `${containerRoot}/codex`;
    const containerCapturePath = `${containerRoot}/capture.json`;
    const containerInstructionsPath = `${containerWorkspace}/instructions/AGENTS.md`;
    await fs.mkdir(workspace, { recursive: true });
    await fs.mkdir(instructionsDir, { recursive: true });
    await fs.writeFile(instructionsPath, "Read the sibling files.\n", "utf8");
    await fs.writeFile(
      commandPath,
      [
        "#!/usr/bin/env node",
        "const fs = require('node:fs');",
        "const payload = {",
        "  paperclipApiKey: process.env.PAPERCLIP_API_KEY || null,",
        "  instructionsFile: process.env.PAPERCLIP_INSTRUCTIONS_FILE || null,",
        "  instructionsDir: process.env.PAPERCLIP_INSTRUCTIONS_DIR || null,",
        "  betterAuthSecret: process.env.BETTER_AUTH_SECRET || null,",
        "  agentJwtSecret: process.env.PAPERCLIP_AGENT_JWT_SECRET || null,",
        "  hostBridgeToken: process.env.PAPERCLIP_HOST_BRIDGE_TOKEN || null,",
        "  hostBridgeUrl: process.env.PAPERCLIP_HOST_BRIDGE_URL || null,",
        "  databaseUrl: process.env.DATABASE_URL || null,",
        "};",
        "fs.writeFileSync(process.env.PAPERCLIP_TEST_CAPTURE_PATH, JSON.stringify(payload), 'utf8');",
        "console.log(JSON.stringify({ type: 'thread.started', thread_id: 'codex-session-1' }));",
        "console.log(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'hello' } }));",
        "console.log(JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 1, cached_input_tokens: 0, output_tokens: 1 } }));",
        "",
      ].join("\n"),
      "utf8",
    );
    await fs.chmod(commandPath, 0o755);

    const port = await allocatePort();
    const previousBetterAuthSecret = process.env.BETTER_AUTH_SECRET;
    const previousAgentJwtSecret = process.env.PAPERCLIP_AGENT_JWT_SECRET;
    const previousHostBridgeToken = process.env.PAPERCLIP_HOST_BRIDGE_TOKEN;
    const previousHostBridgeUrl = process.env.PAPERCLIP_HOST_BRIDGE_URL;
    const previousDatabaseUrl = process.env.DATABASE_URL;
    process.env.BETTER_AUTH_SECRET = "server-better-auth-secret";
    process.env.PAPERCLIP_AGENT_JWT_SECRET = "server-agent-jwt-secret";
    process.env.PAPERCLIP_HOST_BRIDGE_TOKEN = "server-host-bridge-token";
    process.env.PAPERCLIP_HOST_BRIDGE_URL = "http://host.docker.internal:4243";
    process.env.DATABASE_URL = "postgres://server-db.example.com/paperclip";

    const server = await hostRuntimeServe({
      listen: `127.0.0.1:${port}`,
      token: "bridge-token",
      capability: ["codex"],
      pathMap: [`${containerRoot}=${root}`],
    });

    try {
      const response = await fetch(`http://127.0.0.1:${port}/v1/execute`, {
        method: "POST",
        headers: {
          authorization: "Bearer bridge-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          adapterType: "codex_local",
          paperclipApiUrl: "http://127.0.0.1:3100",
          ctx: {
            runId: "run-bridge-env",
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
              command: containerCommandPath,
              cwd: containerWorkspace,
              promptTemplate: "Continue your Paperclip work.",
              instructionsFilePath: containerInstructionsPath,
              env: {
                PAPERCLIP_TEST_CAPTURE_PATH: containerCapturePath,
              },
            },
            context: {},
            authToken: "bridge-run-jwt",
          },
        }),
      });

      expect(response.status).toBe(200);
      await response.text();

      const capture = JSON.parse(await fs.readFile(capturePath, "utf8")) as Record<string, string | null>;
      expect(capture.paperclipApiKey).toBe("bridge-run-jwt");
      expect(capture.instructionsFile).toBe(instructionsPath);
      expect(capture.instructionsDir).toBe(instructionsDir);
      expect(capture.betterAuthSecret).toBeNull();
      expect(capture.agentJwtSecret).toBeNull();
      expect(capture.hostBridgeToken).toBeNull();
      expect(capture.hostBridgeUrl).toBeNull();
      expect(capture.databaseUrl).toBeNull();
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((err?: Error | null) => (err ? reject(err) : resolve()));
      });
      if (previousBetterAuthSecret === undefined) delete process.env.BETTER_AUTH_SECRET;
      else process.env.BETTER_AUTH_SECRET = previousBetterAuthSecret;
      if (previousAgentJwtSecret === undefined) delete process.env.PAPERCLIP_AGENT_JWT_SECRET;
      else process.env.PAPERCLIP_AGENT_JWT_SECRET = previousAgentJwtSecret;
      if (previousHostBridgeToken === undefined) delete process.env.PAPERCLIP_HOST_BRIDGE_TOKEN;
      else process.env.PAPERCLIP_HOST_BRIDGE_TOKEN = previousHostBridgeToken;
      if (previousHostBridgeUrl === undefined) delete process.env.PAPERCLIP_HOST_BRIDGE_URL;
      else process.env.PAPERCLIP_HOST_BRIDGE_URL = previousHostBridgeUrl;
      if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previousDatabaseUrl;
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("fails fast when the configured Paperclip control plane is unreachable", async () => {
    const port = await allocatePort();
    const server = await hostRuntimeServe({
      listen: `127.0.0.1:${port}`,
      token: "bridge-token",
      capability: ["codex"],
    });

    try {
      const response = await fetch(`http://127.0.0.1:${port}/v1/execute`, {
        method: "POST",
        headers: {
          authorization: "Bearer bridge-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          adapterType: "codex_local",
          paperclipApiUrl: "http://127.0.0.1:9",
          ctx: {
            runId: "run-preflight-unavailable",
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
            authToken: "bridge-run-jwt",
          },
        }),
      });

      expect(response.status).toBe(200);
      const events = parseNdjsonResult(await response.text());
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: "result",
        result: {
          errorCode: "paperclip_control_plane_unavailable",
        },
      });
    } finally {
      await stopServer(server);
    }
  });

  it("fails fast when the Paperclip control plane rejects run auth", async () => {
    const api = await startJsonServer((req, res) => {
      if (req.url === "/api/health") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
        return;
      }
      if (req.url === "/api/agents/me") {
        res.writeHead(401, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "Agent authentication required" }));
        return;
      }
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "Not found" }));
    });
    const port = await allocatePort();
    const bridge = await hostRuntimeServe({
      listen: `127.0.0.1:${port}`,
      token: "bridge-token",
      capability: ["codex"],
    });

    try {
      const response = await fetch(`http://127.0.0.1:${port}/v1/execute`, {
        method: "POST",
        headers: {
          authorization: "Bearer bridge-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          adapterType: "codex_local",
          paperclipApiUrl: api.baseUrl,
          ctx: {
            runId: "run-preflight-auth",
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
            authToken: "bridge-run-jwt",
          },
        }),
      });

      expect(response.status).toBe(200);
      const events = parseNdjsonResult(await response.text());
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: "result",
        result: {
          errorCode: "paperclip_control_plane_auth_failed",
        },
      });
    } finally {
      await stopServer(bridge);
      await stopServer(api.server);
    }
  });
});
