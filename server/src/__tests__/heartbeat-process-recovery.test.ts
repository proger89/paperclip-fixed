import { randomUUID } from "node:crypto";
import fs from "node:fs";
import fsPromises from "node:fs/promises";
import { createServer, type Server } from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  applyPendingMigrations,
  activityLog,
  createDb,
  costEvents,
  ensurePostgresDatabase,
  agents,
  agentRuntimeState,
  agentTaskSessions,
  agentWakeupRequests,
  companies,
  companySkills,
  heartbeatRunEvents,
  heartbeatRuns,
  issues,
} from "@paperclipai/db";
import { runningProcesses } from "../adapters/index.ts";
import { heartbeatService } from "../services/heartbeat.ts";

type EmbeddedPostgresInstance = {
  initialise(): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
};

type EmbeddedPostgresCtor = new (opts: {
  databaseDir: string;
  user: string;
  password: string;
  port: number;
  persistent: boolean;
  initdbFlags?: string[];
  onLog?: (message: unknown) => void;
  onError?: (message: unknown) => void;
}) => EmbeddedPostgresInstance;

async function getEmbeddedPostgresCtor(): Promise<EmbeddedPostgresCtor> {
  const mod = await import("embedded-postgres");
  return mod.default as EmbeddedPostgresCtor;
}

async function getAvailablePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Failed to allocate test port")));
        return;
      }
      const { port } = address;
      server.close((error) => {
        if (error) reject(error);
        else resolve(port);
      });
    });
  });
}

async function startTempDatabase() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "paperclip-heartbeat-recovery-"));
  const port = await getAvailablePort();
  const EmbeddedPostgres = await getEmbeddedPostgresCtor();
  const instance = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: "paperclip",
    password: "paperclip",
    port,
    persistent: true,
    initdbFlags: ["--encoding=UTF8", "--locale=C"],
    onLog: () => {},
    onError: () => {},
  });
  await instance.initialise();
  await instance.start();

  const adminConnectionString = `postgres://paperclip:paperclip@127.0.0.1:${port}/postgres`;
  await ensurePostgresDatabase(adminConnectionString, "paperclip");
  const connectionString = `postgres://paperclip:paperclip@127.0.0.1:${port}/paperclip`;
  await applyPendingMigrations(connectionString);
  return { connectionString, instance, dataDir };
}

async function removeDirWithRetries(dir: string, attempts = 10): Promise<void> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await fsPromises.rm(dir, { recursive: true, force: true });
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException | undefined)?.code;
      if ((code !== "EBUSY" && code !== "EPERM") || attempt === attempts - 1) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
}

async function startHostBridgeDouble(handler: Parameters<typeof createServer>[0]) {
  const server = createServer(handler);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Could not resolve host bridge test server address.");
  }
  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}`,
  };
}

async function stopHostBridgeDouble(server: Server) {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

function isRetriableForeignKeyError(error: unknown): boolean {
  return (error as { code?: string } | undefined)?.code === "23503";
}

function spawnAliveProcess() {
  return spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
    stdio: "ignore",
  });
}

async function writeFakeCodexAuthFailureCommand(commandPath: string): Promise<void> {
  const script = `#!/usr/bin/env node
console.log(JSON.stringify({
  type: "error",
  message: "Authentication required. Please run codex login.",
}));
process.exit(1);
`;
  await fsPromises.writeFile(commandPath, script, "utf8");
  await fsPromises.chmod(commandPath, 0o755);
}

async function writeFakeCodexFailureCommand(
  commandPath: string,
  message = "Paperclip forced failure.",
): Promise<void> {
  const script = `#!/usr/bin/env node
console.log(JSON.stringify({
  type: "error",
  message: ${JSON.stringify(message)},
}));
process.exit(1);
`;
  await fsPromises.writeFile(commandPath, script, "utf8");
  await fsPromises.chmod(commandPath, 0o755);
}

async function writeFakeCodexSuccessCommand(
  commandPath: string,
  message = "Recovered successfully.",
): Promise<void> {
  const script = `#!/usr/bin/env node
console.log(JSON.stringify({ type: "thread.started", thread_id: "codex-session-success" }));
console.log(JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: ${JSON.stringify(message)} } }));
console.log(JSON.stringify({ type: "turn.completed", usage: { input_tokens: 1, cached_input_tokens: 0, output_tokens: 1 } }));
`;
  await fsPromises.writeFile(commandPath, script, "utf8");
  await fsPromises.chmod(commandPath, 0o755);
}

async function waitForRunToFinish(
  heartbeat: ReturnType<typeof heartbeatService>,
  runId: string,
  timeoutMs = 10_000,
) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const run = await heartbeat.getRun(runId);
    if (run && run.status !== "queued" && run.status !== "running") {
      return run;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  throw new Error(`Timed out waiting for heartbeat run ${runId} to finish`);
}

async function waitForAgentStatus(
  db: ReturnType<typeof createDb>,
  agentId: string,
  expectedStatus: string,
  timeoutMs = 10_000,
) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const agent = await db
      .select()
      .from(agents)
      .where(eq(agents.id, agentId))
      .then((rows) => rows[0] ?? null);
    if (agent?.status === expectedStatus) {
      return agent;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  throw new Error(`Timed out waiting for agent ${agentId} to reach status ${expectedStatus}`);
}

async function waitForCircuitBreakerState(
  db: ReturnType<typeof createDb>,
  agentId: string,
  predicate: (state: Record<string, unknown>) => boolean,
  timeoutMs = 10_000,
) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const runtimeState = await db
      .select()
      .from(agentRuntimeState)
      .where(eq(agentRuntimeState.agentId, agentId))
      .then((rows) => rows[0] ?? null);
    const breakerState = (runtimeState?.stateJson?.circuitBreaker ?? {}) as Record<string, unknown>;
    if (predicate(breakerState)) {
      return breakerState;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  throw new Error(`Timed out waiting for circuit breaker state for agent ${agentId}`);
}

async function waitForIssueExecutionRelease(
  db: ReturnType<typeof createDb>,
  issueId: string,
  timeoutMs = 10_000,
) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const issue = await db
      .select()
      .from(issues)
      .where(eq(issues.id, issueId))
      .then((rows) => rows[0] ?? null);
    if (issue && issue.executionRunId == null && issue.executionLockedAt == null) {
      return issue;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  throw new Error(`Timed out waiting for issue ${issueId} execution lock release`);
}

describe("heartbeat orphaned process recovery", () => {
  let db!: ReturnType<typeof createDb>;
  let instance: EmbeddedPostgresInstance | null = null;
  let dataDir = "";
  const childProcesses = new Set<ChildProcess>();

  beforeAll(async () => {
    const started = await startTempDatabase();
    db = createDb(started.connectionString);
    instance = started.instance;
    dataDir = started.dataDir;
  }, 20_000);

  afterEach(async () => {
    runningProcesses.clear();
    for (const child of childProcesses) {
      child.kill("SIGKILL");
    }
    childProcesses.clear();
    for (let attempt = 0; attempt < 10; attempt += 1) {
      try {
        await db.delete(issues);
        await db.delete(activityLog);
        await db.delete(costEvents);
        await db.delete(agentTaskSessions);
        await db.delete(heartbeatRunEvents);
        await db.delete(heartbeatRuns);
        await db.delete(agentWakeupRequests);
        await db.delete(agentRuntimeState);
        await db.delete(agents);
        await db.delete(companySkills);
        await db.delete(companies);
        break;
      } catch (error) {
        if (!isRetriableForeignKeyError(error) || attempt === 9) {
          throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
    delete process.env.PAPERCLIP_HOST_BRIDGE_URL;
    delete process.env.PAPERCLIP_HOST_BRIDGE_TOKEN;
  });

  afterAll(async () => {
    for (const child of childProcesses) {
      child.kill("SIGKILL");
    }
    childProcesses.clear();
    runningProcesses.clear();
    await instance?.stop();
    if (dataDir) {
      await removeDirWithRetries(dataDir);
    }
  });

  async function seedRunFixture(input?: {
    adapterType?: string;
    runStatus?: "running" | "queued" | "failed";
    processPid?: number | null;
    processLossRetryCount?: number;
    includeIssue?: boolean;
    runErrorCode?: string | null;
    runError?: string | null;
  }) {
    const companyId = randomUUID();
    const agentId = randomUUID();
    const runId = randomUUID();
    const wakeupRequestId = randomUUID();
    const issueId = randomUUID();
    const now = new Date("2026-03-19T00:00:00.000Z");
    const issuePrefix = `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`;

    await db.insert(companies).values({
      id: companyId,
      name: "Paperclip",
      issuePrefix,
      requireBoardApprovalForNewAgents: false,
    });

    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: "CodexCoder",
      role: "engineer",
      status: "paused",
      adapterType: input?.adapterType ?? "codex_local",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    });

    await db.insert(agentWakeupRequests).values({
      id: wakeupRequestId,
      companyId,
      agentId,
      source: "assignment",
      triggerDetail: "system",
      reason: "issue_assigned",
      payload: input?.includeIssue === false ? {} : { issueId },
      status: "claimed",
      runId,
      claimedAt: now,
    });

    await db.insert(heartbeatRuns).values({
      id: runId,
      companyId,
      agentId,
      invocationSource: "assignment",
      triggerDetail: "system",
      status: input?.runStatus ?? "running",
      wakeupRequestId,
      contextSnapshot: input?.includeIssue === false ? {} : { issueId },
      processPid: input?.processPid ?? null,
      processLossRetryCount: input?.processLossRetryCount ?? 0,
      errorCode: input?.runErrorCode ?? null,
      error: input?.runError ?? null,
      startedAt: now,
      updatedAt: new Date("2026-03-19T00:00:00.000Z"),
    });

    if (input?.includeIssue !== false) {
      await db.insert(issues).values({
        id: issueId,
        companyId,
        title: "Recover local adapter after lost process",
        status: "in_progress",
        priority: "medium",
        assigneeAgentId: agentId,
        checkoutRunId: runId,
        executionRunId: runId,
        issueNumber: 1,
        identifier: `${issuePrefix}-1`,
      });
    }

    return { companyId, agentId, runId, wakeupRequestId, issueId };
  }

  it("keeps a local run active when the recorded pid is still alive", async () => {
    const child = spawnAliveProcess();
    childProcesses.add(child);
    expect(child.pid).toBeTypeOf("number");

    const { runId, wakeupRequestId } = await seedRunFixture({
      processPid: child.pid ?? null,
      includeIssue: false,
    });
    const heartbeat = heartbeatService(db);

    const result = await heartbeat.reapOrphanedRuns();
    expect(result.reaped).toBe(0);

    const run = await heartbeat.getRun(runId);
    expect(run?.status).toBe("running");
    expect(run?.errorCode).toBe("process_detached");
    expect(run?.error).toContain(String(child.pid));

    const wakeup = await db
      .select()
      .from(agentWakeupRequests)
      .where(eq(agentWakeupRequests.id, wakeupRequestId))
      .then((rows) => rows[0] ?? null);
    expect(wakeup?.status).toBe("claimed");
  });

  it("queues exactly one retry when the recorded local pid is dead", async () => {
    const { agentId, runId, issueId } = await seedRunFixture({
      processPid: 999_999_999,
    });
    const heartbeat = heartbeatService(db);

    const result = await heartbeat.reapOrphanedRuns();
    expect(result.reaped).toBe(1);
    expect(result.runIds).toEqual([runId]);

    const runs = await db
      .select()
      .from(heartbeatRuns)
      .where(eq(heartbeatRuns.agentId, agentId));
    expect(runs).toHaveLength(2);

    const failedRun = runs.find((row) => row.id === runId);
    const retryRun = runs.find((row) => row.id !== runId);
    expect(failedRun?.status).toBe("failed");
    expect(failedRun?.errorCode).toBe("process_lost");
    expect(retryRun?.status).toBe("queued");
    expect(retryRun?.retryOfRunId).toBe(runId);
    expect(retryRun?.processLossRetryCount).toBe(1);

    const issue = await db
      .select()
      .from(issues)
      .where(eq(issues.id, issueId))
      .then((rows) => rows[0] ?? null);
    expect(issue?.executionRunId).toBe(retryRun?.id ?? null);
    expect(issue?.checkoutRunId).toBe(runId);
  });

  it("does not queue a second retry after the first process-loss retry was already used", async () => {
    const { agentId, runId, issueId } = await seedRunFixture({
      processPid: 999_999_999,
      processLossRetryCount: 1,
    });
    const heartbeat = heartbeatService(db);

    const result = await heartbeat.reapOrphanedRuns();
    expect(result.reaped).toBe(1);
    expect(result.runIds).toEqual([runId]);

    const runs = await db
      .select()
      .from(heartbeatRuns)
      .where(eq(heartbeatRuns.agentId, agentId));
    expect(runs).toHaveLength(1);
    expect(runs[0]?.status).toBe("failed");

    const issue = await db
      .select()
      .from(issues)
      .where(eq(issues.id, issueId))
      .then((rows) => rows[0] ?? null);
    expect(issue?.executionRunId).toBeNull();
    expect(issue?.checkoutRunId).toBe(runId);
  });

  it("clears the detached warning when the run reports activity again", async () => {
    const { runId } = await seedRunFixture({
      includeIssue: false,
      runErrorCode: "process_detached",
      runError: "Lost in-memory process handle, but child pid 123 is still alive",
    });
    const heartbeat = heartbeatService(db);

    const updated = await heartbeat.reportRunActivity(runId);
    expect(updated?.errorCode).toBeNull();
    expect(updated?.error).toBeNull();

    const run = await heartbeat.getRun(runId);
    expect(run?.errorCode).toBeNull();
    expect(run?.error).toBeNull();
  });

  it("does not enqueue timer heartbeats for archived companies", async () => {
    const companyId = randomUUID();
    const agentId = randomUUID();
    const issuePrefix = `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`;
    const heartbeat = heartbeatService(db);

    await db.insert(companies).values({
      id: companyId,
      name: "Paperclip",
      status: "archived",
      issuePrefix,
      requireBoardApprovalForNewAgents: false,
    });

    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: "Archived Timer Agent",
      role: "engineer",
      status: "active",
      adapterType: "codex_local",
      adapterConfig: {},
      runtimeConfig: {
        heartbeat: {
          enabled: true,
          intervalSec: 1,
        },
      },
      permissions: {},
      createdAt: new Date("2026-03-19T00:00:00.000Z"),
      updatedAt: new Date("2026-03-19T00:00:00.000Z"),
      lastHeartbeatAt: new Date("2026-03-19T00:00:00.000Z"),
    });

    const result = await heartbeat.tickTimers(new Date("2026-03-19T00:10:00.000Z"));

    expect(result.checked).toBe(0);
    expect(result.enqueued).toBe(0);
    expect(result.skipped).toBe(0);

    const runs = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.agentId, agentId));
    expect(runs).toHaveLength(0);
  });

  it("pauses the agent after an adapter auth failure and suppresses future timer wakes", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "paperclip-heartbeat-auth-failure-"));
    const workspace = path.join(root, "workspace");
    const commandPath = path.join(root, "codex");
    await fsPromises.mkdir(workspace, { recursive: true });
    await writeFakeCodexAuthFailureCommand(commandPath);

    const previousHome = process.env.HOME;
    const previousUserProfile = process.env.USERPROFILE;
    process.env.HOME = root;
    process.env.USERPROFILE = root;

    try {
      const companyId = randomUUID();
      const agentId = randomUUID();
      const issuePrefix = `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`;
      const heartbeat = heartbeatService(db);

      await db.insert(companies).values({
        id: companyId,
        name: "Paperclip",
        issuePrefix,
        requireBoardApprovalForNewAgents: false,
      });

      await db.insert(agents).values({
        id: agentId,
        companyId,
        name: "Auth Fail Agent",
        role: "engineer",
        status: "active",
        adapterType: "codex_local",
        adapterConfig: {
          command: commandPath,
          cwd: workspace,
          promptTemplate: "Continue your work.",
        },
        runtimeConfig: {
          heartbeat: {
            enabled: true,
            intervalSec: 1,
          },
        },
        permissions: {},
        createdAt: new Date("2026-03-19T00:00:00.000Z"),
        updatedAt: new Date("2026-03-19T00:00:00.000Z"),
        lastHeartbeatAt: new Date("2026-03-19T00:00:00.000Z"),
      });

      const queuedRun = await heartbeat.invoke(
        agentId,
        "on_demand",
        {},
        "manual",
        { actorType: "system", actorId: "test" },
      );
      const finalizedRun = await waitForRunToFinish(heartbeat, queuedRun!.id);

      expect(finalizedRun.status).toBe("failed");
      expect(finalizedRun.errorCode).toBe("codex_auth_required");

      const pausedAgent = await waitForAgentStatus(db, agentId, "paused");
      expect(pausedAgent?.status).toBe("paused");
      expect(pausedAgent?.pauseReason).toBe("system");
      expect(pausedAgent?.pausedAt).not.toBeNull();

      const timerResult = await heartbeat.tickTimers(new Date("2026-03-19T00:10:00.000Z"));
      expect(timerResult.checked).toBe(0);
      expect(timerResult.enqueued).toBe(0);

      const agentRuns = await db
        .select()
        .from(heartbeatRuns)
        .where(eq(heartbeatRuns.agentId, agentId));
      expect(agentRuns).toHaveLength(1);
    } finally {
      if (previousHome === undefined) {
        delete process.env.HOME;
      } else {
        process.env.HOME = previousHome;
      }
      if (previousUserProfile === undefined) {
        delete process.env.USERPROFILE;
      } else {
        process.env.USERPROFILE = previousUserProfile;
      }
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it(
    "fails a host-executed run cleanly and releases issue execution locks when the bridge disconnects",
    async () => {
    const { server, baseUrl } = await startHostBridgeDouble((req, res) => {
      if (req.headers.authorization !== "Bearer bridge-token") {
        res.writeHead(401, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "bad token" }));
        return;
      }
      if (req.method === "POST" && req.url === "/v1/execute") {
        res.writeHead(200, { "content-type": "application/x-ndjson; charset=utf-8" });
        res.write(
          `${JSON.stringify({
            type: "spawn",
            meta: { pid: 4242, startedAt: "2026-03-23T00:00:00.000Z" },
          })}\n`,
        );
        res.write(`${JSON.stringify({ type: "log", stream: "stdout", chunk: "starting host bridge run\n" })}\n`);
        res.socket?.destroy();
        return;
      }
      if (req.method === "POST" && req.url?.startsWith("/v1/executions/") && req.url.endsWith("/cancel")) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, cancelled: true }));
        return;
      }
      res.writeHead(404).end();
    });

    process.env.PAPERCLIP_HOST_BRIDGE_URL = baseUrl;
    process.env.PAPERCLIP_HOST_BRIDGE_TOKEN = "bridge-token";

    try {
      const companyId = randomUUID();
      const agentId = randomUUID();
      const issueId = randomUUID();
      const issuePrefix = `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`;
      const heartbeat = heartbeatService(db);

      await db.insert(companies).values({
        id: companyId,
        name: "Paperclip",
        issuePrefix,
        requireBoardApprovalForNewAgents: false,
      });

      await db.insert(agents).values({
        id: agentId,
        companyId,
        name: "Host Bridge Agent",
        role: "engineer",
        status: "active",
        adapterType: "codex_local",
        adapterConfig: {
          executionLocation: "host",
          promptTemplate: "Continue your work.",
        },
        runtimeConfig: {},
        permissions: {},
      });

      await db.insert(issues).values({
        id: issueId,
        companyId,
        title: "Recover from host bridge disconnect",
        status: "in_progress",
        priority: "medium",
        assigneeAgentId: agentId,
        issueNumber: 1,
        identifier: `${issuePrefix}-1`,
      });

      const queuedRun = await heartbeat.invoke(
        agentId,
        "assignment",
        { issueId },
        "system",
        { actorType: "system", actorId: "host-bridge-disconnect-test" },
      );
      expect(queuedRun).not.toBeNull();

      const finalizedRun = await waitForRunToFinish(heartbeat, queuedRun!.id);
      expect(finalizedRun.status).toBe("failed");
      expect(finalizedRun.errorCode).toBe("host_bridge_unavailable");
      await waitForAgentStatus(db, agentId, "error");

      const releasedIssue = await waitForIssueExecutionRelease(db, issueId);
      expect(releasedIssue.executionRunId).toBeNull();
      expect(releasedIssue.executionLockedAt).toBeNull();
    } finally {
      await stopHostBridgeDouble(server);
    }
    },
    20_000,
  );

  it("auto-pauses the agent after three consecutive heartbeat failures", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "paperclip-heartbeat-breaker-"));
    const workspace = path.join(root, "workspace");
    const commandPath = path.join(root, "codex");
    await fsPromises.mkdir(workspace, { recursive: true });
    await writeFakeCodexFailureCommand(commandPath, "Paperclip forced failure.");

    const previousHome = process.env.HOME;
    const previousUserProfile = process.env.USERPROFILE;
    process.env.HOME = root;
    process.env.USERPROFILE = root;

    try {
      const companyId = randomUUID();
      const agentId = randomUUID();
      const issuePrefix = `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`;
      const heartbeat = heartbeatService(db);

      await db.insert(companies).values({
        id: companyId,
        name: "Paperclip",
        issuePrefix,
        requireBoardApprovalForNewAgents: false,
      });

      await db.insert(agents).values({
        id: agentId,
        companyId,
        name: "Breaker Agent",
        role: "engineer",
        status: "active",
        adapterType: "codex_local",
        adapterConfig: {
          command: commandPath,
          cwd: workspace,
          promptTemplate: "Continue your work.",
        },
        runtimeConfig: {
          heartbeat: {
            enabled: true,
            intervalSec: 1,
            circuitBreaker: {
              maxConsecutiveFailures: 3,
            },
          },
        },
        permissions: {},
        createdAt: new Date("2026-03-19T00:00:00.000Z"),
        updatedAt: new Date("2026-03-19T00:00:00.000Z"),
        lastHeartbeatAt: new Date("2026-03-19T00:00:00.000Z"),
      });

      for (let attempt = 0; attempt < 3; attempt += 1) {
        const queuedRun = await heartbeat.invoke(
          agentId,
          "on_demand",
          {},
          "manual",
          { actorType: "system", actorId: `test-${attempt}` },
        );
        const finalizedRun = await waitForRunToFinish(heartbeat, queuedRun!.id);
        expect(finalizedRun.status).toBe("failed");
      }

      const pausedAgent = await waitForAgentStatus(db, agentId, "paused");
      expect(pausedAgent.pauseReason).toBe("system");

      const runtimeState = await db
        .select()
        .from(agentRuntimeState)
        .where(eq(agentRuntimeState.agentId, agentId))
        .then((rows) => rows[0] ?? null);
      expect(runtimeState).not.toBeNull();
      const breakerState = (runtimeState?.stateJson?.circuitBreaker ?? {}) as Record<string, unknown>;
      expect(breakerState.lastTriggeredRunId).toBeTypeOf("string");
      expect(breakerState.lastTriggeredStreak).toBe(3);
      expect(breakerState.consecutiveFailures).toBe(0);

      const timerResult = await heartbeat.tickTimers(new Date("2026-03-19T00:10:00.000Z"));
      expect(timerResult.checked).toBe(0);
      expect(timerResult.enqueued).toBe(0);

      const activityRows = await db
        .select()
        .from(activityLog)
        .where(eq(activityLog.agentId, agentId));
      expect(
        activityRows.some(
          (row) =>
            row.action === "agent.paused" &&
            (row.details as Record<string, unknown> | null)?.reason === "failure_circuit_breaker",
        ),
      ).toBe(true);
    } finally {
      if (previousHome === undefined) {
        delete process.env.HOME;
      } else {
        process.env.HOME = previousHome;
      }
      if (previousUserProfile === undefined) {
        delete process.env.USERPROFILE;
      } else {
        process.env.USERPROFILE = previousUserProfile;
      }
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("resets the failure streak after a successful run", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "paperclip-heartbeat-breaker-reset-"));
    const workspace = path.join(root, "workspace");
    const commandPath = path.join(root, "codex");
    await fsPromises.mkdir(workspace, { recursive: true });
    await writeFakeCodexFailureCommand(commandPath, "Paperclip forced failure.");

    const previousHome = process.env.HOME;
    const previousUserProfile = process.env.USERPROFILE;
    process.env.HOME = root;
    process.env.USERPROFILE = root;

    try {
      const companyId = randomUUID();
      const agentId = randomUUID();
      const issuePrefix = `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`;
      const heartbeat = heartbeatService(db);

      await db.insert(companies).values({
        id: companyId,
        name: "Paperclip",
        issuePrefix,
        requireBoardApprovalForNewAgents: false,
      });

      await db.insert(agents).values({
        id: agentId,
        companyId,
        name: "Breaker Reset Agent",
        role: "engineer",
        status: "active",
        adapterType: "codex_local",
        adapterConfig: {
          command: commandPath,
          cwd: workspace,
          promptTemplate: "Continue your work.",
        },
        runtimeConfig: {
          heartbeat: {
            enabled: true,
            intervalSec: 1,
            circuitBreaker: {
              maxConsecutiveFailures: 3,
            },
          },
        },
        permissions: {},
        createdAt: new Date("2026-03-19T00:00:00.000Z"),
        updatedAt: new Date("2026-03-19T00:00:00.000Z"),
        lastHeartbeatAt: new Date("2026-03-19T00:00:00.000Z"),
      });

      for (let attempt = 0; attempt < 2; attempt += 1) {
        const queuedRun = await heartbeat.invoke(
          agentId,
          "on_demand",
          {},
          "manual",
          { actorType: "system", actorId: `before-reset-${attempt}` },
        );
        const finalizedRun = await waitForRunToFinish(heartbeat, queuedRun!.id);
        expect(finalizedRun.status).toBe("failed");
      }

      await writeFakeCodexSuccessCommand(commandPath, "Recovered successfully.");
      const successRun = await heartbeat.invoke(
        agentId,
        "on_demand",
        {},
        "manual",
        { actorType: "system", actorId: "reset-success" },
      );
      const finalizedSuccess = await waitForRunToFinish(heartbeat, successRun!.id);
      expect(finalizedSuccess.status).toBe("succeeded");

      await writeFakeCodexFailureCommand(commandPath, "Paperclip forced failure again.");
      const finalRun = await heartbeat.invoke(
        agentId,
        "on_demand",
        {},
        "manual",
        { actorType: "system", actorId: "after-reset" },
      );
      const finalizedFailure = await waitForRunToFinish(heartbeat, finalRun!.id);
      expect(finalizedFailure.status).toBe("failed");

      const latestAgent = await db
        .select()
        .from(agents)
        .where(eq(agents.id, agentId))
        .then((rows) => rows[0] ?? null);
      expect(latestAgent?.status).not.toBe("paused");

      const breakerState = await waitForCircuitBreakerState(
        db,
        agentId,
        (state) => state.consecutiveFailures === 1 && state.lastTriggeredRunId === null,
      );
      expect(breakerState.consecutiveFailures).toBe(1);
      expect(breakerState.lastTriggeredRunId).toBeNull();
    } finally {
      if (previousHome === undefined) {
        delete process.env.HOME;
      } else {
        process.env.HOME = previousHome;
      }
      if (previousUserProfile === undefined) {
        delete process.env.USERPROFILE;
      } else {
        process.env.USERPROFILE = previousUserProfile;
      }
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
