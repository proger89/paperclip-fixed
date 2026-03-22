import { promises as fs } from "node:fs";
import path from "node:path";
import { and, desc, eq, inArray } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  documentRevisions,
  documents,
  heartbeatRunEvents,
  heartbeatRuns,
  issueComments,
  issueDocuments,
  issues,
} from "@paperclipai/db";
import { getRunLogStore } from "./run-log-store.js";
import {
  buildWindowsEncodingPlaceholderSignature,
  isLikelyWindowsEncodingCorruption,
  normalizeCorruptedDocumentTitle,
  normalizeWindowsEncodingLineEndings,
  previewWindowsEncodingValue,
  recoverWindows1251Utf8Mojibake,
} from "./windows-encoding-utils.js";

type RepairSource =
  | "later_clean_repost"
  | "later_clean_revision"
  | "run_log_inline_comment"
  | "run_log_workspace_file"
  | "run_log_inline_title"
  | "placeholder_title_null";

type RepairAction = "repair" | "normalize_title" | "skip";

export type WindowsEncodingRepairDetail = {
  kind: "comment" | "document_body" | "document_revision" | "document_title";
  targetId: string;
  issueId: string;
  issueIdentifier: string | null;
  documentKey?: string | null;
  runId?: string | null;
  action: RepairAction;
  source?: RepairSource;
  reason?: string;
  before: string | null;
  after?: string | null;
};

export type WindowsEncodingRepairReport = {
  dryRun: boolean;
  scannedComments: number;
  scannedDocuments: number;
  scannedDocumentRevisions: number;
  repairedComments: number;
  repairedDocuments: number;
  repairedDocumentRevisions: number;
  normalizedDocumentTitles: number;
  skipped: number;
  details: WindowsEncodingRepairDetail[];
};

type RepairFilters = {
  companyId?: string | null;
  issueId?: string | null;
  issueIdentifier?: string | null;
  runId?: string | null;
  commentId?: string | null;
  documentId?: string | null;
  dryRun?: boolean;
};

type CandidateComment = {
  id: string;
  companyId: string;
  issueId: string;
  issueIdentifier: string | null;
  authorAgentId: string | null;
  authorUserId: string | null;
  body: string;
  createdAt: Date;
};

type CandidateDocument = {
  id: string;
  companyId: string;
  issueId: string;
  issueIdentifier: string | null;
  key: string;
  title: string | null;
  latestBody: string;
  latestRevisionId: string | null;
  createdByAgentId: string | null;
  updatedByAgentId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type CandidateRevision = {
  id: string;
  companyId: string;
  issueId: string;
  issueIdentifier: string | null;
  key: string;
  documentId: string;
  revisionNumber: number;
  body: string;
  createdByAgentId: string | null;
  createdAt: Date;
};

type RunRow = {
  id: string;
  companyId: string;
  agentId: string;
  startedAt: Date | null;
  finishedAt: Date | null;
  createdAt: Date;
  contextSnapshot: Record<string, unknown> | null;
  logStore: string | null;
  logRef: string | null;
};

type ParsedCommandExecution = {
  ts: Date | null;
  command: string;
  aggregatedOutput: string;
};

type ParsedRunRecovery = {
  run: RunRow;
  workspaceCwd: string | null;
  commands: ParsedCommandExecution[];
};

type InlineDocumentTitleSource = {
  title: string;
  runId: string;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function readIssueIdFromRunContext(contextSnapshot: Record<string, unknown> | null): string | null {
  return readString(contextSnapshot?.issueId);
}

function normalizeSignature(text: string): string {
  return buildWindowsEncodingPlaceholderSignature(text);
}

function couldBelongToRun(run: RunRow, issueId: string, agentId: string | null, createdAt: Date): boolean {
  if (agentId && run.agentId !== agentId) return false;
  const runIssueId = readIssueIdFromRunContext(run.contextSnapshot);
  if (runIssueId && runIssueId !== issueId) return false;

  const startedAt = run.startedAt ?? run.createdAt;
  const finishedAt = run.finishedAt ?? new Date(run.createdAt.getTime() + 60 * 60 * 1000);
  const lowerBound = startedAt.getTime() - 15 * 60 * 1000;
  const upperBound = finishedAt.getTime() + 15 * 60 * 1000;
  const candidateTime = createdAt.getTime();
  return candidateTime >= lowerBound && candidateTime <= upperBound;
}

function extractCommandExecutions(logContent: string): ParsedCommandExecution[] {
  const parsed: ParsedCommandExecution[] = [];
  for (const rawLine of logContent.split(/\r?\n/)) {
    if (!rawLine.trim()) continue;
    let outer: { ts?: string; stream?: string; chunk?: string } | null = null;
    try {
      outer = JSON.parse(rawLine) as { ts?: string; stream?: string; chunk?: string };
    } catch {
      continue;
    }
    if (outer?.stream !== "stdout" || typeof outer.chunk !== "string") continue;
    for (const chunkLine of outer.chunk.split(/\r?\n/)) {
      const line = chunkLine.trim();
      if (!line.startsWith("{")) continue;
      let event: { type?: string; item?: Record<string, unknown> } | null = null;
      try {
        event = JSON.parse(line) as { type?: string; item?: Record<string, unknown> };
      } catch {
        continue;
      }
      if (event?.type !== "item.completed") continue;
      const item = asRecord(event.item);
      if (readString(item?.type) !== "command_execution") continue;
      parsed.push({
        ts: outer.ts ? new Date(outer.ts) : null,
        command: typeof item?.command === "string" ? item.command : "",
        aggregatedOutput: typeof item?.aggregated_output === "string" ? item.aggregated_output : "",
      });
    }
  }
  return parsed;
}

function extractWorkspaceCwd(run: RunRow, eventPayload: Record<string, unknown> | null): string | null {
  const fromEventEnv = asRecord(eventPayload?.env);
  const fromEvent = readString(fromEventEnv?.PAPERCLIP_WORKSPACE_CWD);
  if (fromEvent) return fromEvent;
  const context = asRecord(run.contextSnapshot);
  const workspace = asRecord(context?.paperclipWorkspace);
  return readString(workspace?.cwd);
}

function extractPythonWorkspaceRelativePath(command: string): string | null {
  const direct = /Path\((['"])([^'"]+)\1\)\.read_text\(\s*encoding\s*=\s*(['"])utf-8\3\s*\)/su.exec(command);
  if (direct) return direct[2] ?? null;

  const workspaceSegments =
    /(?:\(\s*)?workspace((?:\s*\/\s*['"][^'"]+['"])+)(?:\s*\))?\.read_text\(\s*encoding\s*=\s*(['"])utf-8\2\s*\)/su.exec(command);
  if (!workspaceSegments) return null;
  const segments = Array.from(workspaceSegments[1]!.matchAll(/['"]([^'"]+)['"]/g), (match) => match[1]!);
  return segments.length > 0 ? path.join(...segments) : null;
}

function extractCommentIdFromOutput(output: string): string | null {
  const normalized = normalizeWindowsEncodingLineEndings(output);
  const firstLine = normalized.split("\n").map((line) => line.trim()).find(Boolean);
  return firstLine && /^[0-9a-f-]{8,}$/i.test(firstLine) ? firstLine : null;
}

function extractInlineTitleFromCommand(command: string): string | null {
  const match = /['"]title['"]\s*:\s*['"]([^'"]+)['"]/su.exec(command);
  return match?.[1] ?? null;
}

function extractCommentIdFromIssueMutationOutput(output: string): string | null {
  const direct = extractCommentIdFromOutput(output);
  if (direct) return direct;

  const normalized = normalizeWindowsEncodingLineEndings(output).trim();
  const jsonStart = normalized.indexOf("{");
  if (jsonStart >= 0) {
    try {
      const parsed = JSON.parse(normalized.slice(jsonStart)) as { id?: string; comment?: { id?: string } };
      if (typeof parsed.comment?.id === "string") return parsed.comment.id;
      if (typeof parsed.id === "string") return parsed.id;
    } catch {
      // Fall through to regex matching when the payload is not valid JSON.
    }
  }

  const nestedMatch = /"comment"\s*:\s*\{[\s\S]*?"id"\s*:\s*"([0-9a-f-]{8,})"/iu.exec(normalized);
  if (nestedMatch?.[1]) return nestedMatch[1];
  const topLevelMatch = /"id"\s*:\s*"([0-9a-f-]{8,})"/iu.exec(normalized);
  return topLevelMatch?.[1] ?? null;
}

function extractInlineCommentFromCommand(command: string): string | null {
  const normalized = normalizeWindowsEncodingLineEndings(command);
  const start = normalized.search(/\$comment\s*=\s*@/u);
  if (start >= 0) {
    const bodyStart = normalized.indexOf("\n", start);
    if (bodyStart < 0) return null;

    const remainder = normalized.slice(bodyStart + 1);
    const terminator = /\n(?:['"\\]){0,4}@(?:;|\s+\|)/u.exec(remainder);
    if (!terminator) return null;

    const inline = remainder.slice(0, terminator.index);
    return inline.length > 0 ? inline : null;
  }

  const pythonTripleDouble = /\bcomment_body\s*=\s*(?:(?:\\"){3}|""")([\s\S]*?)(?:(?:\\"){3}|""")/u.exec(normalized);
  if (pythonTripleDouble?.[1]) return pythonTripleDouble[1];

  const pythonTripleSingle = /\bcomment_body\s*=\s*(?:(?:\\'){3}|''')([\s\S]*?)(?:(?:\\'){3}|''')/u.exec(normalized);
  if (pythonTripleSingle?.[1]) return pythonTripleSingle[1];

  return null;
}

function sanitizePowerShellInlineText(text: string): string {
  return text.replace(/"'+(?=`)/g, "").replace(/'+(?=`)/g, "");
}

async function readFileSource(filePath: string, cache: Map<string, string | null>): Promise<string | null> {
  if (cache.has(filePath)) return cache.get(filePath) ?? null;
  const value = await fs.readFile(filePath, "utf8").catch(() => null);
  cache.set(filePath, value);
  return value;
}

async function loadRunRecoveryData(db: Db, runs: RunRow[]): Promise<Map<string, ParsedRunRecovery>> {
  const runIds = runs.map((run) => run.id);
  const adapterInvokeEvents =
    runIds.length > 0
      ? await db
          .select({
            runId: heartbeatRunEvents.runId,
            payload: heartbeatRunEvents.payload,
          })
          .from(heartbeatRunEvents)
          .where(and(inArray(heartbeatRunEvents.runId, runIds), eq(heartbeatRunEvents.eventType, "adapter.invoke")))
      : [];

  const eventByRunId = new Map(adapterInvokeEvents.map((event) => [event.runId, asRecord(event.payload)]));
  const runLogStore = getRunLogStore();
  const parsed = new Map<string, ParsedRunRecovery>();

  for (const run of runs) {
    let commands: ParsedCommandExecution[] = [];
    if (run.logStore && run.logRef) {
      const fullLog = await runLogStore
        .read({ store: run.logStore as "local_file", logRef: run.logRef }, { offset: 0, limitBytes: 4 * 1024 * 1024 })
        .catch(() => null);
      if (fullLog?.content) {
        commands = extractCommandExecutions(fullLog.content);
      }
    }
    parsed.set(run.id, {
      run,
      workspaceCwd: extractWorkspaceCwd(run, eventByRunId.get(run.id) ?? null),
      commands,
    });
  }

  return parsed;
}

function pickSingleExactSource<T>(sources: T[]): T | null {
  return sources.length === 1 ? sources[0] : null;
}

function compareByCreatedAtDesc<T extends { createdAt: Date }>(left: T, right: T) {
  return right.createdAt.getTime() - left.createdAt.getTime();
}

export function windowsEncodingRepairService(db: Db) {
  return {
    repair: async (filters: RepairFilters = {}): Promise<WindowsEncodingRepairReport> => {
      const dryRun = filters.dryRun !== false;
      const details: WindowsEncodingRepairDetail[] = [];
      const issueFilter = readString(filters.issueId);
      const issueIdentifierFilter = readString(filters.issueIdentifier)?.toUpperCase() ?? null;
      const companyFilter = readString(filters.companyId);
      const runFilter = readString(filters.runId);
      const commentFilter = readString(filters.commentId);
      const documentFilter = readString(filters.documentId);

      const issueRows = await db
        .select({ id: issues.id, identifier: issues.identifier })
        .from(issues)
        .where(
          and(
            ...(companyFilter ? [eq(issues.companyId, companyFilter)] : []),
            ...(issueFilter ? [eq(issues.id, issueFilter)] : []),
            ...(issueIdentifierFilter ? [eq(issues.identifier, issueIdentifierFilter)] : []),
          ),
        );
      if ((issueFilter || issueIdentifierFilter) && issueRows.length === 0) {
        return {
          dryRun,
          scannedComments: 0,
          scannedDocuments: 0,
          scannedDocumentRevisions: 0,
          repairedComments: 0,
          repairedDocuments: 0,
          repairedDocumentRevisions: 0,
          normalizedDocumentTitles: 0,
          skipped: 0,
          details: [],
        };
      }
      const filteredIssueIds = issueRows.map((row) => row.id);
      const issueIdsOrAll = filteredIssueIds.length > 0 ? filteredIssueIds : undefined;

      const commentRows = await db
        .select({
          id: issueComments.id,
          companyId: issueComments.companyId,
          issueId: issueComments.issueId,
          issueIdentifier: issues.identifier,
          authorAgentId: issueComments.authorAgentId,
          authorUserId: issueComments.authorUserId,
          body: issueComments.body,
          createdAt: issueComments.createdAt,
        })
        .from(issueComments)
        .innerJoin(issues, eq(issueComments.issueId, issues.id))
        .where(
          and(
            ...(companyFilter ? [eq(issueComments.companyId, companyFilter)] : []),
            ...(issueIdsOrAll ? [inArray(issueComments.issueId, issueIdsOrAll)] : []),
            ...(commentFilter ? [eq(issueComments.id, commentFilter)] : []),
          ),
        );

      const documentRows = await db
        .select({
          id: documents.id,
          companyId: documents.companyId,
          issueId: issueDocuments.issueId,
          issueIdentifier: issues.identifier,
          key: issueDocuments.key,
          title: documents.title,
          latestBody: documents.latestBody,
          latestRevisionId: documents.latestRevisionId,
          createdByAgentId: documents.createdByAgentId,
          updatedByAgentId: documents.updatedByAgentId,
          createdAt: documents.createdAt,
          updatedAt: documents.updatedAt,
        })
        .from(issueDocuments)
        .innerJoin(documents, eq(issueDocuments.documentId, documents.id))
        .innerJoin(issues, eq(issueDocuments.issueId, issues.id))
        .where(
          and(
            ...(companyFilter ? [eq(documents.companyId, companyFilter)] : []),
            ...(issueIdsOrAll ? [inArray(issueDocuments.issueId, issueIdsOrAll)] : []),
            ...(documentFilter ? [eq(documents.id, documentFilter)] : []),
          ),
        );

      const revisionRows = await db
        .select({
          id: documentRevisions.id,
          companyId: documentRevisions.companyId,
          issueId: issueDocuments.issueId,
          issueIdentifier: issues.identifier,
          key: issueDocuments.key,
          documentId: documentRevisions.documentId,
          revisionNumber: documentRevisions.revisionNumber,
          body: documentRevisions.body,
          createdByAgentId: documentRevisions.createdByAgentId,
          createdAt: documentRevisions.createdAt,
        })
        .from(documentRevisions)
        .innerJoin(issueDocuments, eq(issueDocuments.documentId, documentRevisions.documentId))
        .innerJoin(issues, eq(issueDocuments.issueId, issues.id))
        .where(
          and(
            ...(companyFilter ? [eq(documentRevisions.companyId, companyFilter)] : []),
            ...(issueIdsOrAll ? [inArray(issueDocuments.issueId, issueIdsOrAll)] : []),
            ...(documentFilter ? [eq(documentRevisions.documentId, documentFilter)] : []),
          ),
        );

      const candidateComments = commentRows.filter((row) => isLikelyWindowsEncodingCorruption(row.body));
      const candidateDocuments = documentRows.filter(
        (row) =>
          isLikelyWindowsEncodingCorruption(row.latestBody) ||
          normalizeCorruptedDocumentTitle(row.title) !== row.title,
      );
      const candidateRevisions = revisionRows.filter((row) => isLikelyWindowsEncodingCorruption(row.body));

      const relevantIssueIds = new Set([
        ...candidateComments.map((row) => row.issueId),
        ...candidateDocuments.map((row) => row.issueId),
        ...candidateRevisions.map((row) => row.issueId),
      ]);
      const relevantAgentIds = new Set([
        ...candidateComments.map((row) => row.authorAgentId).filter((value): value is string => Boolean(value)),
        ...candidateDocuments
          .map((row) => row.updatedByAgentId ?? row.createdByAgentId)
          .filter((value): value is string => Boolean(value)),
        ...candidateRevisions.map((row) => row.createdByAgentId).filter((value): value is string => Boolean(value)),
      ]);

      const runRowsRaw =
        relevantAgentIds.size > 0
          ? await db
              .select({
                id: heartbeatRuns.id,
                companyId: heartbeatRuns.companyId,
                agentId: heartbeatRuns.agentId,
                startedAt: heartbeatRuns.startedAt,
                finishedAt: heartbeatRuns.finishedAt,
                createdAt: heartbeatRuns.createdAt,
                contextSnapshot: heartbeatRuns.contextSnapshot,
                logStore: heartbeatRuns.logStore,
                logRef: heartbeatRuns.logRef,
              })
              .from(heartbeatRuns)
              .where(
                and(
                  ...(companyFilter ? [eq(heartbeatRuns.companyId, companyFilter)] : []),
                  inArray(heartbeatRuns.agentId, Array.from(relevantAgentIds)),
                  ...(runFilter ? [eq(heartbeatRuns.id, runFilter)] : []),
                ),
              )
              .orderBy(desc(heartbeatRuns.createdAt))
          : [];

      const relevantRuns = runRowsRaw.filter((run) => {
        const issueId = readIssueIdFromRunContext(asRecord(run.contextSnapshot));
        return !issueId || relevantIssueIds.has(issueId);
      });
      const parsedRuns = await loadRunRecoveryData(db, relevantRuns);
      const fileCache = new Map<string, string | null>();

      const cleanCommentsByIssueAuthor = new Map<string, CandidateComment[]>();
      for (const row of commentRows) {
        if (isLikelyWindowsEncodingCorruption(row.body)) continue;
        const key = `${row.issueId}:${row.authorAgentId ?? ""}:${row.authorUserId ?? ""}`;
        const entries = cleanCommentsByIssueAuthor.get(key) ?? [];
        entries.push(row);
        cleanCommentsByIssueAuthor.set(key, entries);
      }
      for (const entries of cleanCommentsByIssueAuthor.values()) {
        entries.sort(compareByCreatedAtDesc);
      }

      const cleanRevisionByDocument = new Map<string, CandidateRevision[]>();
      for (const row of revisionRows) {
        if (isLikelyWindowsEncodingCorruption(row.body)) continue;
        const entries = cleanRevisionByDocument.get(row.documentId) ?? [];
        entries.push(row);
        cleanRevisionByDocument.set(row.documentId, entries);
      }
      for (const entries of cleanRevisionByDocument.values()) {
        entries.sort(compareByCreatedAtDesc);
      }

      let repairedComments = 0;
      let repairedDocuments = 0;
      let repairedDocumentRevisions = 0;
      let normalizedDocumentTitles = 0;
      let skipped = 0;
      const repairedRevisionIds = new Set<string>();

      for (const comment of candidateComments) {
        const candidateRuns = relevantRuns.filter((run) =>
          couldBelongToRun(run, comment.issueId, comment.authorAgentId, comment.createdAt),
        );

        let nextBody: string | null = null;
        let source: RepairSource | undefined;
        let matchedRunId: string | null = null;

        const cleanCandidates = cleanCommentsByIssueAuthor.get(
          `${comment.issueId}:${comment.authorAgentId ?? ""}:${comment.authorUserId ?? ""}`,
        ) ?? [];
        const repostSource = pickSingleExactSource(
          cleanCandidates.filter((clean) => {
            if (clean.id === comment.id) return false;
            if (clean.createdAt.getTime() < comment.createdAt.getTime()) return false;
            if (normalizeSignature(clean.body) !== normalizeWindowsEncodingLineEndings(comment.body)) return false;
            return candidateRuns.some((run) => couldBelongToRun(run, clean.issueId, clean.authorAgentId, clean.createdAt));
          }),
        );
        if (repostSource) {
          nextBody = repostSource.body;
          source = "later_clean_repost";
          matchedRunId =
            candidateRuns.find((run) => couldBelongToRun(run, repostSource.issueId, repostSource.authorAgentId, repostSource.createdAt))
              ?.id ?? null;
        } else {
          const runPayloadMatches: Array<{ body: string; runId: string }> = [];
          const runInlineMatches: Array<{ body: string; runId: string }> = [];
          for (const run of candidateRuns) {
            const parsed = parsedRuns.get(run.id);
            if (!parsed) continue;
            for (const command of parsed.commands) {
              const commentId = extractCommentIdFromIssueMutationOutput(command.aggregatedOutput);
              if (commentId && commentId !== comment.id) continue;

              if (/\/api\/issues\/.+\/comments\b/.test(command.command)) {
                if (parsed.workspaceCwd) {
                  const relativePath = extractPythonWorkspaceRelativePath(command.command);
                  if (relativePath) {
                    const absolutePath = path.resolve(parsed.workspaceCwd, relativePath);
                    const fileText = await readFileSource(absolutePath, fileCache);
                    if (fileText && normalizeSignature(fileText) === normalizeWindowsEncodingLineEndings(comment.body)) {
                      runPayloadMatches.push({ body: fileText, runId: run.id });
                      continue;
                    }
                  }
                }

                const inlineComment = extractInlineCommentFromCommand(command.command);
                if (!inlineComment) continue;
                const recoveredInlineComment = sanitizePowerShellInlineText(
                  recoverWindows1251Utf8Mojibake(inlineComment) ?? inlineComment,
                );
                if (normalizeSignature(recoveredInlineComment) !== normalizeWindowsEncodingLineEndings(comment.body)) continue;
                runInlineMatches.push({ body: recoveredInlineComment, runId: run.id });
                continue;
              }

              if (!/\/api\/issues\/[^/\s"'`]+\b/.test(command.command)) continue;
              if (/\/comments\b|\/documents\b/.test(command.command)) continue;

              const inlineComment = extractInlineCommentFromCommand(command.command);
              if (!inlineComment) continue;
              const recoveredInlineComment = sanitizePowerShellInlineText(
                recoverWindows1251Utf8Mojibake(inlineComment) ?? inlineComment,
              );
              if (normalizeSignature(recoveredInlineComment) !== normalizeWindowsEncodingLineEndings(comment.body)) continue;
              runInlineMatches.push({ body: recoveredInlineComment, runId: run.id });
            }
          }
          const exactLogSource = pickSingleExactSource(runPayloadMatches);
          if (exactLogSource) {
            nextBody = exactLogSource.body;
            source = "run_log_workspace_file";
            matchedRunId = exactLogSource.runId;
          } else {
            const inlineLogSource = pickSingleExactSource(runInlineMatches);
            if (inlineLogSource) {
              nextBody = inlineLogSource.body;
              source = "run_log_inline_comment";
              matchedRunId = inlineLogSource.runId;
            }
          }
        }

        if (!nextBody || nextBody === comment.body) {
          skipped += 1;
          details.push({
            kind: "comment",
            targetId: comment.id,
            issueId: comment.issueId,
            issueIdentifier: comment.issueIdentifier,
            action: "skip",
            reason: "No exact recovery source",
            before: previewWindowsEncodingValue(comment.body),
          });
          continue;
        }

        if (!dryRun) {
          await db.update(issueComments).set({ body: nextBody, updatedAt: new Date() }).where(eq(issueComments.id, comment.id));
        }
        repairedComments += 1;
        details.push({
          kind: "comment",
          targetId: comment.id,
          issueId: comment.issueId,
          issueIdentifier: comment.issueIdentifier,
          runId: matchedRunId,
          action: "repair",
          source,
          before: previewWindowsEncodingValue(comment.body),
          after: previewWindowsEncodingValue(nextBody),
        });
      }

      for (const doc of candidateDocuments) {
        const relatedAgentId = doc.updatedByAgentId ?? doc.createdByAgentId;
        const candidateRuns = relevantRuns.filter((run) => couldBelongToRun(run, doc.issueId, relatedAgentId, doc.updatedAt));

        if (normalizeCorruptedDocumentTitle(doc.title) !== doc.title) {
          let nextTitle = normalizeCorruptedDocumentTitle(doc.title);
          let titleSource: RepairSource = "placeholder_title_null";
          let titleRunId: string | null = null;

          const inlineTitleMatches: InlineDocumentTitleSource[] = [];
          for (const run of candidateRuns) {
            const parsed = parsedRuns.get(run.id);
            if (!parsed) continue;
            for (const command of parsed.commands) {
              if (!new RegExp(`/api/issues/.+/documents/${doc.key}\\b`).test(command.command)) continue;
              const inlineTitle = extractInlineTitleFromCommand(command.command);
              if (!inlineTitle) continue;
              const recoveredInlineTitle = sanitizePowerShellInlineText(
                recoverWindows1251Utf8Mojibake(inlineTitle) ?? inlineTitle,
              );
              if (normalizeSignature(recoveredInlineTitle) !== normalizeWindowsEncodingLineEndings(doc.title ?? "")) continue;
              inlineTitleMatches.push({ title: recoveredInlineTitle, runId: run.id });
            }
          }
          const inlineTitleSource = pickSingleExactSource(inlineTitleMatches);
          if (inlineTitleSource) {
            nextTitle = inlineTitleSource.title;
            titleSource = "run_log_inline_title";
            titleRunId = inlineTitleSource.runId;
          }

          if (!dryRun) {
            await db.update(documents).set({ title: nextTitle, updatedAt: new Date() }).where(eq(documents.id, doc.id));
          }
          normalizedDocumentTitles += 1;
          details.push({
            kind: "document_title",
            targetId: doc.id,
            issueId: doc.issueId,
            issueIdentifier: doc.issueIdentifier,
            documentKey: doc.key,
            runId: titleRunId,
            action: "normalize_title",
            source: titleSource,
            before: previewWindowsEncodingValue(doc.title),
            after: previewWindowsEncodingValue(nextTitle),
          });
        }

        if (!isLikelyWindowsEncodingCorruption(doc.latestBody)) continue;

        let nextBody: string | null = null;
        let source: RepairSource | undefined;
        let matchedRunId: string | null = null;

        for (const run of candidateRuns) {
          const parsed = parsedRuns.get(run.id);
          if (!parsed?.workspaceCwd) continue;
          for (const command of parsed.commands) {
            if (!new RegExp(`/api/issues/.+/documents/${doc.key}\\b`).test(command.command)) continue;
            const relativePath = extractPythonWorkspaceRelativePath(command.command);
            if (!relativePath) continue;
            const absolutePath = path.resolve(parsed.workspaceCwd, relativePath);
            const fileText = await readFileSource(absolutePath, fileCache);
            if (!fileText) continue;
            if (normalizeSignature(fileText) !== normalizeWindowsEncodingLineEndings(doc.latestBody)) continue;
            nextBody = fileText;
            source = "run_log_workspace_file";
            matchedRunId = run.id;
            break;
          }
          if (nextBody) break;
        }

        if (!nextBody) {
          const cleanRevisions = cleanRevisionByDocument.get(doc.id) ?? [];
          const revisionMatch = pickSingleExactSource(
            cleanRevisions.filter((revision) => normalizeSignature(revision.body) === normalizeWindowsEncodingLineEndings(doc.latestBody)),
          );
          if (revisionMatch) {
            nextBody = revisionMatch.body;
            source = "later_clean_revision";
          }
        }

        if (!nextBody || nextBody === doc.latestBody) {
          skipped += 1;
          details.push({
            kind: "document_body",
            targetId: doc.id,
            issueId: doc.issueId,
            issueIdentifier: doc.issueIdentifier,
            documentKey: doc.key,
            action: "skip",
            reason: "No exact recovery source",
            before: previewWindowsEncodingValue(doc.latestBody),
          });
          continue;
        }

        if (!dryRun) {
          await db.update(documents).set({ latestBody: nextBody, updatedAt: new Date() }).where(eq(documents.id, doc.id));
          if (doc.latestRevisionId) {
            await db.update(documentRevisions).set({ body: nextBody }).where(eq(documentRevisions.id, doc.latestRevisionId));
          }
        }
        if (doc.latestRevisionId) repairedRevisionIds.add(doc.latestRevisionId);
        repairedDocuments += 1;
        details.push({
          kind: "document_body",
          targetId: doc.id,
          issueId: doc.issueId,
          issueIdentifier: doc.issueIdentifier,
          documentKey: doc.key,
          runId: matchedRunId,
          action: "repair",
          source,
          before: previewWindowsEncodingValue(doc.latestBody),
          after: previewWindowsEncodingValue(nextBody),
        });
      }

      for (const revision of candidateRevisions) {
        if (repairedRevisionIds.has(revision.id)) continue;
        const candidateRuns = relevantRuns.filter((run) =>
          couldBelongToRun(run, revision.issueId, revision.createdByAgentId, revision.createdAt),
        );

        let nextBody: string | null = null;
        let source: RepairSource | undefined;
        let matchedRunId: string | null = null;

        for (const run of candidateRuns) {
          const parsed = parsedRuns.get(run.id);
          if (!parsed?.workspaceCwd) continue;
          for (const command of parsed.commands) {
            if (!new RegExp(`/api/issues/.+/documents/${revision.key}\\b`).test(command.command)) continue;
            const relativePath = extractPythonWorkspaceRelativePath(command.command);
            if (!relativePath) continue;
            const absolutePath = path.resolve(parsed.workspaceCwd, relativePath);
            const fileText = await readFileSource(absolutePath, fileCache);
            if (!fileText) continue;
            if (normalizeSignature(fileText) !== normalizeWindowsEncodingLineEndings(revision.body)) continue;
            nextBody = fileText;
            source = "run_log_workspace_file";
            matchedRunId = run.id;
            break;
          }
          if (nextBody) break;
        }

        if (!nextBody) {
          const cleanRevisions = cleanRevisionByDocument.get(revision.documentId) ?? [];
          const cleanRevision = pickSingleExactSource(
            cleanRevisions.filter((row) => normalizeSignature(row.body) === normalizeWindowsEncodingLineEndings(revision.body)),
          );
          if (cleanRevision) {
            nextBody = cleanRevision.body;
            source = "later_clean_revision";
          }
        }

        if (!nextBody || nextBody === revision.body) {
          skipped += 1;
          details.push({
            kind: "document_revision",
            targetId: revision.id,
            issueId: revision.issueId,
            issueIdentifier: revision.issueIdentifier,
            documentKey: revision.key,
            action: "skip",
            reason: "No exact recovery source",
            before: previewWindowsEncodingValue(revision.body),
          });
          continue;
        }

        if (!dryRun) {
          await db.update(documentRevisions).set({ body: nextBody }).where(eq(documentRevisions.id, revision.id));
        }
        repairedDocumentRevisions += 1;
        details.push({
          kind: "document_revision",
          targetId: revision.id,
          issueId: revision.issueId,
          issueIdentifier: revision.issueIdentifier,
          documentKey: revision.key,
          runId: matchedRunId,
          action: "repair",
          source,
          before: previewWindowsEncodingValue(revision.body),
          after: previewWindowsEncodingValue(nextBody),
        });
      }

      return {
        dryRun,
        scannedComments: candidateComments.length,
        scannedDocuments: candidateDocuments.length,
        scannedDocumentRevisions: candidateRevisions.length,
        repairedComments,
        repairedDocuments,
        repairedDocumentRevisions,
        normalizedDocumentTitles,
        skipped,
        details,
      };
    },
  };
}
