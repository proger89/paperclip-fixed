import fs from "node:fs";
import fsPromises from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  agents,
  applyPendingMigrations,
  companies,
  companyMemberships,
  createDb,
  ensurePostgresDatabase,
} from "@paperclipai/db";
import { accessService } from "../services/access.js";
import { agentService } from "../services/agents.js";

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
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "paperclip-agent-memberships-"));
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

describe("agent membership repair", () => {
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
    await db.delete(companyMemberships);
    await db.delete(agents);
    await db.delete(companies);
  });

  afterAll(async () => {
    await instance?.stop();
    if (dataDir) {
      await removeDirWithRetries(dataDir);
    }
  });

  async function seedCompany() {
    const companyId = randomUUID();
    const issuePrefix = `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`;
    await db.insert(companies).values({
      id: companyId,
      name: "Paperclip",
      issuePrefix,
      requireBoardApprovalForNewAgents: false,
    });
    return companyId;
  }

  it("creates a company_memberships row for every newly created agent", async () => {
    const companyId = await seedCompany();
    const svc = agentService(db);

    const created = await svc.create(companyId, {
      name: "Builder",
      role: "engineer",
      title: null,
      reportsTo: null,
      capabilities: null,
      adapterType: "process",
      adapterConfig: {},
      runtimeConfig: {},
      budgetMonthlyCents: 0,
      spentMonthlyCents: 0,
      permissions: {},
      status: "idle",
      lastHeartbeatAt: null,
      metadata: null,
    });

    const membership = await db
      .select()
      .from(companyMemberships)
      .where(
        and(
          eq(companyMemberships.companyId, companyId),
          eq(companyMemberships.principalType, "agent"),
          eq(companyMemberships.principalId, created.id),
        ),
      )
      .then((rows) => rows[0] ?? null);

    expect(membership).toMatchObject({
      companyId,
      principalType: "agent",
      principalId: created.id,
      status: "active",
      membershipRole: "member",
    });
  });

  it("backfills missing agent memberships when listing company members", async () => {
    const companyId = await seedCompany();
    const agentId = randomUUID();
    const access = accessService(db);

    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: "Legacy Agent",
      role: "engineer",
      title: null,
      reportsTo: null,
      capabilities: null,
      adapterType: "process",
      adapterConfig: {},
      runtimeConfig: {},
      budgetMonthlyCents: 0,
      spentMonthlyCents: 0,
      permissions: {},
      status: "idle",
      lastHeartbeatAt: null,
      metadata: null,
    });

    const members = await access.listMembers(companyId);
    const repaired = members.find(
      (member) => member.principalType === "agent" && member.principalId === agentId,
    );

    expect(repaired).toMatchObject({
      companyId,
      principalType: "agent",
      principalId: agentId,
      status: "active",
      membershipRole: "member",
    });
  });
});
