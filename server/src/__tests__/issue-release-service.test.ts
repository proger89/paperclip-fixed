import { randomUUID } from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  agents,
  applyPendingMigrations,
  companies,
  createDb,
  ensurePostgresDatabase,
  heartbeatRuns,
  issues,
} from "@paperclipai/db";
import { issueService } from "../services/issues.ts";

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
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "paperclip-issue-release-"));
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
  return { connectionString, dataDir, instance };
}

describe("issue service release", () => {
  let db!: ReturnType<typeof createDb>;
  let instance: EmbeddedPostgresInstance | null = null;
  let dataDir = "";

  beforeAll(async () => {
    const started = await startTempDatabase();
    db = createDb(started.connectionString);
    instance = started.instance;
    dataDir = started.dataDir;
  }, 20_000);

  afterEach(async () => {
    await db.delete(issues);
    await db.delete(heartbeatRuns);
    await db.delete(agents);
    await db.delete(companies);
  });

  afterAll(async () => {
    await instance?.stop();
    if (dataDir) {
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it("clears execution locks so a fresh run can check the issue out again", async () => {
    const companyId = randomUUID();
    const releasingAgentId = randomUUID();
    const nextAgentId = randomUUID();
    const releaseRunId = randomUUID();
    const nextRunId = randomUUID();
    const issueId = randomUUID();
    const issuePrefix = `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`;
    const issuesSvc = issueService(db);

    await db.insert(companies).values({
      id: companyId,
      name: "Paperclip",
      issuePrefix,
      requireBoardApprovalForNewAgents: false,
    });

    await db.insert(agents).values([
      {
        id: releasingAgentId,
        companyId,
        name: "First Engineer",
        role: "engineer",
        status: "active",
        adapterType: "codex_local",
        adapterConfig: {},
        runtimeConfig: {},
        permissions: {},
      },
      {
        id: nextAgentId,
        companyId,
        name: "Second Engineer",
        role: "engineer",
        status: "active",
        adapterType: "codex_local",
        adapterConfig: {},
        runtimeConfig: {},
        permissions: {},
      },
    ]);

    await db.insert(heartbeatRuns).values([
      {
        id: releaseRunId,
        companyId,
        agentId: releasingAgentId,
        invocationSource: "assignment",
        triggerDetail: "system",
        status: "running",
        contextSnapshot: { issueId },
      },
      {
        id: nextRunId,
        companyId,
        agentId: nextAgentId,
        invocationSource: "assignment",
        triggerDetail: "system",
        status: "running",
        contextSnapshot: { issueId },
      },
    ]);

    await db.insert(issues).values({
      id: issueId,
      companyId,
      title: "Release should clear execution locks",
      status: "in_progress",
      priority: "medium",
      assigneeAgentId: releasingAgentId,
      checkoutRunId: releaseRunId,
      executionRunId: releaseRunId,
      executionAgentNameKey: "first-engineer",
      executionLockedAt: new Date("2026-03-23T07:00:00.000Z"),
      issueNumber: 1,
      identifier: `${issuePrefix}-1`,
    });

    const released = await issuesSvc.release(issueId, releasingAgentId, releaseRunId);
    expect(released).not.toBeNull();
    expect(released?.status).toBe("todo");
    expect(released?.assigneeAgentId).toBeNull();
    expect(released?.checkoutRunId).toBeNull();
    expect(released?.executionRunId).toBeNull();
    expect(released?.executionAgentNameKey).toBeNull();
    expect(released?.executionLockedAt).toBeNull();

    const recheckedOut = await issuesSvc.checkout(issueId, nextAgentId, ["todo"], nextRunId);
    expect(recheckedOut.status).toBe("in_progress");
    expect(recheckedOut.assigneeAgentId).toBe(nextAgentId);
    expect(recheckedOut.checkoutRunId).toBe(nextRunId);
    expect(recheckedOut.executionRunId).toBe(nextRunId);
  });

  it("clears execution locks when an in-progress issue is reassigned", async () => {
    const companyId = randomUUID();
    const currentAgentId = randomUUID();
    const nextAgentId = randomUUID();
    const currentRunId = randomUUID();
    const issueId = randomUUID();
    const issuePrefix = `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`;
    const issuesSvc = issueService(db);

    await db.insert(companies).values({
      id: companyId,
      name: "Paperclip",
      issuePrefix,
      requireBoardApprovalForNewAgents: false,
    });

    await db.insert(agents).values([
      {
        id: currentAgentId,
        companyId,
        name: "Current Engineer",
        role: "engineer",
        status: "active",
        adapterType: "codex_local",
        adapterConfig: {},
        runtimeConfig: {},
        permissions: {},
      },
      {
        id: nextAgentId,
        companyId,
        name: "Next Engineer",
        role: "engineer",
        status: "active",
        adapterType: "codex_local",
        adapterConfig: {},
        runtimeConfig: {},
        permissions: {},
      },
    ]);

    await db.insert(heartbeatRuns).values({
      id: currentRunId,
      companyId,
      agentId: currentAgentId,
      invocationSource: "assignment",
      triggerDetail: "system",
      status: "running",
      contextSnapshot: { issueId },
    });

    await db.insert(issues).values({
      id: issueId,
      companyId,
      title: "Reassign should clear execution state",
      status: "in_progress",
      priority: "medium",
      assigneeAgentId: currentAgentId,
      checkoutRunId: currentRunId,
      executionRunId: currentRunId,
      executionAgentNameKey: "current-engineer",
      executionLockedAt: new Date("2026-03-23T07:00:00.000Z"),
      issueNumber: 1,
      identifier: `${issuePrefix}-1`,
    });

    const updated = await issuesSvc.update(issueId, {
      assigneeAgentId: nextAgentId,
    });

    expect(updated).not.toBeNull();
    expect(updated?.assigneeAgentId).toBe(nextAgentId);
    expect(updated?.checkoutRunId).toBeNull();
    expect(updated?.executionRunId).toBeNull();
    expect(updated?.executionAgentNameKey).toBeNull();
    expect(updated?.executionLockedAt).toBeNull();
  });

  it("recovers from a stale queued execution lock during checkout", async () => {
    const companyId = randomUUID();
    const agentId = randomUUID();
    const staleRunId = randomUUID();
    const issueId = randomUUID();
    const issuePrefix = `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`;
    const issuesSvc = issueService(db);

    await db.insert(companies).values({
      id: companyId,
      name: "Paperclip",
      issuePrefix,
      requireBoardApprovalForNewAgents: false,
    });

    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: "Recovery Engineer",
      role: "engineer",
      status: "active",
      adapterType: "codex_local",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    });

    await db.insert(heartbeatRuns).values({
      id: staleRunId,
      companyId,
      agentId,
      invocationSource: "assignment",
      triggerDetail: "system",
      status: "queued",
      contextSnapshot: { issueId },
      createdAt: new Date("2026-03-23T07:00:00.000Z"),
      updatedAt: new Date("2026-03-23T07:00:00.000Z"),
    });

    await db.insert(issues).values({
      id: issueId,
      companyId,
      title: "Checkout should recover stale queued locks",
      status: "todo",
      priority: "medium",
      executionRunId: staleRunId,
      executionAgentNameKey: "recovery-engineer",
      executionLockedAt: new Date("2026-03-23T07:00:00.000Z"),
      issueNumber: 1,
      identifier: `${issuePrefix}-1`,
    });

    const checkedOut = await issuesSvc.checkout(issueId, agentId, ["todo"], null);

    expect(checkedOut.status).toBe("in_progress");
    expect(checkedOut.assigneeAgentId).toBe(agentId);
    expect(checkedOut.checkoutRunId).toBeNull();
    expect(checkedOut.executionRunId).toBeNull();
    expect(checkedOut.executionLockedAt).toBeNull();
  });
});
