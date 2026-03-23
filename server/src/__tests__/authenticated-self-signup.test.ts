import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import express from "express";
import request from "supertest";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  activityLog,
  applyPendingMigrations,
  authAccounts,
  authSessions,
  authUsers,
  authVerifications,
  companies,
  companyMemberships,
  createDb,
  ensurePostgresDatabase,
  instanceUserRoles,
  invites,
  joinRequests,
  principalPermissionGrants,
  type Db,
} from "@paperclipai/db";
import { createBetterAuthHandler, createBetterAuthInstance, resolveBetterAuthSession } from "../auth/better-auth.js";
import { loadConfig } from "../config.js";
import { actorMiddleware } from "../middleware/auth.js";
import { boardMutationGuard } from "../middleware/board-mutation-guard.js";
import { errorHandler } from "../middleware/index.js";
import { accessRoutes } from "../routes/access.js";
import { companyRoutes } from "../routes/companies.js";
import { healthRoutes } from "../routes/health.js";

const TRUSTED_ORIGIN = "http://localhost:3100";

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
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "paperclip-authenticated-signup-"));
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

function createAuthenticatedApp(db: Db) {
  const config = {
    ...loadConfig(),
    deploymentMode: "authenticated" as const,
    deploymentExposure: "private" as const,
    authDisableSignUp: false,
    authBaseUrlMode: "explicit" as const,
    authPublicBaseUrl: "http://localhost",
    allowedHostnames: ["localhost"],
  };
  const auth = createBetterAuthInstance(db, config, ["http://localhost"]);
  const betterAuthHandler = createBetterAuthHandler(auth);
  const resolveSession = (req: express.Request) => resolveBetterAuthSession(auth, req);

  const app = express();
  app.use(express.json({
    verify: (req, _res, buf) => {
      (req as unknown as { rawBody: Buffer }).rawBody = buf;
    },
  }));
  app.use(actorMiddleware(db, {
    deploymentMode: "authenticated",
    resolveSession,
  }));
  app.get("/api/auth/get-session", (req, res) => {
    if (req.actor.type !== "board" || !req.actor.userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    res.json({
      session: {
        id: `paperclip:${req.actor.source}:${req.actor.userId}`,
        userId: req.actor.userId,
      },
      user: {
        id: req.actor.userId,
        email: null,
        name: null,
      },
    });
  });
  app.all("/api/auth/*authPath", betterAuthHandler);

  const api = express.Router();
  api.use(boardMutationGuard());
  api.use("/health", healthRoutes(db, {
    deploymentMode: "authenticated",
    deploymentExposure: "private",
    authReady: true,
    authDisableSignUp: false,
    companyDeletionEnabled: false,
  }));
  api.use("/companies", companyRoutes(db));
  api.use(accessRoutes(db, {
    deploymentMode: "authenticated",
    deploymentExposure: "private",
    bindHost: "127.0.0.1",
    allowedHostnames: ["localhost"],
  }));
  app.use("/api", api);
  app.use(errorHandler);
  return app;
}

async function signUp(
  agent: request.SuperAgentTest,
  name: string,
  email: string,
  password = "paperclip-password",
) {
  const res = await agent
    .post("/api/auth/sign-up/email")
    .set("Origin", TRUSTED_ORIGIN)
    .send({ name, email, password });
  expect(res.status).toBeLessThan(400);

  const sessionRes = await agent.get("/api/auth/get-session");
  if (sessionRes.status === 200) return;

  const signInRes = await agent
    .post("/api/auth/sign-in/email")
    .set("Origin", TRUSTED_ORIGIN)
    .send({ email, password });
  expect(signInRes.status).toBeLessThan(400);
}

async function createCompany(
  agent: request.SuperAgentTest,
  name: string,
) {
  const res = await agent
    .post("/api/companies")
    .set("Origin", TRUSTED_ORIGIN)
    .send({ name });
  expect(res.status).toBe(201);
  return res.body as { id: string; name: string };
}

describe("authenticated self-signup", () => {
  let db!: Db;
  let app!: express.Express;
  let instance: EmbeddedPostgresInstance | null = null;
  let dataDir = "";
  let previousSecret: string | undefined;

  beforeAll(async () => {
    previousSecret = process.env.BETTER_AUTH_SECRET;
    process.env.BETTER_AUTH_SECRET = "paperclip-authenticated-self-signup-test-secret";
    const started = await startTempDatabase();
    db = createDb(started.connectionString);
    app = createAuthenticatedApp(db);
    instance = started.instance;
    dataDir = started.dataDir;
  }, 20_000);

  afterEach(async () => {
    await db.delete(activityLog);
    await db.delete(principalPermissionGrants);
    await db.delete(joinRequests);
    await db.delete(invites);
    await db.delete(companyMemberships);
    await db.delete(instanceUserRoles);
    await db.delete(companies);
    await db.delete(authSessions);
    await db.delete(authAccounts);
    await db.delete(authVerifications);
    await db.delete(authUsers);
  });

  afterAll(async () => {
    if (previousSecret === undefined) {
      delete process.env.BETTER_AUTH_SECRET;
    } else {
      process.env.BETTER_AUTH_SECRET = previousSecret;
    }
    await instance?.stop();
    if (dataDir) {
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it("auto-promotes exactly one first registered user to instance_admin", async () => {
    const firstAgent = request.agent(app);
    const secondAgent = request.agent(app);

    await Promise.all([
      signUp(firstAgent, "First User", "first-user@paperclip.local"),
      signUp(secondAgent, "Second User", "second-user@paperclip.local"),
    ]);

    const admins = await db
      .select()
      .from(instanceUserRoles)
      .where(eq(instanceUserRoles.role, "instance_admin"));

    expect(admins).toHaveLength(1);

    const healthRes = await firstAgent.get("/api/health");
    expect(healthRes.status).toBe(200);
    expect(healthRes.body).toMatchObject({
      deploymentMode: "authenticated",
      authDisableSignUp: false,
    });
  });

  it("lets any signed-in user create a company and direct human invites grant access", async () => {
    const ownerAgent = request.agent(app);
    const teammateAgent = request.agent(app);

    await signUp(ownerAgent, "Owner User", "owner-user@paperclip.local");
    const ownerCompany = await createCompany(ownerAgent, "Owner Company");

    const ownerMembership = await db
      .select()
      .from(companyMemberships)
      .where(
        eq(companyMemberships.companyId, ownerCompany.id),
      )
      .then((rows) => rows.find((row) => row.principalType === "user"));
    expect(ownerMembership?.membershipRole).toBe("owner");

    const ownerInviteGrant = await db
      .select()
      .from(principalPermissionGrants)
      .where(eq(principalPermissionGrants.companyId, ownerCompany.id))
      .then((rows) =>
        rows.find(
          (row) =>
            row.principalType === "user" &&
            row.principalId === ownerMembership?.principalId &&
            row.permissionKey === "users:invite",
        ),
      );
    expect(ownerInviteGrant).toBeTruthy();

    await signUp(teammateAgent, "Teammate User", "teammate-user@paperclip.local");

    const preInviteCompaniesRes = await teammateAgent.get("/api/companies");
    expect(preInviteCompaniesRes.status).toBe(200);
    expect(preInviteCompaniesRes.body).toHaveLength(0);

    const teammateCompany = await createCompany(teammateAgent, "Teammate Company");
    const teammateCompaniesRes = await teammateAgent.get("/api/companies");
    expect(teammateCompaniesRes.status).toBe(200);
    expect(teammateCompaniesRes.body.map((company: { id: string }) => company.id)).toEqual([teammateCompany.id]);

    const inviteRes = await ownerAgent
      .post(`/api/companies/${ownerCompany.id}/invites`)
      .set("Origin", TRUSTED_ORIGIN)
      .send({ allowedJoinTypes: "human" });
    expect(inviteRes.status).toBe(201);
    const invite = inviteRes.body as { token: string };

    const acceptRes = await teammateAgent
      .post(`/api/invites/${invite.token}/accept`)
      .set("Origin", TRUSTED_ORIGIN)
      .send({ requestType: "human" });
    expect(acceptRes.status).toBe(202);
    expect(acceptRes.body).toMatchObject({
      requestType: "human",
      status: "approved",
    });

    const joinedCompaniesRes = await teammateAgent.get("/api/companies");
    expect(joinedCompaniesRes.status).toBe(200);
    const joinedIds = joinedCompaniesRes.body.map((company: { id: string }) => company.id).sort();
    expect(joinedIds).toEqual([ownerCompany.id, teammateCompany.id].sort());
  });
});
