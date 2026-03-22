import { randomUUID } from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  agents,
  applyPendingMigrations,
  companies,
  createDb,
  documentRevisions,
  documents,
  ensurePostgresDatabase,
  heartbeatRunEvents,
  heartbeatRuns,
  issueComments,
  issueDocuments,
  issues,
} from "@paperclipai/db";
import { documentService } from "../services/documents.js";
import { windowsEncodingRepairService } from "../services/windows-encoding-repair.js";
import {
  buildWindows1251Utf8Mojibake,
  buildWindowsEncodingPlaceholderSignature,
} from "../services/windows-encoding-utils.js";

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
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "paperclip-encoding-repair-"));
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

async function rmWithRetry(targetPath: string) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      fs.rmSync(targetPath, { recursive: true, force: true });
      return;
    } catch (error) {
      const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";
      if (code !== "EBUSY" || attempt === 4) throw error;
      await new Promise((resolve) => setTimeout(resolve, 150 * (attempt + 1)));
    }
  }
}

describe("windows encoding repair service", () => {
  let db!: ReturnType<typeof createDb>;
  let instance: EmbeddedPostgresInstance | null = null;
  let dataDir = "";
  let runLogDir = "";
  let previousRunLogBasePath: string | undefined;

  beforeAll(async () => {
    const started = await startTempDatabase();
    db = createDb(started.connectionString);
    instance = started.instance;
    dataDir = started.dataDir;
    runLogDir = fs.mkdtempSync(path.join(os.tmpdir(), "paperclip-run-logs-"));
    previousRunLogBasePath = process.env.RUN_LOG_BASE_PATH;
    process.env.RUN_LOG_BASE_PATH = runLogDir;
  }, 20_000);

  afterEach(async () => {
    await db.delete(issueDocuments);
    await db.delete(documentRevisions);
    await db.delete(documents);
    await db.delete(issueComments);
    await db.delete(heartbeatRunEvents);
    await db.delete(heartbeatRuns);
    await db.delete(issues);
    await db.delete(agents);
    await db.delete(companies);
    for (const entry of fs.readdirSync(runLogDir)) {
      fs.rmSync(path.join(runLogDir, entry), { recursive: true, force: true });
    }
  });

  afterAll(async () => {
    process.env.RUN_LOG_BASE_PATH = previousRunLogBasePath;
    await instance?.stop();
    if (dataDir) await rmWithRetry(dataDir);
    if (runLogDir) await rmWithRetry(runLogDir);
  });

  it("repairs exact-match corrupted issue content and skips unrecoverable rows", async () => {
    const companyId = randomUUID();
    const agentId = randomUUID();
    const issueId = randomUUID();
    const runId = randomUUID();
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "paperclip-workspace-"));
    const issuePrefix = `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`;
    const runStartedAt = new Date("2026-03-22T11:34:00.000Z");
    const runFinishedAt = new Date("2026-03-22T11:41:29.000Z");

    await db.insert(companies).values({
      id: companyId,
      name: "Paperclip",
      issuePrefix,
      requireBoardApprovalForNewAgents: false,
    });
    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: "Founding Engineer",
      role: "engineer",
      status: "paused",
      adapterType: "codex_local",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    });
    await db.insert(issues).values({
      id: issueId,
      companyId,
      title: "Repair mojibake",
      status: "in_progress",
      priority: "high",
      assigneeAgentId: agentId,
      issueNumber: 2,
      identifier: `${issuePrefix}-2`,
    });
    await db.insert(heartbeatRuns).values({
      id: runId,
      companyId,
      agentId,
      invocationSource: "automation",
      triggerDetail: "system",
      status: "succeeded",
      contextSnapshot: {
        issueId,
        paperclipWorkspace: {
          cwd: workspaceDir,
        },
      },
      startedAt: runStartedAt,
      finishedAt: runFinishedAt,
      logStore: "local_file",
      logRef: path.join(companyId, agentId, `${runId}.ndjson`),
    });
    await db.insert(heartbeatRunEvents).values({
      companyId,
      runId,
      agentId,
      seq: 1,
      eventType: "adapter.invoke",
      stream: "system",
      level: "info",
      message: "adapter invocation",
      payload: {
        env: {
          PAPERCLIP_WORKSPACE_CWD: workspaceDir,
        },
      },
    });

    fs.mkdirSync(path.join(runLogDir, companyId, agentId), { recursive: true });
    fs.mkdirSync(path.join(workspaceDir, "notes"), { recursive: true });

    const cleanCommentFromLog = "## Статус\n\nПайплайн обновлен и русский текст должен сохраниться.";
    const cleanCommentFromRepost = "## Статус\n\nВторая запись восстановлена поздним корректным репостом.";
    const cleanPlanBody = "# План\n\n## Статус\n\nРусский текст в плане восстановлен из workspace файла.";
    fs.writeFileSync(path.join(workspaceDir, "notes", "status.md"), cleanCommentFromLog, "utf8");
    fs.writeFileSync(path.join(workspaceDir, "notes", "plan.md"), cleanPlanBody, "utf8");

    const commentFromLogId = randomUUID();
    const commentFromRepostId = randomUUID();
    const laterCleanCommentId = randomUUID();
    const skippedCommentId = randomUUID();

    await db.insert(issueComments).values([
      {
        id: commentFromLogId,
        companyId,
        issueId,
        authorAgentId: agentId,
        body: buildWindowsEncodingPlaceholderSignature(cleanCommentFromLog),
        createdAt: new Date("2026-03-22T11:39:48.329Z"),
        updatedAt: new Date("2026-03-22T11:39:48.329Z"),
      },
      {
        id: commentFromRepostId,
        companyId,
        issueId,
        authorAgentId: agentId,
        body: buildWindowsEncodingPlaceholderSignature(cleanCommentFromRepost),
        createdAt: new Date("2026-03-22T11:39:10.886Z"),
        updatedAt: new Date("2026-03-22T11:39:10.886Z"),
      },
      {
        id: laterCleanCommentId,
        companyId,
        issueId,
        authorAgentId: agentId,
        body: cleanCommentFromRepost,
        createdAt: new Date("2026-03-22T11:40:54.860Z"),
        updatedAt: new Date("2026-03-22T11:40:54.860Z"),
      },
      {
        id: skippedCommentId,
        companyId,
        issueId,
        authorAgentId: agentId,
        body: "## ??????\n\n???? ?????? ?????? ??????? ???????.",
        createdAt: new Date("2026-03-22T11:38:00.000Z"),
        updatedAt: new Date("2026-03-22T11:38:00.000Z"),
      },
    ]);

    const planDocumentId = randomUUID();
    const planRevisionId = randomUUID();
    const fallbackTitleDocumentId = randomUUID();
    const fallbackTitleRevisionId = randomUUID();
    const revisionOnlyDocumentId = randomUUID();
    const revisionOnlyCorruptedId = randomUUID();
    const revisionOnlyCleanId = randomUUID();

    await db.insert(documents).values([
      {
        id: planDocumentId,
        companyId,
        title: "????",
        format: "markdown",
        latestBody: buildWindowsEncodingPlaceholderSignature(cleanPlanBody),
        latestRevisionId: planRevisionId,
        latestRevisionNumber: 1,
        createdByAgentId: agentId,
        updatedByAgentId: agentId,
        createdAt: new Date("2026-03-22T11:39:48.000Z"),
        updatedAt: new Date("2026-03-22T11:39:48.000Z"),
      },
      {
        id: fallbackTitleDocumentId,
        companyId,
        title: "????",
        format: "markdown",
        latestBody: "body",
        latestRevisionId: fallbackTitleRevisionId,
        latestRevisionNumber: 1,
        createdByAgentId: agentId,
        updatedByAgentId: agentId,
        createdAt: new Date("2026-03-22T11:39:48.000Z"),
        updatedAt: new Date("2026-03-22T11:39:48.000Z"),
      },
      {
        id: revisionOnlyDocumentId,
        companyId,
        title: null,
        format: "markdown",
        latestBody: cleanCommentFromRepost,
        latestRevisionId: revisionOnlyCleanId,
        latestRevisionNumber: 2,
        createdByAgentId: agentId,
        updatedByAgentId: agentId,
        createdAt: new Date("2026-03-22T11:39:48.000Z"),
        updatedAt: new Date("2026-03-22T11:40:54.000Z"),
      },
    ]);
    await db.insert(issueDocuments).values([
      { id: randomUUID(), companyId, issueId, documentId: planDocumentId, key: "plan" },
      { id: randomUUID(), companyId, issueId, documentId: fallbackTitleDocumentId, key: "notes" },
      { id: randomUUID(), companyId, issueId, documentId: revisionOnlyDocumentId, key: "spec" },
    ]);
    await db.insert(documentRevisions).values([
      {
        id: planRevisionId,
        companyId,
        documentId: planDocumentId,
        revisionNumber: 1,
        body: buildWindowsEncodingPlaceholderSignature(cleanPlanBody),
        createdByAgentId: agentId,
        createdAt: new Date("2026-03-22T11:39:48.000Z"),
      },
      {
        id: fallbackTitleRevisionId,
        companyId,
        documentId: fallbackTitleDocumentId,
        revisionNumber: 1,
        body: "body",
        createdByAgentId: agentId,
        createdAt: new Date("2026-03-22T11:39:48.000Z"),
      },
      {
        id: revisionOnlyCorruptedId,
        companyId,
        documentId: revisionOnlyDocumentId,
        revisionNumber: 1,
        body: buildWindowsEncodingPlaceholderSignature(cleanCommentFromRepost),
        createdByAgentId: agentId,
        createdAt: new Date("2026-03-22T11:39:10.000Z"),
      },
      {
        id: revisionOnlyCleanId,
        companyId,
        documentId: revisionOnlyDocumentId,
        revisionNumber: 2,
        body: cleanCommentFromRepost,
        createdByAgentId: agentId,
        createdAt: new Date("2026-03-22T11:40:54.000Z"),
      },
    ]);

    const commentCommand = {
      type: "item.completed",
      item: {
        type: "command_execution",
        command: [
          `"C:\\\\windows\\\\System32\\\\WindowsPowerShell\\\\v1.0\\\\powershell.exe" -Command "@'`,
          "import json",
          "comment_body = (workspace / 'notes' / 'status.md').read_text(encoding='utf-8')",
          `req = request.Request("http://127.0.0.1:3101/api/issues/${issueId}/comments")`,
          "'@ | python -",
        ].join("\n"),
        aggregated_output: `${commentFromLogId}\r\n## Статус\r\n`,
        exit_code: 0,
        status: "completed",
      },
    };
    const documentCommand = {
      type: "item.completed",
      item: {
        type: "command_execution",
        command: [
          `"C:\\\\windows\\\\System32\\\\WindowsPowerShell\\\\v1.0\\\\powershell.exe" -Command "@'`,
          "import json",
          "plan_body = (workspace / 'notes' / 'plan.md').read_text(encoding='utf-8')",
          "payload = json.dumps({'title': 'План', 'body': plan_body}, ensure_ascii=False).encode('utf-8')",
          `req = request.Request("http://127.0.0.1:3101/api/issues/${issueId}/documents/plan", data=payload)`,
          "'@ | python -",
        ].join("\n"),
        aggregated_output: "1\r\nПлан\r\n",
        exit_code: 0,
        status: "completed",
      },
    };
    const logLines = [
      JSON.stringify({ ts: "2026-03-22T11:39:48.000Z", stream: "stdout", chunk: `${JSON.stringify(commentCommand)}\n` }),
      JSON.stringify({ ts: "2026-03-22T11:39:48.000Z", stream: "stdout", chunk: `${JSON.stringify(documentCommand)}\n` }),
    ].join("\n");
    fs.writeFileSync(path.join(runLogDir, companyId, agentId, `${runId}.ndjson`), logLines, "utf8");

    const service = windowsEncodingRepairService(db);
    const dryRunReport = await service.repair({ issueId, dryRun: true });

    expect(dryRunReport.repairedComments).toBe(2);
    expect(dryRunReport.repairedDocuments).toBe(1);
    expect(dryRunReport.repairedDocumentRevisions).toBe(1);
    expect(dryRunReport.normalizedDocumentTitles).toBe(2);
    expect(dryRunReport.skipped).toBe(1);

    const applyReport = await service.repair({ issueId, dryRun: false });
    expect(applyReport.repairedComments).toBe(2);

    const repairedComment = await db
      .select()
      .from(issueComments)
      .where(eq(issueComments.id, commentFromLogId))
      .then((rows) => rows[0]!);
    expect(repairedComment.body).toBe(cleanCommentFromLog);

    const repairedRepostComment = await db
      .select()
      .from(issueComments)
      .where(eq(issueComments.id, commentFromRepostId))
      .then((rows) => rows[0]!);
    expect(repairedRepostComment.body).toBe(cleanCommentFromRepost);

    const skippedComment = await db
      .select()
      .from(issueComments)
      .where(eq(issueComments.id, skippedCommentId))
      .then((rows) => rows[0]!);
    expect(skippedComment.body).toContain("????");

    const repairedPlanDoc = await db
      .select()
      .from(documents)
      .where(eq(documents.id, planDocumentId))
      .then((rows) => rows[0]!);
    expect(repairedPlanDoc.title).toBe("План");
    expect(repairedPlanDoc.latestBody).toBe(cleanPlanBody);

    const nullTitleDoc = await db
      .select()
      .from(documents)
      .where(eq(documents.id, fallbackTitleDocumentId))
      .then((rows) => rows[0]!);
    expect(nullTitleDoc.title).toBeNull();

    const repairedRevision = await db
      .select()
      .from(documentRevisions)
      .where(eq(documentRevisions.id, revisionOnlyCorruptedId))
      .then((rows) => rows[0]!);
    expect(repairedRevision.body).toBe(cleanCommentFromRepost);

    const payload = await documentService(db).getIssueDocumentPayload({ id: issueId, description: null });
    expect(payload.planDocument?.title).toBe("План");

    await db.update(documents).set({ title: "????" }).where(eq(documents.id, fallbackTitleDocumentId));
    const listDocs = await documentService(db).listIssueDocuments(issueId);
    expect(listDocs.find((doc) => doc.id === fallbackTitleDocumentId)?.title).toBeNull();
  });

  it("repairs issue status comments from inline Windows-1251 mojibake in run logs", async () => {
    const companyId = randomUUID();
    const agentId = randomUUID();
    const issueId = randomUUID();
    const runId = randomUUID();
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "paperclip-inline-comment-"));
    const issuePrefix = `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`;
    const inlineCommentId = randomUUID();
    const intendedComment =
      "## \u0413\u043e\u0442\u043e\u0432\u043e\n\n\u0418\u0437\u0443\u0447\u0438\u043b \u043a\u0430\u043d\u0430\u043b \u0438 \u0441\u043e\u0431\u0440\u0430\u043b \u0441\u0442\u0438\u043b\u044c.\n- \u0410\u0440\u0442\u0435\u0444\u0430\u043a\u0442: `AUTHOR_PROFILE_SENIOR_RUSLAN.md`";
    const inlineCommentMojibake = buildWindows1251Utf8Mojibake(intendedComment)?.replace(
      "`AUTHOR_PROFILE_SENIOR_RUSLAN.md`",
      "\"'`AUTHOR_PROFILE_SENIOR_RUSLAN.md`",
    );

    expect(inlineCommentMojibake).toBeTruthy();

    await db.insert(companies).values({
      id: companyId,
      name: "Paperclip",
      issuePrefix,
      requireBoardApprovalForNewAgents: false,
    });
    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: "CEO",
      role: "ceo",
      status: "paused",
      adapterType: "codex_local",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    });
    await db.insert(issues).values({
      id: issueId,
      companyId,
      title: "Inline comment repair",
      status: "done",
      priority: "high",
      assigneeAgentId: agentId,
      issueNumber: 7,
      identifier: `${issuePrefix}-7`,
    });
    await db.insert(heartbeatRuns).values({
      id: runId,
      companyId,
      agentId,
      invocationSource: "assignment",
      triggerDetail: "system",
      status: "succeeded",
      contextSnapshot: {
        issueId,
        paperclipWorkspace: {
          cwd: workspaceDir,
        },
      },
      startedAt: new Date("2026-03-22T11:48:39.142Z"),
      finishedAt: new Date("2026-03-22T11:55:05.957Z"),
      logStore: "local_file",
      logRef: path.join(companyId, agentId, `${runId}.ndjson`),
    });
    await db.insert(heartbeatRunEvents).values({
      companyId,
      runId,
      agentId,
      seq: 1,
      eventType: "adapter.invoke",
      stream: "system",
      level: "info",
      message: "adapter invocation",
      payload: {
        env: {
          PAPERCLIP_WORKSPACE_CWD: workspaceDir,
        },
      },
    });
    await db.insert(issueComments).values({
      id: inlineCommentId,
      companyId,
      issueId,
      authorAgentId: agentId,
      body: buildWindowsEncodingPlaceholderSignature(intendedComment),
      createdAt: new Date("2026-03-22T11:53:28.121Z"),
      updatedAt: new Date("2026-03-22T11:53:28.121Z"),
    });

    fs.mkdirSync(path.join(runLogDir, companyId, agentId), { recursive: true });

    const inlineCommentCommand = {
      type: "item.completed",
      item: {
        type: "command_execution",
        command: [
          `"C:\\\\windows\\\\System32\\\\WindowsPowerShell\\\\v1.0\\\\powershell.exe" -Command '$headers=@{ Authorization = "Bearer token"; "X-Paperclip-Run-Id" = "${runId}"; "Content-Type"="application/json" }; $comment = @'`,
          inlineCommentMojibake,
          "'@;",
          `$payload=@{ status='done'; comment=$comment } | ConvertTo-Json; Invoke-RestMethod -Method Patch -Uri "http://127.0.0.1:3101/api/issues/${issueId}" -Headers $headers -Body $payload | ConvertTo-Json -Depth 10'`,
        ].join("\n"),
        aggregated_output: JSON.stringify({
          id: issueId,
          identifier: `${issuePrefix}-7`,
          comment: {
            id: inlineCommentId,
          },
        }),
        exit_code: 0,
        status: "completed",
      },
    };

    fs.writeFileSync(
      path.join(runLogDir, companyId, agentId, `${runId}.ndjson`),
      `${JSON.stringify({ ts: "2026-03-22T11:53:28.460Z", stream: "stdout", chunk: `${JSON.stringify(inlineCommentCommand)}\n` })}\n`,
      "utf8",
    );

    const service = windowsEncodingRepairService(db);
    const report = await service.repair({ issueId, dryRun: false });

    expect(report.repairedComments).toBe(1);
    expect(report.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "comment",
          targetId: inlineCommentId,
          action: "repair",
          source: "run_log_inline_comment",
        }),
      ]),
    );

    const repairedComment = await db
      .select()
      .from(issueComments)
      .where(eq(issueComments.id, inlineCommentId))
      .then((rows) => rows[0]!);
    expect(repairedComment.body).toBe(intendedComment);
  });

  it("repairs inline Python comment bodies posted directly to /comments", async () => {
    const companyId = randomUUID();
    const agentId = randomUUID();
    const issueId = randomUUID();
    const runId = randomUUID();
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "paperclip-inline-python-comment-"));
    const issuePrefix = `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`;
    const inlineCommentId = randomUUID();
    const intendedComment =
      "## \u0421\u0442\u0430\u0442\u0443\u0441\n\nMVP \u043f\u043e `TEL-2` \u043e\u0431\u043d\u043e\u0432\u043b\u0435\u043d \u043f\u043e\u0434 \u043d\u043e\u0432\u044b\u0439 \u043a\u043e\u043c\u043c\u0435\u043d\u0442\u0430\u0440\u0438\u0439 board.\n\n- \u0431\u044b\u0441\u0442\u0440\u044b\u0439 \u043f\u0443\u0442\u044c: \u043f\u0430\u0440\u0441\u0438\u043d\u0433 \u043f\u0443\u0431\u043b\u0438\u0447\u043d\u044b\u0445 `t.me/s/<channel>`\n- \u0430\u0440\u0442\u0435\u0444\u0430\u043a\u0442: `output/board_public_queue.md`";
    const inlineCommentMojibake = buildWindows1251Utf8Mojibake(intendedComment)?.replace(
      "`t.me/s/<channel>`",
      "\"'`t.me/s/<channel>`",
    );

    expect(inlineCommentMojibake).toBeTruthy();

    await db.insert(companies).values({
      id: companyId,
      name: "Paperclip",
      issuePrefix,
      requireBoardApprovalForNewAgents: false,
    });
    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: "Founding Engineer",
      role: "engineer",
      status: "paused",
      adapterType: "codex_local",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    });
    await db.insert(issues).values({
      id: issueId,
      companyId,
      title: "Inline python comment repair",
      status: "in_progress",
      priority: "high",
      assigneeAgentId: agentId,
      issueNumber: 2,
      identifier: `${issuePrefix}-2`,
    });
    await db.insert(heartbeatRuns).values({
      id: runId,
      companyId,
      agentId,
      invocationSource: "automation",
      triggerDetail: "system",
      status: "succeeded",
      contextSnapshot: {
        issueId,
        paperclipWorkspace: {
          cwd: workspaceDir,
        },
      },
      startedAt: new Date("2026-03-22T11:45:42.472Z"),
      finishedAt: new Date("2026-03-22T11:51:13.920Z"),
      logStore: "local_file",
      logRef: path.join(companyId, agentId, `${runId}.ndjson`),
    });
    await db.insert(heartbeatRunEvents).values({
      companyId,
      runId,
      agentId,
      seq: 1,
      eventType: "adapter.invoke",
      stream: "system",
      level: "info",
      message: "adapter invocation",
      payload: {
        env: {
          PAPERCLIP_WORKSPACE_CWD: workspaceDir,
        },
      },
    });
    await db.insert(issueComments).values({
      id: inlineCommentId,
      companyId,
      issueId,
      authorAgentId: agentId,
      body: buildWindowsEncodingPlaceholderSignature(intendedComment),
      createdAt: new Date("2026-03-22T11:50:59.390Z"),
      updatedAt: new Date("2026-03-22T11:50:59.390Z"),
    });

    fs.mkdirSync(path.join(runLogDir, companyId, agentId), { recursive: true });

    const inlineCommentCommand = {
      type: "item.completed",
      item: {
        type: "command_execution",
        command: [
          `"C:\\\\windows\\\\System32\\\\WindowsPowerShell\\\\v1.0\\\\powershell.exe" -Command "@'`,
          "import json",
          "import os",
          "from urllib import request",
          "",
          "api_url = os.environ['PAPERCLIP_API_URL'].rstrip('/')",
          "issue_id = os.environ['PAPERCLIP_TASK_ID']",
          "api_key = os.environ['PAPERCLIP_API_KEY']",
          "run_id = os.environ['PAPERCLIP_RUN_ID']",
          `comment_body = \\\"\\\"\\\"${inlineCommentMojibake}\\\"\\\"\\\"`,
          `payload = json.dumps({'body': comment_body}, ensure_ascii=False).encode('utf-8')`,
          "headers = {",
          "    'Authorization': f'Bearer {api_key}',",
          "    'X-Paperclip-Run-Id': run_id,",
          "    'Content-Type': 'application/json; charset=utf-8',",
          "}",
          `req = request.Request(f\\"{api_url}/api/issues/{issue_id}/comments\\", data=payload, headers=headers, method='POST')`,
          "with request.urlopen(req) as response:",
          "    result = json.load(response)",
          "print(result['id'])",
          `'@ | python -"`,
        ].join("\n"),
        aggregated_output: `${inlineCommentId}\r\n`,
        exit_code: 0,
        status: "completed",
      },
    };

    fs.writeFileSync(
      path.join(runLogDir, companyId, agentId, `${runId}.ndjson`),
      `${JSON.stringify({ ts: "2026-03-22T11:50:59.883Z", stream: "stdout", chunk: `${JSON.stringify(inlineCommentCommand)}\n` })}\n`,
      "utf8",
    );

    const service = windowsEncodingRepairService(db);
    const report = await service.repair({ issueId, dryRun: false });

    expect(report.repairedComments).toBe(1);
    expect(report.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "comment",
          targetId: inlineCommentId,
          action: "repair",
          source: "run_log_inline_comment",
        }),
      ]),
    );

    const repairedComment = await db
      .select()
      .from(issueComments)
      .where(eq(issueComments.id, inlineCommentId))
      .then((rows) => rows[0]!);
    expect(repairedComment.body).toBe(intendedComment);
  });
});
