import { Router } from "express";
import type { Db } from "@paperclipai/db";
import { assertCompanyAccess, getActorInfo } from "./authz.js";
import { approvalService } from "../services/approvals.js";
import { documentService } from "../services/documents.js";
import { rewriteTelegramEditorialDraft, type EditorialAuthorProfile } from "../services/editorial-ai.js";
import { issueApprovalService } from "../services/issue-approvals.js";
import { issueService } from "../services/issues.js";
import { logActivity } from "../services/activity-log.js";
import { pluginCompanySettingsService } from "../services/plugin-company-settings.js";
import { pluginRegistryService } from "../services/plugin-registry.js";
import { pluginStateStore } from "../services/plugin-state-store.js";
import { importWebContent } from "../services/web-content-import.js";

const TELEGRAM_PUBLISHING_PLUGIN_KEY = "paperclip.telegram-publishing";
const AUTHOR_VOICE_PLUGIN_KEY = "paperclip.author-voice-profiles";

type TelegramParseMode = "" | "HTML" | "MarkdownV2";

interface TelegramDestination {
  id: string;
  label: string;
  chatId: string;
  publicHandle: string;
  parseMode: TelegramParseMode;
  disableLinkPreview: boolean;
  disableNotification: boolean;
  enabled: boolean;
  isDefault: boolean;
}

interface TelegramSource {
  id: string;
  label: string;
  chatId: string;
  publicHandle: string;
  discussionChatId: string;
  mode: "channel_posts" | "discussion_replies" | "both";
  enabled: boolean;
  projectId: string;
  assigneeAgentId: string;
  routineId: string;
  issueTemplateKey: string;
}

interface TelegramPublishingSettings {
  publishing: {
    botTokenSecretRef: string;
    destinations: TelegramDestination[];
    defaultDestinationId: string;
  };
  ai: {
    adapterType: "codex_local";
    model: string;
    reasoningEffort: "low" | "medium" | "high";
  };
  ingestion: {
    sources: TelegramSource[];
  };
  taskBot: {
    enabled: boolean;
    pollingEnabled: boolean;
    notificationMode: "linked_only" | "fallback_all_linked";
    claimCodeTtlMinutes: number;
  };
}

interface AuthorVoiceProfileRecord extends EditorialAuthorProfile {
  enabled: boolean;
}

function trimToNull(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeParseMode(value: unknown): TelegramParseMode {
  return value === "HTML" || value === "MarkdownV2" ? value : "";
}

function normalizeTelegramDestination(input: unknown, index: number): TelegramDestination | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const record = input as Record<string, unknown>;
  const chatId = trimToNull(record.chatId) ?? "";
  const publicHandle = trimToNull(record.publicHandle) ?? "";
  if (!chatId && !publicHandle) return null;
  return {
    id: trimToNull(record.id) ?? `destination-${index + 1}`,
    label: trimToNull(record.label) ?? (publicHandle || chatId || `Destination ${index + 1}`),
    chatId,
    publicHandle,
    parseMode: normalizeParseMode(record.parseMode),
    disableLinkPreview: record.disableLinkPreview === true,
    disableNotification: record.disableNotification === true,
    enabled: record.enabled !== false,
    isDefault: record.isDefault === true,
  };
}

function normalizeTelegramSource(input: unknown, index: number): TelegramSource | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const record = input as Record<string, unknown>;
  const chatId = trimToNull(record.chatId) ?? "";
  if (!chatId) return null;
  return {
    id: trimToNull(record.id) ?? `source-${index + 1}`,
    label: trimToNull(record.label) ?? trimToNull(record.publicHandle) ?? chatId,
    chatId,
    publicHandle: trimToNull(record.publicHandle) ?? "",
    discussionChatId: trimToNull(record.discussionChatId) ?? "",
    mode:
      record.mode === "discussion_replies" || record.mode === "both"
        ? record.mode
        : "channel_posts",
    enabled: record.enabled !== false,
    projectId: trimToNull(record.projectId) ?? "",
    assigneeAgentId: trimToNull(record.assigneeAgentId) ?? "",
    routineId: trimToNull(record.routineId) ?? "",
    issueTemplateKey: trimToNull(record.issueTemplateKey) ?? "",
  };
}

function normalizePublishingSettings(input: unknown): TelegramPublishingSettings {
  const record = input && typeof input === "object" && !Array.isArray(input)
    ? input as Record<string, unknown>
    : {};
  const publishing = record.publishing && typeof record.publishing === "object" && !Array.isArray(record.publishing)
    ? record.publishing as Record<string, unknown>
    : {};
  const ingestion = record.ingestion && typeof record.ingestion === "object" && !Array.isArray(record.ingestion)
    ? record.ingestion as Record<string, unknown>
    : {};
  const taskBot = record.taskBot && typeof record.taskBot === "object" && !Array.isArray(record.taskBot)
    ? record.taskBot as Record<string, unknown>
    : {};
  const ai = record.ai && typeof record.ai === "object" && !Array.isArray(record.ai)
    ? record.ai as Record<string, unknown>
    : {};

  const destinations = (Array.isArray(publishing.destinations) ? publishing.destinations : [])
    .map((entry, index) => normalizeTelegramDestination(entry, index))
    .filter((entry): entry is TelegramDestination => Boolean(entry));
  const defaultDestinationId =
    trimToNull(publishing.defaultDestinationId)
    ?? destinations.find((entry) => entry.isDefault)?.id
    ?? destinations[0]?.id
    ?? "";

  return {
    publishing: {
      botTokenSecretRef: trimToNull(publishing.botTokenSecretRef) ?? "",
      destinations: destinations.map((entry) => ({
        ...entry,
        isDefault: entry.id === defaultDestinationId,
      })),
      defaultDestinationId,
    },
    ingestion: {
      sources: (Array.isArray(ingestion.sources) ? ingestion.sources : [])
        .map((entry, index) => normalizeTelegramSource(entry, index))
        .filter((entry): entry is TelegramSource => Boolean(entry)),
    },
    taskBot: {
      enabled: taskBot.enabled === true,
      pollingEnabled: taskBot.pollingEnabled !== false,
      notificationMode: taskBot.notificationMode === "linked_only" ? "linked_only" : "fallback_all_linked",
      claimCodeTtlMinutes:
        typeof taskBot.claimCodeTtlMinutes === "number" && Number.isFinite(taskBot.claimCodeTtlMinutes)
          ? Math.max(5, Math.min(24 * 60, Math.floor(taskBot.claimCodeTtlMinutes)))
          : 30,
    },
    ai: {
      adapterType: "codex_local",
      model: trimToNull(ai.model) ?? "",
      reasoningEffort:
        ai.reasoningEffort === "low" || ai.reasoningEffort === "high"
          ? ai.reasoningEffort
          : "medium",
    },
  };
}

function normalizeAuthorVoiceProfiles(input: unknown): AuthorVoiceProfileRecord[] {
  const record = input && typeof input === "object" && !Array.isArray(input)
    ? input as Record<string, unknown>
    : {};
  const items = Array.isArray(record.channelProfiles) ? record.channelProfiles : [];
  return items
    .map((entry, index) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
      const item = entry as Record<string, unknown>;
      const destinationId = trimToNull(item.destinationId);
      if (!destinationId) return null;
      const profile: AuthorVoiceProfileRecord = {
        id: trimToNull(item.id) ?? `profile-${index + 1}`,
        name: trimToNull(item.name) ?? trimToNull(item.label) ?? `Profile ${index + 1}`,
        destinationId,
        authorName: trimToNull(item.authorName),
        toneRules: trimToNull(item.toneRules),
        samplePosts: trimToNull(item.samplePosts),
        bannedPhrases: trimToNull(item.bannedPhrases),
        ctaRules: trimToNull(item.ctaRules),
        enabled: item.enabled !== false,
      };
      return profile;
    })
    .filter((entry): entry is AuthorVoiceProfileRecord => Boolean(entry));
}

function excerpt(text: string, limit = 240) {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= limit) return normalized;
  return `${normalized.slice(0, Math.max(0, limit - 3)).trimEnd()}...`;
}

function parseBoolean(value: unknown) {
  return value === true || value === "true" || value === 1 || value === "1";
}

export function telegramPublishingRoutes(db: Db) {
  const router = Router();
  const approvals = approvalService(db);
  const documents = documentService(db);
  const issueApprovals = issueApprovalService(db);
  const issues = issueService(db);
  const pluginSettings = pluginCompanySettingsService(db);
  const plugins = pluginRegistryService(db);
  const state = pluginStateStore(db);

  async function loadPublishingContext(companyId: string) {
    const [publishingPlugin, authorVoicePlugin] = await Promise.all([
      plugins.getByKey(TELEGRAM_PUBLISHING_PLUGIN_KEY),
      plugins.getByKey(AUTHOR_VOICE_PLUGIN_KEY),
    ]);
    if (!publishingPlugin) {
      throw new Error("Telegram Publishing plugin is not installed");
    }
    const [publishingSettingsRow, authorVoiceRow] = await Promise.all([
      pluginSettings.get(publishingPlugin.id, companyId),
      authorVoicePlugin ? pluginSettings.get(authorVoicePlugin.id, companyId) : Promise.resolve(null),
    ]);

    return {
      publishingPlugin,
      authorVoicePlugin,
      settings: normalizePublishingSettings(publishingSettingsRow?.settingsJson ?? {}),
      authorProfiles: normalizeAuthorVoiceProfiles(authorVoiceRow?.settingsJson ?? {}),
    };
  }

  async function buildReadyQueue(companyId: string) {
    const companyApprovals = await approvals.list(companyId);
    const publishApprovals = companyApprovals
      .filter((approval) =>
        approval.type === "publish_content"
        && (approval.payload as Record<string, unknown>)?.pluginKey === TELEGRAM_PUBLISHING_PLUGIN_KEY
        && approval.status === "pending",
      )
      .sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime());

    return await Promise.all(publishApprovals.map(async (approval) => {
      const payload = approval.payload as Record<string, unknown>;
      const linkedIssues = await issueApprovals.listIssuesForApproval(approval.id);
      const issue = linkedIssues[0] ?? null;
      const finalDocumentId = trimToNull(payload.finalDocumentId);
      const draftDocumentId = trimToNull(payload.draftDocumentId);
      const finalDoc = issue
        ? await documents.getIssueDocumentByKey(issue.id, "telegram-final-copy")
        : null;
      const draftDoc = issue && !finalDoc
        ? await documents.getIssueDocumentByKey(issue.id, "telegram-draft")
        : null;
      const previewBody = trimToNull(finalDoc?.body) ?? trimToNull(draftDoc?.body) ?? "";

      return {
        approval: {
          id: approval.id,
          status: approval.status,
          updatedAt: approval.updatedAt.toISOString(),
          createdAt: approval.createdAt.toISOString(),
          requestedByUserId: approval.requestedByUserId,
          requestedByAgentId: approval.requestedByAgentId,
        },
        issue: issue
          ? {
              id: issue.id,
              identifier: issue.identifier,
              title: issue.title,
            }
          : null,
        destinationId: trimToNull(payload.destinationId),
        destinationLabel: trimToNull(payload.destinationLabel),
        authorProfileId: trimToNull(payload.authorProfileId),
        sourceDocumentId: trimToNull(payload.sourceDocumentId),
        draftDocumentId: draftDocumentId,
        finalDocumentId: finalDocumentId,
        sourceSummary: trimToNull(payload.sourceSummary),
        previewText: previewBody,
        previewExcerpt: previewBody ? excerpt(previewBody) : null,
        riskFlags: Array.isArray(payload.riskFlags) ? payload.riskFlags : [],
        safetyChecks: Array.isArray(payload.safetyChecks) ? payload.safetyChecks : [],
        publishAt: trimToNull(payload.publishAt),
      };
    }));
  }

  router.get("/companies/:companyId/telegram-publishing/overview", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);

    try {
      const { publishingPlugin, authorVoicePlugin, settings, authorProfiles } = await loadPublishingContext(companyId);
      const [botHealth, lastPublication, recentPublications, scheduledJobs, recentSources, readyQueue] = await Promise.all([
        state.get(publishingPlugin.id, "company", "bot-health", { scopeId: companyId }),
        state.get(publishingPlugin.id, "company", "last-publication", { scopeId: companyId }),
        plugins.listEntities(publishingPlugin.id, { entityType: "telegram-message", limit: 12, offset: 0 }),
        plugins.listEntities(publishingPlugin.id, { entityType: "telegram-publication-job", limit: 24, offset: 0 }),
        plugins.listEntities(publishingPlugin.id, { entityType: "telegram-source-message", limit: 24, offset: 0 }),
        buildReadyQueue(companyId),
      ]);

      const profileCoverage = settings.publishing.destinations.map((destination) => ({
        destinationId: destination.id,
        destinationLabel: destination.label,
        hasProfile: authorProfiles.some((profile) => profile.enabled && profile.destinationId === destination.id),
      }));

      res.json({
        configured: Boolean(settings.publishing.botTokenSecretRef && settings.publishing.destinations.length > 0),
        authorVoicePluginInstalled: Boolean(authorVoicePlugin),
        settings,
        publishChannels: settings.publishing.destinations,
        donorChannels: settings.ingestion.sources,
        authorProfiles,
        profileCoverage,
        readyQueue,
        botHealth,
        lastPublication,
        recentPublications: recentPublications.map((entity) => entity.data),
        scheduledJobs: scheduledJobs.map((entity) => entity.data),
        recentIngestedStories: recentSources.map((entity) => entity.data),
      });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  router.post("/companies/:companyId/telegram-publishing/compose", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const actor = getActorInfo(req);

    try {
      const body = req.body as {
        destinationId?: string;
        sourceText?: string;
        sourceUrl?: string;
        title?: string;
        projectId?: string | null;
        publishAt?: string | null;
      } | undefined;
      const destinationId = trimToNull(body?.destinationId);
      const sourceText = trimToNull(body?.sourceText);
      const sourceUrl = trimToNull(body?.sourceUrl);
      const requestedTitle = trimToNull(body?.title);
      const publishAt = trimToNull(body?.publishAt);
      if (!destinationId) {
        res.status(400).json({ error: "destinationId is required" });
        return;
      }
      if (!sourceText && !sourceUrl) {
        res.status(400).json({ error: "Provide sourceText or sourceUrl" });
        return;
      }

      const { settings, authorProfiles } = await loadPublishingContext(companyId);
      const destination = settings.publishing.destinations.find((entry) => entry.id === destinationId && entry.enabled);
      if (!destination) {
        res.status(422).json({ error: "Selected Telegram channel is missing or disabled" });
        return;
      }
      const authorProfile = authorProfiles.find((profile) => profile.enabled && profile.destinationId === destination.id);
      if (!authorProfile) {
        res.status(422).json({ error: "This Telegram channel is blocked until an author voice profile is configured" });
        return;
      }
      if (!settings.ai.model) {
        res.status(422).json({ error: "AI settings are incomplete. Configure Codex model first." });
        return;
      }

      const imported = sourceUrl ? await importWebContent(sourceUrl) : null;
      const effectiveSourceText = sourceText ?? imported?.sourceText ?? "";
      const rewrite = await rewriteTelegramEditorialDraft({
        destinationLabel: destination.label,
        sourceTitle: requestedTitle ?? imported?.title ?? null,
        sourceUrl: imported?.url ?? sourceUrl,
        sourceText: effectiveSourceText,
        authorProfile,
        execution: settings.ai,
      });

      const issue = await issues.create(companyId, {
        title: `Telegram: ${rewrite.title}`,
        description: rewrite.sourceSummary,
        status: "todo",
        priority: "medium",
        projectId: trimToNull(body?.projectId),
        createdByAgentId: actor.agentId,
        createdByUserId: actor.actorType === "user" ? actor.actorId : null,
        assigneeAgentId: null,
        assigneeUserId: null,
      });

      const sourceDocumentResult = await documents.upsertIssueDocument({
        issueId: issue.id,
        key: "telegram-source",
        title: requestedTitle ?? imported?.title ?? rewrite.title,
        format: "markdown",
        body: effectiveSourceText,
        changeSummary: "Seed Telegram source material",
        createdByAgentId: actor.agentId,
        createdByUserId: actor.actorType === "user" ? actor.actorId : null,
      });
      const sourceDocument = sourceDocumentResult.document;

      const draftDocumentResult = await documents.upsertIssueDocument({
        issueId: issue.id,
        key: "telegram-draft",
        title: rewrite.title,
        format: "markdown",
        body: rewrite.finalCopy,
        changeSummary: "Draft Telegram rewrite via AI",
        createdByAgentId: actor.agentId,
        createdByUserId: actor.actorType === "user" ? actor.actorId : null,
      });
      const draftDocument = draftDocumentResult.document;

      const finalDocumentResult = await documents.upsertIssueDocument({
        issueId: issue.id,
        key: "telegram-final-copy",
        title: rewrite.title,
        format: "markdown",
        body: rewrite.finalCopy,
        changeSummary: "Final Telegram copy prepared for approval",
        createdByAgentId: actor.agentId,
        createdByUserId: actor.actorType === "user" ? actor.actorId : null,
      });
      const finalDocument = finalDocumentResult.document;

      await documents.upsertIssueDocument({
        issueId: issue.id,
        key: "telegram-publish-checklist",
        title: `Checklist: ${rewrite.title}`,
        format: "markdown",
        body: [
          `Model: ${rewrite.model}`,
          `Reasoning: ${rewrite.reasoningEffort}`,
          "",
          "Checklist:",
          ...(rewrite.checklist.length > 0 ? rewrite.checklist.map((entry) => `- ${entry}`) : ["- Confirm the post matches the channel voice profile."]),
          "",
          "Risk flags:",
          ...(rewrite.riskFlags.length > 0 ? rewrite.riskFlags.map((entry) => `- ${entry}`) : ["- No explicit risks flagged by AI."]),
        ].join("\n"),
        changeSummary: "Telegram publish checklist",
        createdByAgentId: actor.agentId,
        createdByUserId: actor.actorType === "user" ? actor.actorId : null,
      });

      const approval = await approvals.create(companyId, {
        type: "publish_content",
        requestedByAgentId: actor.agentId,
        requestedByUserId: actor.actorType === "user" ? actor.actorId : null,
        status: "pending",
        payload: {
          pluginKey: TELEGRAM_PUBLISHING_PLUGIN_KEY,
          channel: destination.label,
          destinationId: destination.id,
          destinationLabel: destination.label,
          sourceDocumentId: sourceDocument.id,
          draftDocumentId: draftDocument.id,
          finalDocumentId: finalDocument.id,
          authorProfileId: authorProfile.id,
          publishAt,
          sourceSummary: rewrite.sourceSummary,
          finalExcerpt: excerpt(rewrite.finalCopy),
          riskFlags: rewrite.riskFlags,
          safetyChecks: rewrite.checklist,
          issueId: issue.id,
        },
        decisionNote: null,
        decidedByUserId: null,
        decidedAt: null,
        updatedAt: new Date(),
      });

      await issueApprovals.link(issue.id, approval.id, {
        agentId: actor.agentId,
        userId: actor.actorType === "user" ? actor.actorId : null,
      });

      await logActivity(db, {
        companyId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        runId: actor.runId,
        action: "telegram_publishing.compose_requested",
        entityType: "approval",
        entityId: approval.id,
        details: {
          issueId: issue.id,
          destinationId: destination.id,
          destinationLabel: destination.label,
          authorProfileId: authorProfile.id,
          sourceUrl: imported?.url ?? null,
          model: rewrite.model,
          reasoningEffort: rewrite.reasoningEffort,
        },
      });

      res.status(201).json({
        issue,
        approval,
        documents: {
          source: sourceDocument,
          draft: draftDocument,
          final: finalDocument,
        },
      });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  router.post("/companies/:companyId/web-content-import/extract", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);

    const url = trimToNull((req.body as { url?: string } | undefined)?.url);
    if (!url) {
      res.status(400).json({ error: "url is required" });
      return;
    }

    try {
      const imported = await importWebContent(url);
      res.json(imported);
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  router.get("/companies/:companyId/telegram-operator-bot/overview", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);

    try {
      const plugin = await plugins.getByKey("paperclip.telegram-operator-bot");
      if (!plugin) {
        throw new Error("Telegram Operator Bot plugin is not installed");
      }
      const settingsRow = await pluginSettings.get(plugin.id, companyId);
      const settings = normalizePublishingSettings(settingsRow?.settingsJson ?? {});
      const [botHealth, linkedChats, issuesList, companyApprovals] = await Promise.all([
        state.get(plugin.id, "company", "bot-health", { scopeId: companyId }),
        plugins.listEntities(plugin.id, { entityType: "telegram-linked-chat", limit: 50, offset: 0 }),
        issues.list(companyId, { includeRoutineExecutions: true }),
        approvals.list(companyId),
      ]);

      res.json({
        configured: Boolean(settings.publishing.botTokenSecretRef && settings.publishing.destinations.length > 0),
        settings,
        linkedChats: linkedChats.map((entity) => entity.data),
        botHealth,
        blockedTaskCount: issuesList.filter((issue) => issue.status === "blocked").length,
        reviewTaskCount: issuesList.filter((issue) => issue.status === "in_review").length,
        actionableApprovalCount: companyApprovals.filter((approval) => approval.status === "pending" || approval.status === "revision_requested").length,
        myRevisionApprovalCount: companyApprovals.filter((approval) => approval.status === "revision_requested").length,
      });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  return router;
}
