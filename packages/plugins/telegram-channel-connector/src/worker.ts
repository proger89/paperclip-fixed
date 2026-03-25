import { randomUUID } from "node:crypto";
import {
  definePlugin,
  runWorker,
  type PaperclipPlugin,
  type PluginContext,
  type PluginJobContext,
  type PluginCompanySettingsRecord,
  type Issue,
  type Approval,
  type JoinRequest,
  type BudgetIncident,
} from "@paperclipai/plugin-sdk";
import {
  ACTION_KEYS,
  DATA_KEYS,
  DEFAULT_COMPANY_SETTINGS,
  DEFAULT_CONFIG,
  JOB_KEYS,
  PLUGIN_ID,
  TELEGRAM_MAX_MESSAGE_LENGTH,
} from "./constants.js";
import type {
  LegacyTelegramConfig,
  TelegramBotHealth,
  TelegramBudgetWizardState,
  TelegramCompanySettings,
  TelegramDestination,
  TelegramIngestionSource,
  TelegramLinkedChat,
  TelegramOverview,
  TelegramPublication,
  TelegramPublicationJob,
  TelegramSourceMessageRecord,
} from "./plugin-types.js";
import {
  companySettingsFromLegacyConfig,
  hasLegacyTelegramConfig,
  sanitizeLegacyTelegramConfig,
  sanitizeTelegramCompanySettings,
} from "./settings.js";

const ENTITY_TYPES = {
  publication: "telegram-message",
  publicationJob: "telegram-publication-job",
  sourceMessage: "telegram-source-message",
  linkedChat: "telegram-linked-chat",
  claimCode: "telegram-claim-code",
  threadLink: "telegram-thread-link",
  watcher: "telegram-issue-watcher",
} as const;

const STATE_KEYS = {
  lastValidation: "last-validation",
  lastPublication: "last-publication",
  botHealth: "bot-health",
  wizard: "task-create",
  notificationSentPrefix: "telegram-notified",
} as const;

const LIST_PAGE_SIZE = 6;
const CLAIM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CLOSED_ISSUE_STATUSES = new Set<Issue["status"]>(["done", "cancelled"]);
const OPEN_ISSUE_STATUSES = new Set<Issue["status"]>(["backlog", "todo", "in_progress", "in_review", "blocked"]);
const ACTIONABLE_APPROVAL_STATUSES = new Set<Approval["status"]>(["pending", "revision_requested"]);
const CALLBACK_PREFIX = {
  list: "list",
  view: "view",
  refresh: "refresh",
  status: "status",
  approvalList: "approval_list",
  approvalView: "approval_view",
  approvalRefresh: "approval_refresh",
  approvalDecision: "approval_decision",
  approvalComments: "approval_comments",
  joinList: "join_list",
  joinView: "join_view",
  joinRefresh: "join_refresh",
  joinDecision: "join_decision",
  budgetList: "budget_list",
  budgetView: "budget_view",
  budgetRefresh: "budget_refresh",
  budgetDecision: "budget_decision",
  inbox: "inbox",
} as const;

type TelegramUser = {
  id: number;
  is_bot?: boolean;
  first_name?: string;
  last_name?: string;
  username?: string;
};

type TelegramChat = {
  id: number;
  type: "private" | "group" | "supergroup" | "channel";
  title?: string;
  username?: string;
  first_name?: string;
  last_name?: string;
};

type TelegramMessage = {
  message_id: number;
  date?: number;
  text?: string;
  caption?: string;
  from?: TelegramUser;
  chat: TelegramChat;
  reply_to_message?: TelegramMessage;
};

type TelegramCallbackQuery = {
  id: string;
  from: TelegramUser;
  data?: string;
  message?: TelegramMessage;
};

type TelegramUpdate = {
  update_id: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
  channel_post?: TelegramMessage;
  edited_channel_post?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
};

type TelegramTaskWizardState = {
  kind?: "task_create";
  step: "title" | "description" | "project" | "priority";
  title: string;
  description: string;
  projectId: string | null;
  priority: Issue["priority"];
  startedAt: string;
  boardUserId: string | null;
  telegramUserId: number;
};

type TelegramClaimCodeRecord = {
  code: string;
  companyId: string;
  boardUserId: string | null;
  createdAt: string;
  expiresAt: string;
  consumedAt: string | null;
};

type TelegramThreadLinkRecord = {
  companyId: string;
  resourceType?: "issue" | "approval" | "join_request" | "budget_incident";
  resourceId?: string;
  issueId?: string;
  approvalId?: string;
  joinRequestId?: string;
  budgetIncidentId?: string;
  chatId: string;
  messageId: number;
  direction: "outbound";
  linkedAt: string;
  reason: string;
};

type TelegramIssueWatcherRecord = {
  companyId: string;
  issueId: string;
  chatId: string;
  telegramUserId: number;
  boardUserId: string | null;
  linkedAt: string;
};

type TelegramChatWizardState = TelegramTaskWizardState | TelegramBudgetWizardState;

type EffectiveCompanySettings = {
  companyId: string;
  row: PluginCompanySettingsRecord | null;
  settings: TelegramCompanySettings;
  source: "company" | "legacy" | "default";
  legacyConfig: LegacyTelegramConfig;
  legacyConfigDetected: boolean;
};

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function trimToNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function sanitizePublicHandle(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = value
    .trim()
    .replace(/^https?:\/\/t\.me\//i, "")
    .replace(/^@+/, "")
    .replace(/\/+$/, "");
  return normalized.length > 0 ? normalized : null;
}

function excerpt(text: string, limit = 180): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= limit) return normalized;
  return `${normalized.slice(0, Math.max(0, limit - 3)).trimEnd()}...`;
}

function toIsoString(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function formatTimestamp(value: Date | string | null | undefined): string {
  return toIsoString(value) ?? "unknown";
}

function getDisplayName(user: TelegramUser | undefined): string {
  if (!user) return "Telegram user";
  const parts = [trimToNull(user.first_name), trimToNull(user.last_name)].filter((value): value is string => Boolean(value));
  if (parts.length > 0) return parts.join(" ");
  return user.username ? `@${user.username}` : `Telegram user ${user.id}`;
}

function isClosedIssue(issue: Pick<Issue, "status">): boolean {
  return CLOSED_ISSUE_STATUSES.has(issue.status);
}

function buildTelegramMessageUrl(input: {
  publicHandle?: string | null;
  chat?: TelegramChat | null;
  chatId?: string | null;
  messageId: number;
}) {
  const handle = sanitizePublicHandle(
    input.publicHandle
      ?? input.chat?.username
      ?? input.chatId,
  );
  if (!handle || handle.startsWith("-")) return null;
  return `https://t.me/${handle}/${input.messageId}`;
}

async function telegramRequest<TResult>(
  ctx: PluginContext,
  token: string,
  method: string,
  body?: Record<string, unknown>,
): Promise<TResult> {
  const response = await ctx.http.fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: body ? "POST" : "GET",
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json() as {
    ok?: boolean;
    result?: TResult;
    description?: string;
  };
  if (!response.ok || payload.ok !== true || payload.result === undefined) {
    throw new Error(payload.description ?? `Telegram request failed (${response.status})`);
  }
  return payload.result;
}

async function sendTelegramMessage(
  ctx: PluginContext,
  token: string,
  input: {
    chatId: string;
    text: string;
    replyMarkup?: Record<string, unknown>;
  },
): Promise<TelegramMessage> {
  return await telegramRequest<TelegramMessage>(ctx, token, "sendMessage", {
    chat_id: input.chatId,
    text: input.text,
    reply_markup: input.replyMarkup,
  });
}

async function editTelegramMessage(
  ctx: PluginContext,
  token: string,
  input: {
    chatId: string;
    messageId: number;
    text: string;
    replyMarkup?: Record<string, unknown>;
  },
): Promise<TelegramMessage> {
  return await telegramRequest<TelegramMessage>(ctx, token, "editMessageText", {
    chat_id: input.chatId,
    message_id: input.messageId,
    text: input.text,
    reply_markup: input.replyMarkup,
  });
}

async function answerCallbackQuery(
  ctx: PluginContext,
  token: string,
  input: {
    callbackQueryId: string;
    text?: string;
  },
): Promise<void> {
  await telegramRequest<boolean>(ctx, token, "answerCallbackQuery", {
    callback_query_id: input.callbackQueryId,
    text: input.text,
  });
}

async function getLegacyConfig(ctx: PluginContext): Promise<LegacyTelegramConfig> {
  return sanitizeLegacyTelegramConfig(await ctx.config.get());
}

async function getEffectiveCompanySettings(ctx: PluginContext, companyId: string): Promise<EffectiveCompanySettings> {
  const [row, legacyConfig] = await Promise.all([
    ctx.companySettings.get(companyId),
    getLegacyConfig(ctx),
  ]);
  const legacyConfigDetected = hasLegacyTelegramConfig(legacyConfig);
  if (row) {
    return {
      companyId,
      row,
      settings: sanitizeTelegramCompanySettings(row.settingsJson),
      source: "company",
      legacyConfig,
      legacyConfigDetected,
    };
  }
  if (legacyConfigDetected) {
    return {
      companyId,
      row: null,
      settings: companySettingsFromLegacyConfig(legacyConfig),
      source: "legacy",
      legacyConfig,
      legacyConfigDetected,
    };
  }
  return {
    companyId,
    row: null,
    settings: { ...DEFAULT_COMPANY_SETTINGS },
    source: "default",
    legacyConfig,
    legacyConfigDetected,
  };
}

async function resolveBotTokenForSettings(ctx: PluginContext, settings: TelegramCompanySettings): Promise<string> {
  const secretRef = trimToNull(settings.publishing.botTokenSecretRef);
  if (!secretRef) {
    throw new Error("Telegram bot token secret is not configured");
  }
  return await ctx.secrets.resolve(secretRef);
}

async function getCompanyState<T = unknown>(ctx: PluginContext, companyId: string, stateKey: string): Promise<T | null> {
  return await ctx.state.get({ scopeKind: "company", scopeId: companyId, stateKey }) as T | null;
}

async function setCompanyState(ctx: PluginContext, companyId: string, stateKey: string, value: unknown): Promise<void> {
  await ctx.state.set({ scopeKind: "company", scopeId: companyId, stateKey }, value);
}

async function getWizardState(
  ctx: PluginContext,
  companyId: string,
  chatId: string,
): Promise<TelegramChatWizardState | null> {
  return await ctx.state.get({
    scopeKind: "company",
    scopeId: companyId,
    namespace: `wizard:${chatId}`,
    stateKey: STATE_KEYS.wizard,
  }) as TelegramChatWizardState | null;
}

async function setWizardState(
  ctx: PluginContext,
  companyId: string,
  chatId: string,
  value: TelegramChatWizardState | null,
): Promise<void> {
  const key = {
    scopeKind: "company" as const,
    scopeId: companyId,
    namespace: `wizard:${chatId}`,
    stateKey: STATE_KEYS.wizard,
  };
  if (!value) {
    await ctx.state.delete(key);
    return;
  }
  await ctx.state.set(key, value);
}

async function getBotHealth(ctx: PluginContext, companyId: string): Promise<TelegramBotHealth | null> {
  const value = await getCompanyState<TelegramBotHealth>(ctx, companyId, STATE_KEYS.botHealth);
  return value ?? null;
}

async function setBotHealth(ctx: PluginContext, companyId: string, value: TelegramBotHealth): Promise<void> {
  await setCompanyState(ctx, companyId, STATE_KEYS.botHealth, value);
}

function getBotHealthDefaults(previous: TelegramBotHealth | null | undefined): TelegramBotHealth {
  return {
    checkedAt: previous?.checkedAt ?? new Date(0).toISOString(),
    ok: previous?.ok ?? false,
    lastUpdateId: previous?.lastUpdateId ?? null,
    lastActivityCursor: previous?.lastActivityCursor ?? null,
    lastNotificationAt: previous?.lastNotificationAt ?? null,
    lastApprovalNotificationAt: previous?.lastApprovalNotificationAt ?? null,
    lastControlPlaneNotificationAt: previous?.lastControlPlaneNotificationAt ?? null,
    lastIngestionAt: previous?.lastIngestionAt ?? null,
    lastPublishDispatchAt: previous?.lastPublishDispatchAt ?? null,
    openApprovalCount: previous?.openApprovalCount ?? 0,
    revisionApprovalCount: previous?.revisionApprovalCount ?? 0,
    openJoinRequestCount: previous?.openJoinRequestCount ?? 0,
    openBudgetIncidentCount: previous?.openBudgetIncidentCount ?? 0,
    scheduledPublishCount: previous?.scheduledPublishCount ?? 0,
    failedPublishCount: previous?.failedPublishCount ?? 0,
    ingestedStoryCount: previous?.ingestedStoryCount ?? 0,
    error: previous?.error ?? null,
  };
}

function getConfiguredDestinations(settings: TelegramCompanySettings): TelegramDestination[] {
  return [...settings.publishing.destinations]
    .filter((destination) => destination.chatId || destination.publicHandle)
    .sort((left, right) => Number(right.isDefault) - Number(left.isDefault) || left.label.localeCompare(right.label));
}

function getEnabledDestinations(settings: TelegramCompanySettings): TelegramDestination[] {
  return getConfiguredDestinations(settings).filter((destination) => destination.enabled);
}

function getDefaultDestination(settings: TelegramCompanySettings): TelegramDestination | null {
  const destinations = getEnabledDestinations(settings);
  const explicit = destinations.find((destination) => destination.id === settings.publishing.defaultDestinationId);
  return explicit ?? destinations.find((destination) => destination.isDefault) ?? destinations[0] ?? null;
}

function getConfiguredSources(settings: TelegramCompanySettings): TelegramIngestionSource[] {
  return [...settings.ingestion.sources]
    .filter((source) => source.chatId)
    .sort((left, right) => left.label.localeCompare(right.label));
}

function findDestinationById(settings: TelegramCompanySettings, destinationId: string | null | undefined): TelegramDestination | null {
  if (!destinationId) return null;
  return getConfiguredDestinations(settings).find((destination) => destination.id === destinationId) ?? null;
}

function resolveDestinationForParams(
  settings: TelegramCompanySettings,
  params: Record<string, unknown>,
): TelegramDestination | null {
  const explicitDestination = findDestinationById(settings, trimToNull(params.destinationId));
  if (explicitDestination) return explicitDestination;

  const chatId = trimToNull(params.chatId);
  const publicHandle = sanitizePublicHandle(trimToNull(params.publicHandle));
  if (chatId || publicHandle) {
    return {
      id: trimToNull(params.destinationId) ?? "ad-hoc",
      label: trimToNull(params.destinationLabel) ?? publicHandle ?? chatId ?? "Telegram destination",
      chatId: chatId ?? "",
      publicHandle: publicHandle ?? "",
      parseMode: (trimToNull(params.parseMode) ?? "") as TelegramDestination["parseMode"],
      disableLinkPreview: params.disableLinkPreview === true,
      disableNotification: params.disableNotification === true,
      enabled: true,
      isDefault: false,
    };
  }
  return getDefaultDestination(settings);
}

async function getRuntimeSourceRoutineId(
  ctx: PluginContext,
  companyId: string,
  sourceId: string,
): Promise<string | null> {
  return await getCompanyState<string>(ctx, companyId, `source-routine:${sourceId}`);
}

async function setRuntimeSourceRoutineId(
  ctx: PluginContext,
  companyId: string,
  sourceId: string,
  routineId: string,
): Promise<void> {
  await setCompanyState(ctx, companyId, `source-routine:${sourceId}`, routineId);
}

async function listPublicationJobs(
  ctx: PluginContext,
  companyId: string,
  input?: { issueId?: string; limit?: number },
): Promise<TelegramPublicationJob[]> {
  const entities = await ctx.entities.list({
    entityType: ENTITY_TYPES.publicationJob,
    ...(input?.issueId
      ? {
        scopeKind: "issue" as const,
        scopeId: input.issueId,
      }
      : {}),
    limit: 500,
    offset: 0,
  });
  return entities
    .map((entity) => {
      const record = entity.data as TelegramPublicationJob;
      return {
        ...record,
        id: record.id ?? entity.id,
      };
    })
    .filter((entry) => entry.companyId === companyId && (!input?.issueId || entry.issueId === input.issueId))
    .sort((left, right) => right.publishAt.localeCompare(left.publishAt))
    .slice(0, input?.limit ?? 100);
}

async function getPublicationJobById(
  ctx: PluginContext,
  companyId: string,
  jobId: string,
): Promise<TelegramPublicationJob | null> {
  const jobs = await listPublicationJobs(ctx, companyId);
  return jobs.find((job) => job.id === jobId) ?? null;
}

async function upsertPublicationJob(
  ctx: PluginContext,
  record: TelegramPublicationJob,
): Promise<TelegramPublicationJob> {
  const stableId = record.id ?? randomUUID();
  const entity = await ctx.entities.upsert({
    entityType: ENTITY_TYPES.publicationJob,
    scopeKind: "issue",
    scopeId: record.issueId,
    externalId: stableId,
    title: `Telegram publish job for ${record.issueId}`,
    status: record.status,
    data: {
      ...record,
      id: stableId,
    },
  });
  return {
    ...record,
    id: stableId ?? entity.id,
  };
}

function isQueuedPublicationStatus(status: TelegramPublicationJob["status"]) {
  return status === "pending" || status === "scheduled" || status === "sending";
}

function normalizePublishAt(value: unknown): string {
  const raw = trimToNull(value);
  if (!raw) return new Date().toISOString();
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

async function loadTelegramPublicationDocuments(
  ctx: PluginContext,
  issueId: string,
  companyId: string,
): Promise<{
  text: string | null;
  sourceDocumentId: string | null;
  draftDocumentId: string | null;
  finalDocumentId: string | null;
}> {
  const [sourceDocument, draftDocument, finalDocument] = await Promise.all([
    ctx.issues.documents.get(issueId, "telegram-source", companyId),
    ctx.issues.documents.get(issueId, "telegram-draft", companyId),
    ctx.issues.documents.get(issueId, "telegram-final-copy", companyId),
  ]);
  const text = trimToNull(finalDocument?.body) ?? trimToNull(draftDocument?.body);
  return {
    text,
    sourceDocumentId: sourceDocument?.id ?? null,
    draftDocumentId: draftDocument?.id ?? null,
    finalDocumentId: finalDocument?.id ?? draftDocument?.id ?? null,
  };
}

async function upsertTelegramPublishedWorkProduct(
  ctx: PluginContext,
  issue: Issue,
  publication: TelegramPublication,
  documents: {
    sourceDocumentId: string | null;
    draftDocumentId: string | null;
    finalDocumentId: string | null;
  },
): Promise<void> {
  const existingProducts = await ctx.issues.workProducts.list(issue.id, issue.companyId);
  const existing = existingProducts.find((product) =>
    product.provider.toLowerCase() === "telegram" && product.type === "artifact",
  ) ?? null;
  const payload = {
    type: "artifact" as const,
    provider: "telegram",
    title: issue.identifier ? `Telegram post for ${issue.identifier}` : `Telegram post for ${issue.title}`,
    status: "approved" as const,
    reviewState: "approved" as const,
    isPrimary: true,
    healthStatus: "healthy" as const,
    url: publication.url,
    externalId: publication.externalId,
    summary: publication.summary,
    metadata: {
      publication: {
        channel: "telegram",
        destinationId: publication.destinationId,
        destinationLabel: publication.destinationLabel,
        approvalId: publication.approvalId,
        messageId: publication.messageId,
        chatId: publication.chatId,
        sentAt: publication.sentAt,
        sourceDocumentId: documents.sourceDocumentId,
        draftDocumentId: documents.draftDocumentId,
        finalDocumentId: documents.finalDocumentId,
      },
      publicHandle: publication.publicHandle,
      parseMode: publication.parseMode,
      chatTitle: publication.chatTitle,
    },
  };
  if (existing) {
    await ctx.issues.workProducts.update(existing.id, issue.companyId, payload);
    return;
  }
  await ctx.issues.workProducts.create({
    issueId: issue.id,
    companyId: issue.companyId,
    projectId: issue.projectId,
    ...payload,
  });
}

async function noteBotHealth(
  ctx: PluginContext,
  companyId: string,
  patch: Partial<TelegramBotHealth>,
): Promise<void> {
  const current = getBotHealthDefaults(await getBotHealth(ctx, companyId));
  await setBotHealth(ctx, companyId, {
    ...current,
    ...patch,
  });
}

async function dispatchPublicationJob(
  ctx: PluginContext,
  effective: EffectiveCompanySettings,
  token: string,
  job: TelegramPublicationJob,
): Promise<TelegramPublicationJob> {
  const now = new Date().toISOString();
  const fail = async (reason: string) => {
    const failed = await upsertPublicationJob(ctx, {
      ...job,
      status: "failed",
      failureReason: reason,
      lastAttemptAt: now,
      attemptCount: job.attemptCount + 1,
      updatedAt: now,
    });
    await ctx.activity.log({
      companyId: job.companyId,
      entityType: "issue",
      entityId: job.issueId,
      message: `Telegram publication job failed: ${reason}`,
      metadata: {
        pluginId: PLUGIN_ID,
        jobId: job.id,
        destinationId: job.destinationId,
      },
    });
    return failed;
  };

  const destination = findDestinationById(effective.settings, job.destinationId);
  if (!destination) {
    return await fail(`Configured Telegram destination "${job.destinationId}" no longer exists.`);
  }
  if (!destination.enabled) {
    return await fail(`Configured Telegram destination "${destination.label}" is disabled.`);
  }
  if (!job.approvalId) {
    return await fail("Telegram publication job is missing an approved publish_content approval.");
  }
  const approval = await ctx.approvals.get(job.approvalId);
  if (
    !approval
    || approval.companyId !== job.companyId
    || approval.status !== "approved"
    || approval.type !== "publish_content"
    || trimToNull(approval.payload.channel)?.toLowerCase() !== "telegram"
  ) {
    return await fail("Telegram publication job requires an approved publish_content approval.");
  }
  const issue = await ctx.issues.get(job.issueId, job.companyId);
  if (!issue) {
    return await fail("Linked issue for Telegram publication job was not found.");
  }
  const documents = await loadTelegramPublicationDocuments(ctx, issue.id, issue.companyId);
  if (!documents.text) {
    return await fail("Telegram publication job could not find telegram-final-copy or telegram-draft content.");
  }

  const sending = await upsertPublicationJob(ctx, {
    ...job,
    status: "sending",
    failureReason: null,
    lastAttemptAt: now,
    attemptCount: job.attemptCount + 1,
    updatedAt: now,
  });

  try {
    const publication = await publishTelegramMessage(ctx, job.companyId, {
      issueId: issue.id,
      issueIdentifier: issue.identifier,
      issueTitle: issue.title,
      approvalId: approval.id,
      destinationId: destination.id,
      destinationLabel: destination.label,
      text: documents.text,
    });
    await upsertTelegramPublishedWorkProduct(ctx, issue, publication, documents);
    const published = await upsertPublicationJob(ctx, {
      ...sending,
      status: "published",
      failureReason: null,
      publishedMessageId: publication.messageId,
      publishedUrl: publication.url,
      updatedAt: new Date().toISOString(),
    });
    await ctx.activity.log({
      companyId: job.companyId,
      entityType: "issue",
      entityId: job.issueId,
      message: `Scheduled Telegram publication delivered to ${publication.destinationLabel}`,
      metadata: {
        pluginId: PLUGIN_ID,
        jobId: job.id,
        approvalId: approval.id,
        destinationId: destination.id,
        publicationExternalId: publication.externalId,
        url: publication.url,
      },
    });
    await ctx.metrics.write("telegram.publish_job.dispatched", 1, {
      companyId: job.companyId,
      destinationId: destination.id,
      status: "published",
    });
    return published;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    const failed = await upsertPublicationJob(ctx, {
      ...sending,
      status: "failed",
      failureReason: reason,
      updatedAt: new Date().toISOString(),
    });
    await ctx.metrics.write("telegram.publish_job.dispatched", 1, {
      companyId: job.companyId,
      destinationId: destination.id,
      status: "failed",
    });
    return failed;
  }
}

async function dispatchPublicationJobsForCompany(
  ctx: PluginContext,
  effective: EffectiveCompanySettings,
): Promise<void> {
  const token = await resolveBotTokenForSettings(ctx, effective.settings);
  const nowIso = new Date().toISOString();
  const dueJobs = (await listPublicationJobs(ctx, effective.companyId))
    .filter((job) => isQueuedPublicationStatus(job.status) && job.publishAt <= nowIso)
    .sort((left, right) => left.publishAt.localeCompare(right.publishAt));
  for (const job of dueJobs) {
    await dispatchPublicationJob(ctx, effective, token, job);
  }
  await noteBotHealth(ctx, effective.companyId, {
    lastPublishDispatchAt: new Date().toISOString(),
  });
}

async function listRecentSourceMessages(
  ctx: PluginContext,
  companyId: string,
  limit = 25,
): Promise<TelegramSourceMessageRecord[]> {
  const entities = await ctx.entities.list({
    entityType: ENTITY_TYPES.sourceMessage,
    scopeKind: "company",
    scopeId: companyId,
    limit: 500,
    offset: 0,
  });
  return entities
    .map((entity) => entity.data as TelegramSourceMessageRecord)
    .filter((entry) => entry.companyId === companyId)
    .sort((left, right) => (right.messageDate ?? right.linkedAt).localeCompare(left.messageDate ?? left.linkedAt))
    .slice(0, limit);
}

async function getSourceMessageRecord(
  ctx: PluginContext,
  companyId: string,
  sourceId: string,
  chatId: string,
  messageId: number,
): Promise<TelegramSourceMessageRecord | null> {
  const entities = await ctx.entities.list({
    entityType: ENTITY_TYPES.sourceMessage,
    scopeKind: "company",
    scopeId: companyId,
    externalId: `${sourceId}:${chatId}:${messageId}`,
    limit: 1,
    offset: 0,
  });
  return entities[0]?.data as TelegramSourceMessageRecord ?? null;
}

async function upsertSourceMessageRecord(
  ctx: PluginContext,
  record: TelegramSourceMessageRecord,
): Promise<TelegramSourceMessageRecord> {
  await ctx.entities.upsert({
    entityType: ENTITY_TYPES.sourceMessage,
    scopeKind: "company",
    scopeId: record.companyId,
    externalId: `${record.sourceId}:${record.chatId}:${record.messageId}`,
    title: `Telegram source ${record.chatId}:${record.messageId}`,
    status: record.issueId ? "materialized" : "received",
    data: record,
  });
  return record;
}

async function listRecentPublications(
  ctx: PluginContext,
  companyId: string,
  limit = 10,
): Promise<TelegramPublication[]> {
  const entities = await ctx.entities.list({
    entityType: ENTITY_TYPES.publication,
    limit: 200,
    offset: 0,
  });
  return entities
    .map((entity) => entity.data as TelegramPublication)
    .filter((entry) => entry.companyId === companyId)
    .sort((left, right) => right.sentAt.localeCompare(left.sentAt))
    .slice(0, limit);
}

async function listIssuePublications(
  ctx: PluginContext,
  companyId: string,
  issueId: string,
): Promise<TelegramPublication[]> {
  const entities = await ctx.entities.list({
    entityType: ENTITY_TYPES.publication,
    scopeKind: "issue",
    scopeId: issueId,
    limit: 100,
    offset: 0,
  });
  return entities
    .map((entity) => entity.data as TelegramPublication)
    .filter((entry) => entry.companyId === companyId && entry.issueId === issueId)
    .sort((left, right) => right.sentAt.localeCompare(left.sentAt));
}

async function listLinkedChats(ctx: PluginContext, companyId: string): Promise<TelegramLinkedChat[]> {
  const entities = await ctx.entities.list({
    entityType: ENTITY_TYPES.linkedChat,
    scopeKind: "company",
    scopeId: companyId,
    limit: 200,
    offset: 0,
  });
  return entities
    .map((entity) => entity.data as TelegramLinkedChat)
    .filter((entry) => entry.companyId === companyId)
    .sort((left, right) => right.linkedAt.localeCompare(left.linkedAt));
}

function getActiveLinkedChats(chats: TelegramLinkedChat[]): TelegramLinkedChat[] {
  return chats.filter((chat) => !chat.revokedAt);
}

async function upsertLinkedChat(
  ctx: PluginContext,
  record: TelegramLinkedChat,
): Promise<TelegramLinkedChat> {
  await ctx.entities.upsert({
    entityType: ENTITY_TYPES.linkedChat,
    scopeKind: "company",
    scopeId: record.companyId,
    externalId: record.chatId,
    title: record.username ? `@${record.username}` : record.displayName,
    status: record.revokedAt ? "revoked" : "linked",
    data: record,
  });
  return record;
}

async function revokeLinkedChatByChatId(
  ctx: PluginContext,
  companyId: string,
  chatId: string,
): Promise<TelegramLinkedChat | null> {
  const chats = await listLinkedChats(ctx, companyId);
  const existing = chats.find((entry) => entry.chatId === chatId) ?? null;
  if (!existing) return null;
  const next: TelegramLinkedChat = {
    ...existing,
    revokedAt: new Date().toISOString(),
  };
  await upsertLinkedChat(ctx, next);
  return next;
}

async function setLinkedChatForBoardUser(
  ctx: PluginContext,
  companyId: string,
  nextChat: TelegramLinkedChat,
): Promise<void> {
  const chats = await listLinkedChats(ctx, companyId);
  const now = new Date().toISOString();
  for (const chat of chats) {
    if (!chat.boardUserId || chat.boardUserId !== nextChat.boardUserId) continue;
    if (chat.chatId === nextChat.chatId) continue;
    if (chat.revokedAt) continue;
    await upsertLinkedChat(ctx, {
      ...chat,
      revokedAt: now,
    });
  }
  await upsertLinkedChat(ctx, nextChat);
}

async function getClaimCodeRecord(
  ctx: PluginContext,
  companyId: string,
  code: string,
): Promise<TelegramClaimCodeRecord | null> {
  const entities = await ctx.entities.list({
    entityType: ENTITY_TYPES.claimCode,
    scopeKind: "company",
    scopeId: companyId,
    externalId: code,
    limit: 1,
    offset: 0,
  });
  const record = entities[0]?.data as TelegramClaimCodeRecord | undefined;
  return record && record.companyId === companyId ? record : null;
}

async function upsertClaimCode(ctx: PluginContext, record: TelegramClaimCodeRecord): Promise<void> {
  await ctx.entities.upsert({
    entityType: ENTITY_TYPES.claimCode,
    scopeKind: "company",
    scopeId: record.companyId,
    externalId: record.code,
    title: `Telegram link code ${record.code}`,
    status: record.consumedAt ? "consumed" : "active",
    data: record,
  });
}

function generateClaimCodeValue() {
  let code = "";
  for (let index = 0; index < 8; index += 1) {
    code += CLAIM_CODE_ALPHABET[Math.floor(Math.random() * CLAIM_CODE_ALPHABET.length)];
  }
  return code;
}

async function generateClaimCode(
  ctx: PluginContext,
  companyId: string,
  boardUserId: string | null,
  ttlMinutes: number,
): Promise<TelegramClaimCodeRecord> {
  const now = Date.now();
  let record: TelegramClaimCodeRecord | null = null;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = generateClaimCodeValue();
    const existing = await getClaimCodeRecord(ctx, companyId, code);
    if (existing) continue;
    record = {
      code,
      companyId,
      boardUserId,
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + ttlMinutes * 60_000).toISOString(),
      consumedAt: null,
    };
    break;
  }
  if (!record) {
    throw new Error("Failed to generate a unique Telegram link code");
  }
  await upsertClaimCode(ctx, record);
  return record;
}

async function listIssueWatchers(
  ctx: PluginContext,
  issueId: string,
): Promise<TelegramIssueWatcherRecord[]> {
  const entities = await ctx.entities.list({
    entityType: ENTITY_TYPES.watcher,
    scopeKind: "issue",
    scopeId: issueId,
    limit: 200,
    offset: 0,
  });
  return entities.map((entity) => entity.data as TelegramIssueWatcherRecord);
}

async function watchIssueForLinkedChat(
  ctx: PluginContext,
  issue: Issue,
  linkedChat: TelegramLinkedChat,
): Promise<void> {
  const record: TelegramIssueWatcherRecord = {
    companyId: issue.companyId,
    issueId: issue.id,
    chatId: linkedChat.chatId,
    telegramUserId: linkedChat.telegramUserId,
    boardUserId: linkedChat.boardUserId,
    linkedAt: new Date().toISOString(),
  };
  await ctx.entities.upsert({
    entityType: ENTITY_TYPES.watcher,
    scopeKind: "issue",
    scopeId: issue.id,
    externalId: linkedChat.chatId,
    title: issue.identifier ? `Telegram watcher for ${issue.identifier}` : `Telegram watcher for ${issue.id}`,
    status: "active",
    data: record,
  });
}

async function upsertThreadLink(
  ctx: PluginContext,
  record: TelegramThreadLinkRecord,
): Promise<void> {
  const resourceType = record.resourceType
    ?? (record.approvalId
      ? "approval"
      : record.joinRequestId
        ? "join_request"
        : record.budgetIncidentId
          ? "budget_incident"
          : "issue");
  const resourceId = record.resourceId
    ?? record.issueId
    ?? record.approvalId
    ?? record.joinRequestId
    ?? record.budgetIncidentId;
  await ctx.entities.upsert({
    entityType: ENTITY_TYPES.threadLink,
    scopeKind: resourceType === "issue" ? "issue" : "company",
    scopeId: resourceType === "issue" ? (record.issueId ?? resourceId) : record.companyId,
    externalId: `${record.chatId}:${record.messageId}`,
    title: `Telegram thread ${record.chatId}:${record.messageId}`,
    status: "linked",
    data: {
      ...record,
      resourceType,
      resourceId,
      issueId: resourceType === "issue" ? (record.issueId ?? resourceId ?? undefined) : record.issueId,
      approvalId: resourceType === "approval" ? (record.approvalId ?? resourceId ?? undefined) : record.approvalId,
      joinRequestId: resourceType === "join_request" ? (record.joinRequestId ?? resourceId ?? undefined) : record.joinRequestId,
      budgetIncidentId: resourceType === "budget_incident"
        ? (record.budgetIncidentId ?? resourceId ?? undefined)
        : record.budgetIncidentId,
    },
  });
}

async function getThreadLinkByReply(
  ctx: PluginContext,
  chatId: string,
  messageId: number,
): Promise<TelegramThreadLinkRecord | null> {
  const entities = await ctx.entities.list({
    entityType: ENTITY_TYPES.threadLink,
    externalId: `${chatId}:${messageId}`,
    limit: 1,
    offset: 0,
  });
  const record = entities[0]?.data as TelegramThreadLinkRecord | undefined;
  if (!record) return null;
  if (!record.resourceType) {
    return {
      ...record,
      resourceType: "issue",
      resourceId: record.issueId,
    };
  }
  return record;
}

async function getProjectName(ctx: PluginContext, issue: Issue): Promise<string | null> {
  if (!issue.projectId) return null;
  const project = await ctx.projects.get(issue.projectId, issue.companyId);
  return project?.name ?? null;
}

async function getAgentLabel(ctx: PluginContext, issue: Issue): Promise<string | null> {
  if (!issue.assigneeAgentId) return null;
  const agent = await ctx.agents.get(issue.assigneeAgentId, issue.companyId);
  return agent?.name ?? issue.assigneeAgentId;
}

function extractTelegramMessageText(message: TelegramMessage): string {
  return trimToNull(message.text) ?? trimToNull(message.caption) ?? "";
}

function shouldIngestSourceMessage(source: TelegramIngestionSource, message: TelegramMessage): boolean {
  const chatId = String(message.chat.id);
  if (chatId === source.chatId) {
    return source.mode === "channel_posts" || source.mode === "both";
  }
  if (source.discussionChatId && chatId === source.discussionChatId) {
    return source.mode === "discussion_replies" || source.mode === "both";
  }
  return false;
}

async function ensureRoutineForSource(
  ctx: PluginContext,
  companyId: string,
  source: TelegramIngestionSource,
): Promise<string> {
  const configuredRoutineId = trimToNull(source.routineId);
  if (configuredRoutineId) {
    const existing = await ctx.routines.get(configuredRoutineId, companyId);
    if (existing) return configuredRoutineId;
  }
  const runtimeRoutineId = await getRuntimeSourceRoutineId(ctx, companyId, source.id);
  if (runtimeRoutineId) {
    const existing = await ctx.routines.get(runtimeRoutineId, companyId);
    if (existing) return runtimeRoutineId;
  }
  if (!source.projectId || !source.assigneeAgentId) {
    throw new Error(`Telegram source "${source.label}" is missing project or assignee for routine creation.`);
  }
  const created = await ctx.routines.create(companyId, {
    projectId: source.projectId,
    assigneeAgentId: source.assigneeAgentId,
    title: source.label ? `Telegram ingest: ${source.label}` : "Telegram ingest",
    description: `Auto-created Telegram ingestion routine for source ${source.chatId}.`,
    priority: "medium",
    status: "active",
    concurrencyPolicy: "coalesce_if_active",
    catchUpPolicy: "skip_missed",
  });
  await setRuntimeSourceRoutineId(ctx, companyId, source.id, created.id);
  return created.id;
}

async function seedTelegramEditorialDocuments(
  ctx: PluginContext,
  issueId: string,
  companyId: string,
  message: TelegramMessage,
  source: TelegramIngestionSource,
): Promise<void> {
  const sourceText = extractTelegramMessageText(message);
  const messageDate = message.date ? new Date(message.date * 1000).toISOString() : null;
  const sourceBody = [
    `# Telegram Source`,
    ``,
    `- Source: ${source.label}`,
    `- Chat ID: ${source.chatId}`,
    source.publicHandle ? `- Handle: @${source.publicHandle}` : null,
    `- Message ID: ${message.message_id}`,
    messageDate ? `- Message date: ${messageDate}` : null,
    ``,
    sourceText || "_No text content captured._",
  ].filter((value): value is string => Boolean(value)).join("\n");

  const notesBody = [
    `# Telegram Notes`,
    ``,
    `- Source label: ${source.label}`,
    `- Ingested at: ${new Date().toISOString()}`,
    `- Mode: ${source.mode}`,
    ``,
    `## Raw excerpt`,
    sourceText ? excerpt(sourceText, 500) : "_No text captured._",
  ].join("\n");

  const draftBody = sourceText ? excerpt(sourceText, 3000) : "";

  await ctx.issues.documents.upsert({
    issueId,
    companyId,
    key: "telegram-source",
    title: "Telegram Source",
    format: "markdown",
    body: sourceBody,
    changeSummary: "Captured Telegram source message",
  });
  await ctx.issues.documents.upsert({
    issueId,
    companyId,
    key: "telegram-notes",
    title: "Telegram Notes",
    format: "markdown",
    body: notesBody,
    changeSummary: "Updated Telegram notes",
  });
  await ctx.issues.documents.upsert({
    issueId,
    companyId,
    key: "telegram-draft",
    title: "Telegram Draft",
    format: "markdown",
    body: draftBody,
    changeSummary: "Prepared Telegram draft scaffold",
  });
  await ctx.issues.documents.upsert({
    issueId,
    companyId,
    key: "telegram-final-copy",
    title: "Telegram Final Copy",
    format: "markdown",
    body: draftBody,
    changeSummary: "Prepared Telegram final copy scaffold",
  });
  await ctx.issues.documents.upsert({
    issueId,
    companyId,
    key: "telegram-publish-checklist",
    title: "Telegram Publish Checklist",
    format: "markdown",
    body: [
      `# Telegram Publish Checklist`,
      ``,
      `- [ ] Source attribution captured`,
      `- [ ] Claims checked`,
      `- [ ] Rewrite completed`,
      `- [ ] Final copy approved`,
      `- [ ] Destination confirmed`,
    ].join("\n"),
    changeSummary: "Created Telegram publish checklist",
  });
}

async function ingestConfiguredSourceUpdate(
  ctx: PluginContext,
  effective: EffectiveCompanySettings,
  message: TelegramMessage,
): Promise<boolean> {
  const sources = getConfiguredSources(effective.settings).filter((source) => source.enabled);
  const source = sources.find((entry) => shouldIngestSourceMessage(entry, message)) ?? null;
  if (!source) return false;

  const companyId = effective.companyId;
  const chatId = String(message.chat.id);
  const existing = await getSourceMessageRecord(ctx, companyId, source.id, chatId, message.message_id);
  if (existing?.issueId) {
    return true;
  }

  const routineId = await ensureRoutineForSource(ctx, companyId, source);
  const payload = {
    channel: "telegram",
    sourceId: source.id,
    sourceLabel: source.label,
    sourceChatId: source.chatId,
    sourcePublicHandle: source.publicHandle || null,
    discussionChatId: source.discussionChatId || null,
    issueTemplateKey: source.issueTemplateKey || null,
    messageId: message.message_id,
    messageDate: message.date ? new Date(message.date * 1000).toISOString() : null,
    chatType: message.chat.type,
    chatTitle: message.chat.title ?? null,
    text: extractTelegramMessageText(message),
  } satisfies Record<string, unknown>;
  const run = await ctx.routines.run(routineId, companyId, {
    source: "api",
    payload,
    idempotencyKey: `telegram:${chatId}:${message.message_id}`,
  });
  const issueId = run.linkedIssueId ?? null;
  if (issueId) {
    const issue = await ctx.issues.get(issueId, companyId);
    const sourceText = extractTelegramMessageText(message);
    if (issue && sourceText) {
      const nextTitle = `${source.label}: ${excerpt(sourceText, 120)}`;
      await ctx.issues.update(issue.id, {
        title: nextTitle,
        description: issue.description ?? sourceText,
      }, companyId);
    }
    await seedTelegramEditorialDocuments(ctx, issueId, companyId, message, source);
  }
  await upsertSourceMessageRecord(ctx, {
    companyId,
    sourceId: source.id,
    chatId,
    messageId: message.message_id,
    routineRunId: run.id,
    issueId,
    messageDate: message.date ? new Date(message.date * 1000).toISOString() : null,
    discussionChatId: source.discussionChatId || null,
    excerpt: extractTelegramMessageText(message) ? excerpt(extractTelegramMessageText(message), 300) : null,
    hash: null,
    direction: "inbound",
    linkedAt: new Date().toISOString(),
  });
  await noteBotHealth(ctx, companyId, {
    lastIngestionAt: new Date().toISOString(),
  });
  return true;
}

async function renderIssueMessage(
  ctx: PluginContext,
  issue: Issue,
  options?: {
    prefix?: string;
    includeReplyHint?: boolean;
  },
): Promise<string> {
  const [projectName, assigneeAgentLabel] = await Promise.all([
    getProjectName(ctx, issue),
    getAgentLabel(ctx, issue),
  ]);

  const lines = [
    options?.prefix ? `${options.prefix}` : null,
    `${issue.identifier ?? issue.id}`,
    issue.title,
    `Status: ${issue.status}`,
    `Priority: ${issue.priority}`,
    `Assignee agent: ${assigneeAgentLabel ?? "unassigned"}`,
    `Assignee user: ${issue.assigneeUserId ?? "unassigned"}`,
    `Reviewer user: ${issue.reviewerUserId ?? "not set"}`,
    `Project: ${projectName ?? "none"}`,
    `Updated: ${toIsoString(issue.updatedAt) ?? "unknown"}`,
    issue.description ? `Description: ${excerpt(issue.description, 280)}` : null,
    options?.includeReplyHint ? "Reply to this message in Telegram to add context to the issue." : null,
  ].filter((value): value is string => Boolean(value));

  return lines.join("\n");
}

function formatApprovalType(type: Approval["type"]): string {
  switch (type) {
    case "hire_agent":
      return "Hire agent";
    case "approve_ceo_strategy":
      return "CEO strategy";
    case "budget_override_required":
      return "Budget override";
    case "publish_content":
      return "Publish content";
    case "install_company_skill":
      return "Install company skill";
    case "install_connector_plugin":
      return "Install connector plugin";
    default:
      return type;
  }
}

function summarizeApprovalPayload(payload: Record<string, unknown>): string | null {
  const typeSpecific = [
    trimToNull(payload.name),
    trimToNull(payload.role),
    trimToNull(payload.roleBundleKey),
    trimToNull(payload.destinationLabel),
    trimToNull(payload.channel),
    trimToNull(payload.skillId),
    trimToNull(payload.packageName),
    trimToNull(payload.pluginPackageName),
    trimToNull(payload.localPath),
    trimToNull(payload.source),
  ].filter((value): value is string => Boolean(value));
  if (typeSpecific.length === 0) return null;
  return excerpt(typeSpecific.join(" | "), 240);
}

function renderMoney(cents: number): string {
  return `$${(Math.max(0, cents) / 100).toFixed(2)}`;
}

function parseMoneyToCents(value: string): number | null {
  const normalized = value.replace(/[$,\s]/g, "").trim();
  if (!normalized) return null;
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.round(parsed * 100);
}

function renderApprovalPayloadLines(approval: Approval): string[] {
  const payload = approval.payload as Record<string, unknown>;
  switch (approval.type) {
    case "hire_agent":
      return [
        trimToNull(payload.name) ? `Candidate: ${trimToNull(payload.name)}` : null,
        trimToNull(payload.role) ? `Role: ${trimToNull(payload.role)}` : null,
        trimToNull(payload.roleBundleKey) ? `Bundle: ${trimToNull(payload.roleBundleKey)}` : null,
        trimToNull(payload.staffingReason) ? `Need: ${excerpt(trimToNull(payload.staffingReason) ?? "", 180)}` : null,
      ].filter((value): value is string => Boolean(value));
    case "budget_override_required":
      return [
        trimToNull(payload.scopeName) ? `Scope: ${trimToNull(payload.scopeName)}` : null,
        typeof payload.amountObserved === "number" ? `Observed: ${renderMoney(payload.amountObserved)}` : null,
        typeof payload.amountLimit === "number" ? `Limit: ${renderMoney(payload.amountLimit)}` : null,
      ].filter((value): value is string => Boolean(value));
    case "publish_content":
      return [
        trimToNull(payload.channel) ? `Channel: ${trimToNull(payload.channel)}` : null,
        trimToNull(payload.destinationLabel) ? `Destination: ${trimToNull(payload.destinationLabel)}` : null,
        trimToNull(payload.title) ? `Title: ${trimToNull(payload.title)}` : null,
      ].filter((value): value is string => Boolean(value));
    case "install_company_skill":
      return [
        trimToNull(payload.skillId) ? `Skill: ${trimToNull(payload.skillId)}` : null,
        trimToNull(payload.source) ? `Source: ${trimToNull(payload.source)}` : null,
      ].filter((value): value is string => Boolean(value));
    case "install_connector_plugin":
      return [
        trimToNull(payload.pluginPackageName) ? `Plugin: ${trimToNull(payload.pluginPackageName)}` : null,
        trimToNull(payload.localPath) ? `Local path: ${trimToNull(payload.localPath)}` : null,
        trimToNull(payload.packageName) ? `Package: ${trimToNull(payload.packageName)}` : null,
      ].filter((value): value is string => Boolean(value));
    default:
      return [];
  }
}

async function renderApprovalMessage(
  ctx: PluginContext,
  approval: Approval,
  options?: {
    prefix?: string;
    includeComments?: boolean;
    listKind?: "board" | "mine";
  },
): Promise<string> {
  const linkedIssues = await ctx.approvals.listIssues(approval.id);
  const comments = options?.includeComments ? await ctx.approvals.listComments(approval.id) : [];
  const payloadSummary = summarizeApprovalPayload(approval.payload as Record<string, unknown>);
  const linkedIssueSummary = linkedIssues.length > 0
    ? linkedIssues
      .slice(0, 4)
      .map((issue) => `${issue.identifier ?? issue.id} (${issue.status})`)
      .join(", ")
    : "none";
  const commentSummary = comments.length > 0
    ? comments
      .slice(-3)
      .map((comment) => `- ${excerpt(comment.body, 120)}`)
      .join("\n")
    : null;
  const lines = [
    options?.prefix ?? null,
    `Approval ${approval.id}`,
    `${formatApprovalType(approval.type)} (${approval.status})`,
    `Requested by user: ${approval.requestedByUserId ?? "n/a"}`,
    `Requested by agent: ${approval.requestedByAgentId ?? "n/a"}`,
    `Created: ${toIsoString(approval.createdAt) ?? "unknown"}`,
    `Updated: ${toIsoString(approval.updatedAt) ?? "unknown"}`,
    payloadSummary ? `Payload: ${payloadSummary}` : null,
    ...renderApprovalPayloadLines(approval),
    `Linked issues: ${linkedIssueSummary}`,
    approval.decisionNote ? `Decision note: ${excerpt(approval.decisionNote, 240)}` : null,
    approval.status === "revision_requested" && options?.listKind === "mine" && !approval.requestedByAgentId
      ? "Use Resubmit to requeue the current payload, or switch to the web UI to edit it."
      : null,
    options?.includeComments ? "Reply to this message in Telegram to add an approval comment." : null,
    commentSummary ? `Comments:\n${commentSummary}` : null,
  ].filter((value): value is string => Boolean(value));
  return lines.join("\n");
}

function renderJoinRequestMessage(
  request: JoinRequest,
  options?: { prefix?: string },
): string {
  const lines = [
    options?.prefix ?? null,
    `Join request ${request.id}`,
    `${request.requestType === "agent" ? "Agent" : "Human"} join (${request.status})`,
    `Invite: ${request.inviteId}`,
    `Requested by user: ${request.requestingUserId ?? "n/a"}`,
    request.requestEmailSnapshot ? `Email: ${request.requestEmailSnapshot}` : null,
    request.agentName ? `Agent name: ${request.agentName}` : null,
    request.adapterType ? `Adapter: ${request.adapterType}` : null,
    request.capabilities ? `Capabilities: ${excerpt(request.capabilities, 200)}` : null,
    `Created: ${toIsoString(request.createdAt) ?? "unknown"}`,
    `Updated: ${toIsoString(request.updatedAt) ?? "unknown"}`,
  ].filter((value): value is string => Boolean(value));
  return lines.join("\n");
}

function renderBudgetIncidentMessage(
  incident: BudgetIncident,
  options?: { prefix?: string },
): string {
  const lines = [
    options?.prefix ?? null,
    `Budget incident ${incident.id}`,
    `${incident.scopeName} (${incident.thresholdType}, ${incident.status})`,
    `Observed: ${renderMoney(incident.amountObserved)}`,
    `Limit: ${renderMoney(incident.amountLimit)}`,
    `Metric: ${incident.metric}`,
    `Window: ${incident.windowKind}`,
    `Created: ${toIsoString(incident.createdAt) ?? "unknown"}`,
    `Updated: ${toIsoString(incident.updatedAt) ?? "unknown"}`,
    incident.approvalId ? `Linked approval: ${incident.approvalId}` : null,
  ].filter((value): value is string => Boolean(value));
  return lines.join("\n");
}

function issueActionKeyboard(issue: Issue) {
  return {
    inline_keyboard: [
      [
        { text: "Refresh", callback_data: `${CALLBACK_PREFIX.refresh}:${issue.id}` },
        { text: "Todo", callback_data: `${CALLBACK_PREFIX.status}:${issue.id}:todo` },
      ],
      [
        { text: "Blocked", callback_data: `${CALLBACK_PREFIX.status}:${issue.id}:blocked` },
        { text: "Review", callback_data: `${CALLBACK_PREFIX.status}:${issue.id}:in_review` },
      ],
      [
        { text: "Done", callback_data: `${CALLBACK_PREFIX.status}:${issue.id}:done` },
        { text: "Reopen", callback_data: `${CALLBACK_PREFIX.status}:${issue.id}:reopen` },
      ],
    ],
  };
}

function canResubmitApproval(approval: Approval, linkedChat: TelegramLinkedChat, listKind: "board" | "mine"): boolean {
  return listKind === "mine"
    && approval.status === "revision_requested"
    && approval.requestedByUserId === linkedChat.boardUserId
    && !approval.requestedByAgentId;
}

function approvalActionKeyboard(
  approval: Approval,
  listKind: "board" | "mine",
  linkedChat?: TelegramLinkedChat,
) {
  const detailRows: Array<Array<{ text: string; callback_data: string }>> = [];
  if (ACTIONABLE_APPROVAL_STATUSES.has(approval.status)) {
    detailRows.push([
      { text: "Approve", callback_data: `${CALLBACK_PREFIX.approvalDecision}:${approval.id}:approve:${listKind}` },
      { text: "Reject", callback_data: `${CALLBACK_PREFIX.approvalDecision}:${approval.id}:reject:${listKind}` },
    ]);
    detailRows.push([
      { text: "Request revision", callback_data: `${CALLBACK_PREFIX.approvalDecision}:${approval.id}:revision:${listKind}` },
    ]);
  }
  if (linkedChat && canResubmitApproval(approval, linkedChat, listKind)) {
    detailRows.push([
      { text: "Resubmit", callback_data: `${CALLBACK_PREFIX.approvalDecision}:${approval.id}:resubmit:${listKind}` },
    ]);
  }
  detailRows.push([
    { text: "Comments", callback_data: `${CALLBACK_PREFIX.approvalComments}:${approval.id}:${listKind}` },
    { text: "Refresh", callback_data: `${CALLBACK_PREFIX.approvalRefresh}:${approval.id}:${listKind}` },
  ]);
  detailRows.push([
    { text: "Back to list", callback_data: `${CALLBACK_PREFIX.approvalList}:${listKind}:0` },
  ]);
  return { inline_keyboard: detailRows };
}

function listKeyboard(kind: "tasks" | "blocked" | "mine" | "review", page: number, issues: Issue[], total: number) {
  const rows = issues.map((issue) => ([
    {
      text: `${issue.identifier ?? issue.title} (${issue.status})`,
      callback_data: `${CALLBACK_PREFIX.view}:${issue.id}`,
    },
  ]));
  const navRow: Array<{ text: string; callback_data: string }> = [];
  if (page > 0) navRow.push({ text: "Prev", callback_data: `${CALLBACK_PREFIX.list}:${kind}:${page - 1}` });
  if ((page + 1) * LIST_PAGE_SIZE < total) {
    navRow.push({ text: "Next", callback_data: `${CALLBACK_PREFIX.list}:${kind}:${page + 1}` });
  }
  navRow.push({ text: "Refresh", callback_data: `${CALLBACK_PREFIX.list}:${kind}:${page}` });
  if (navRow.length > 0) rows.push(navRow);
  return { inline_keyboard: rows };
}

function approvalListKeyboard(
  kind: "board" | "mine",
  page: number,
  approvals: Approval[],
  total: number,
) {
  const rows = approvals.map((approval) => ([{
    text: `${formatApprovalType(approval.type)} (${approval.status})`,
    callback_data: `${CALLBACK_PREFIX.approvalView}:${approval.id}:${kind}`,
  }]));
  const navRow: Array<{ text: string; callback_data: string }> = [];
  if (page > 0) navRow.push({ text: "Prev", callback_data: `${CALLBACK_PREFIX.approvalList}:${kind}:${page - 1}` });
  if ((page + 1) * LIST_PAGE_SIZE < total) {
    navRow.push({ text: "Next", callback_data: `${CALLBACK_PREFIX.approvalList}:${kind}:${page + 1}` });
  }
  navRow.push({ text: "Refresh", callback_data: `${CALLBACK_PREFIX.approvalList}:${kind}:${page}` });
  if (navRow.length > 0) rows.push(navRow);
  return { inline_keyboard: rows };
}

async function listOpenIssuesForCompany(ctx: PluginContext, companyId: string): Promise<Issue[]> {
  const issues = await ctx.issues.list({ companyId, limit: 500, offset: 0 });
  return issues
    .filter((issue) => OPEN_ISSUE_STATUSES.has(issue.status))
    .sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime());
}

async function listIssuesForKind(
  ctx: PluginContext,
  companyId: string,
  kind: "tasks" | "blocked" | "mine" | "review",
  linkedChat: TelegramLinkedChat,
): Promise<Issue[]> {
  if (kind === "blocked") {
    return (await ctx.issues.list({ companyId, status: "blocked", limit: 200, offset: 0 }))
      .sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime());
  }
  if (kind === "review") {
    return (await ctx.issues.list({ companyId, status: "in_review", limit: 200, offset: 0 }))
      .sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime());
  }
  if (kind === "mine") {
    if (!linkedChat.boardUserId) return [];
    return (await ctx.issues.list({
      companyId,
      assigneeUserId: linkedChat.boardUserId,
      limit: 200,
      offset: 0,
    })).sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime());
  }
  return await listOpenIssuesForCompany(ctx, companyId);
}

async function listApprovalsForKind(
  ctx: PluginContext,
  companyId: string,
  kind: "board" | "mine",
  linkedChat: TelegramLinkedChat,
): Promise<Approval[]> {
  const approvals = kind === "board"
    ? await ctx.approvals.list(companyId)
    : linkedChat.boardUserId
      ? await ctx.approvals.list(companyId)
      : [];
  const filtered = approvals.filter((approval) => {
    if (kind === "board") return ACTIONABLE_APPROVAL_STATUSES.has(approval.status);
    return linkedChat.boardUserId
      ? approval.requestedByUserId === linkedChat.boardUserId && approval.status !== "cancelled"
      : false;
  });
  return filtered.sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime());
}

async function listJoinRequestsForCompany(
  ctx: PluginContext,
  companyId: string,
): Promise<JoinRequest[]> {
  return (await ctx.joinRequests.list(companyId, { status: "pending_approval" }))
    .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime());
}

async function listBudgetIncidentsForCompany(
  ctx: PluginContext,
  companyId: string,
): Promise<BudgetIncident[]> {
  const overview = await ctx.budgets.overview(companyId);
  return overview.activeIncidents
    .filter((incident) => incident.status === "open")
    .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime());
}

async function buildInboxSummary(
  ctx: PluginContext,
  companyId: string,
  linkedChat: TelegramLinkedChat,
): Promise<{
  text: string;
  keyboard: { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> };
}> {
  const [blockedIssues, reviewIssues, boardApprovals, myApprovals, joinRequests, budgetIncidents, publicationJobs, sourceMessages] = await Promise.all([
    ctx.issues.list({ companyId, status: "blocked", limit: 200, offset: 0 }),
    ctx.issues.list({ companyId, status: "in_review", limit: 200, offset: 0 }),
    listApprovalsForKind(ctx, companyId, "board", linkedChat),
    listApprovalsForKind(ctx, companyId, "mine", linkedChat),
    listJoinRequestsForCompany(ctx, companyId),
    listBudgetIncidentsForCompany(ctx, companyId),
    listPublicationJobs(ctx, companyId, { limit: 100 }),
    listRecentSourceMessages(ctx, companyId, 25),
  ]);
  const myPendingApprovalCount = myApprovals.filter((approval) => approval.status === "pending").length;
  const myRevisionApprovalCount = myApprovals.filter((approval) => approval.status === "revision_requested").length;
  const scheduledPublishCount = publicationJobs.filter((job) => isQueuedPublicationStatus(job.status)).length;
  const failedPublishCount = publicationJobs.filter((job) => job.status === "failed").length;
  const lines = [
    "Paperclip inbox",
    `Blocked tasks: ${blockedIssues.length}`,
    `Tasks in review: ${reviewIssues.length}`,
    `Board approvals: ${boardApprovals.length}`,
    `My pending approvals: ${myPendingApprovalCount}`,
    `My revisions: ${myRevisionApprovalCount}`,
    `Pending join requests: ${joinRequests.length}`,
    `Open budget incidents: ${budgetIncidents.length}`,
    `Scheduled Telegram publishes: ${scheduledPublishCount}`,
    `Failed Telegram publishes: ${failedPublishCount}`,
    `Recent ingested stories: ${sourceMessages.length}`,
  ];
  return {
    text: lines.join("\n"),
    keyboard: {
      inline_keyboard: [
        [
          { text: "Blocked tasks", callback_data: `${CALLBACK_PREFIX.list}:blocked:0` },
          { text: "Tasks in review", callback_data: `${CALLBACK_PREFIX.list}:review:0` },
        ],
        [
          { text: "Board approvals", callback_data: `${CALLBACK_PREFIX.approvalList}:board:0` },
          { text: "My requests", callback_data: `${CALLBACK_PREFIX.approvalList}:mine:0` },
        ],
        [
          { text: "Join requests", callback_data: `${CALLBACK_PREFIX.joinList}:0` },
          { text: "Budgets", callback_data: `${CALLBACK_PREFIX.budgetList}:0` },
        ],
        [
          { text: "Refresh", callback_data: `${CALLBACK_PREFIX.inbox}:refresh` },
        ],
      ],
    },
  };
}

async function renderChannelsSummary(
  ctx: PluginContext,
  companyId: string,
): Promise<string> {
  const effective = await getEffectiveCompanySettings(ctx, companyId);
  const destinations = getConfiguredDestinations(effective.settings);
  const sources = getConfiguredSources(effective.settings);
  const lines = [
    "Telegram channels",
    `Destinations: ${destinations.length}`,
    ...destinations.slice(0, 8).map((destination) =>
      `- ${destination.label} (${destination.enabled ? "enabled" : "disabled"}) -> ${destination.chatId || destination.publicHandle || "unset"}`,
    ),
    `Sources: ${sources.length}`,
    ...sources.slice(0, 8).map((source) =>
      `- ${source.label} (${source.mode}, ${source.enabled ? "enabled" : "disabled"}) -> ${source.chatId}`,
    ),
  ];
  return lines.join("\n");
}

async function renderPublicationQueueSummary(
  ctx: PluginContext,
  companyId: string,
): Promise<string> {
  const jobs = await listPublicationJobs(ctx, companyId, { limit: 50 });
  const queued = jobs.filter((job) => isQueuedPublicationStatus(job.status));
  const failed = jobs.filter((job) => job.status === "failed");
  const lines = [
    "Telegram publication queue",
    `Queued: ${queued.length}`,
    `Failed: ${failed.length}`,
    ...queued.slice(0, 8).map((job) =>
      `- ${job.issueId} -> ${job.destinationId} at ${formatTimestamp(job.publishAt)} (${job.status})`,
    ),
  ];
  if (queued.length === 0) {
    lines.push("No scheduled Telegram publications right now.");
  }
  return lines.join("\n");
}

function joinListKeyboard(
  page: number,
  requests: JoinRequest[],
  total: number,
) {
  const rows = requests.map((request) => ([{
    text: `${request.requestType === "agent" ? "Agent" : "Human"} join (${request.status})`,
    callback_data: `${CALLBACK_PREFIX.joinView}:${request.id}`,
  }]));
  const navRow: Array<{ text: string; callback_data: string }> = [];
  if (page > 0) navRow.push({ text: "Prev", callback_data: `${CALLBACK_PREFIX.joinList}:${page - 1}` });
  if ((page + 1) * LIST_PAGE_SIZE < total) navRow.push({ text: "Next", callback_data: `${CALLBACK_PREFIX.joinList}:${page + 1}` });
  navRow.push({ text: "Refresh", callback_data: `${CALLBACK_PREFIX.joinList}:${page}` });
  rows.push(navRow);
  return { inline_keyboard: rows };
}

function joinActionKeyboard(request: JoinRequest) {
  const rows: Array<Array<{ text: string; callback_data: string }>> = [];
  if (request.status === "pending_approval") {
    rows.push([
      { text: "Approve", callback_data: `${CALLBACK_PREFIX.joinDecision}:${request.id}:approve` },
      { text: "Reject", callback_data: `${CALLBACK_PREFIX.joinDecision}:${request.id}:reject` },
    ]);
  }
  rows.push([
    { text: "Refresh", callback_data: `${CALLBACK_PREFIX.joinRefresh}:${request.id}` },
    { text: "Back to list", callback_data: `${CALLBACK_PREFIX.joinList}:0` },
  ]);
  return { inline_keyboard: rows };
}

function budgetListKeyboard(
  page: number,
  incidents: BudgetIncident[],
  total: number,
) {
  const rows = incidents.map((incident) => ([{
    text: `${incident.scopeName} (${incident.thresholdType}, ${incident.status})`,
    callback_data: `${CALLBACK_PREFIX.budgetView}:${incident.id}`,
  }]));
  const navRow: Array<{ text: string; callback_data: string }> = [];
  if (page > 0) navRow.push({ text: "Prev", callback_data: `${CALLBACK_PREFIX.budgetList}:${page - 1}` });
  if ((page + 1) * LIST_PAGE_SIZE < total) navRow.push({ text: "Next", callback_data: `${CALLBACK_PREFIX.budgetList}:${page + 1}` });
  navRow.push({ text: "Refresh", callback_data: `${CALLBACK_PREFIX.budgetList}:${page}` });
  rows.push(navRow);
  return { inline_keyboard: rows };
}

function budgetActionKeyboard(incident: BudgetIncident) {
  const rows: Array<Array<{ text: string; callback_data: string }>> = [];
  if (incident.status === "open") {
    rows.push([
      { text: "Keep paused", callback_data: `${CALLBACK_PREFIX.budgetDecision}:${incident.id}:keep_paused` },
      { text: "Raise budget & resume", callback_data: `${CALLBACK_PREFIX.budgetDecision}:${incident.id}:raise` },
    ]);
  }
  rows.push(incident.status === "open"
    ? [
      { text: "Refresh", callback_data: `${CALLBACK_PREFIX.budgetRefresh}:${incident.id}` },
      { text: "Back to list", callback_data: `${CALLBACK_PREFIX.budgetList}:0` },
    ]
    : [
      { text: "Back to list", callback_data: `${CALLBACK_PREFIX.budgetList}:0` },
    ]);
  return { inline_keyboard: rows };
}

async function sendIssueCard(
  ctx: PluginContext,
  token: string,
  issue: Issue,
  input: {
    chatId: string;
    prefix?: string;
    editMessageId?: number;
    reason: string;
  },
): Promise<void> {
  const text = await renderIssueMessage(ctx, issue, {
    prefix: input.prefix,
    includeReplyHint: true,
  });
  const keyboard = issueActionKeyboard(issue);
  const message = input.editMessageId
    ? await editTelegramMessage(ctx, token, {
      chatId: input.chatId,
      messageId: input.editMessageId,
      text,
      replyMarkup: keyboard,
    })
    : await sendTelegramMessage(ctx, token, {
      chatId: input.chatId,
      text,
      replyMarkup: keyboard,
    });

  await upsertThreadLink(ctx, {
    companyId: issue.companyId,
    issueId: issue.id,
    chatId: String(message.chat.id),
    messageId: message.message_id,
    direction: "outbound",
    linkedAt: new Date().toISOString(),
    reason: input.reason,
  });
}

async function sendIssueList(
  ctx: PluginContext,
  token: string,
  input: {
    companyId: string;
    linkedChat: TelegramLinkedChat;
    kind: "tasks" | "blocked" | "mine" | "review";
    page: number;
    editMessageId?: number;
  },
): Promise<void> {
  const issues = await listIssuesForKind(ctx, input.companyId, input.kind, input.linkedChat);
  const start = Math.max(0, input.page) * LIST_PAGE_SIZE;
  const slice = issues.slice(start, start + LIST_PAGE_SIZE);
  const header = input.kind === "blocked"
    ? "Blocked tasks"
    : input.kind === "review"
      ? "Tasks in review"
    : input.kind === "mine"
      ? "My tasks"
      : "Open tasks";
  const summary = slice.length === 0
    ? `${header}\nNo matching tasks right now.`
    : `${header}\n${slice.map((issue, index) => `${start + index + 1}. ${issue.identifier ?? issue.id} - ${issue.title} (${issue.status})`).join("\n")}`;
  const replyMarkup = listKeyboard(input.kind, input.page, slice, issues.length);
  if (input.editMessageId) {
    await editTelegramMessage(ctx, token, {
      chatId: input.linkedChat.chatId,
      messageId: input.editMessageId,
      text: summary,
      replyMarkup,
    });
    return;
  }
  await sendTelegramMessage(ctx, token, {
    chatId: input.linkedChat.chatId,
    text: summary,
    replyMarkup,
  });
}

async function sendApprovalCard(
  ctx: PluginContext,
  token: string,
  approval: Approval,
  input: {
    linkedChat: TelegramLinkedChat;
    chatId: string;
    listKind: "board" | "mine";
    prefix?: string;
    includeComments?: boolean;
    editMessageId?: number;
    reason: string;
  },
): Promise<void> {
  const text = await renderApprovalMessage(ctx, approval, {
    prefix: input.prefix,
    includeComments: input.includeComments,
    listKind: input.listKind,
  });
  const keyboard = approvalActionKeyboard(approval, input.listKind, input.linkedChat);
  const message = input.editMessageId
    ? await editTelegramMessage(ctx, token, {
      chatId: input.chatId,
      messageId: input.editMessageId,
      text,
      replyMarkup: keyboard,
    })
    : await sendTelegramMessage(ctx, token, {
      chatId: input.chatId,
      text,
      replyMarkup: keyboard,
    });
  await upsertThreadLink(ctx, {
    companyId: approval.companyId,
    resourceType: "approval",
    resourceId: approval.id,
    approvalId: approval.id,
    chatId: String(message.chat.id),
    messageId: message.message_id,
    direction: "outbound",
    linkedAt: new Date().toISOString(),
    reason: input.reason,
  });
}

async function sendApprovalList(
  ctx: PluginContext,
  token: string,
  input: {
    companyId: string;
    linkedChat: TelegramLinkedChat;
    kind: "board" | "mine";
    page: number;
    editMessageId?: number;
  },
): Promise<void> {
  const approvals = await listApprovalsForKind(ctx, input.companyId, input.kind, input.linkedChat);
  const start = Math.max(0, input.page) * LIST_PAGE_SIZE;
  const slice = approvals.slice(start, start + LIST_PAGE_SIZE);
  const header = input.kind === "board" ? "Board approvals" : "My requests";
  const summary = slice.length === 0
    ? `${header}\nNo matching approvals right now.`
    : `${header}\n${slice.map((approval, index) =>
      `${start + index + 1}. ${formatApprovalType(approval.type)} (${approval.status})`,
    ).join("\n")}`;
  const replyMarkup = approvalListKeyboard(input.kind, input.page, slice, approvals.length);
  if (input.editMessageId) {
    await editTelegramMessage(ctx, token, {
      chatId: input.linkedChat.chatId,
      messageId: input.editMessageId,
      text: summary,
      replyMarkup,
    });
    return;
  }
  await sendTelegramMessage(ctx, token, {
    chatId: input.linkedChat.chatId,
    text: summary,
    replyMarkup,
  });
}

async function sendJoinRequestCard(
  ctx: PluginContext,
  token: string,
  request: JoinRequest,
  input: {
    chatId: string;
    prefix?: string;
    editMessageId?: number;
    reason: string;
  },
): Promise<void> {
  const text = renderJoinRequestMessage(request, { prefix: input.prefix });
  const keyboard = joinActionKeyboard(request);
  const message = input.editMessageId
    ? await editTelegramMessage(ctx, token, {
      chatId: input.chatId,
      messageId: input.editMessageId,
      text,
      replyMarkup: keyboard,
    })
    : await sendTelegramMessage(ctx, token, {
      chatId: input.chatId,
      text,
      replyMarkup: keyboard,
    });
  await upsertThreadLink(ctx, {
    companyId: request.companyId,
    resourceType: "join_request",
    resourceId: request.id,
    joinRequestId: request.id,
    chatId: String(message.chat.id),
    messageId: message.message_id,
    direction: "outbound",
    linkedAt: new Date().toISOString(),
    reason: input.reason,
  });
}

async function sendJoinRequestList(
  ctx: PluginContext,
  token: string,
  input: {
    companyId: string;
    linkedChat: TelegramLinkedChat;
    page: number;
    editMessageId?: number;
  },
): Promise<void> {
  const requests = await listJoinRequestsForCompany(ctx, input.companyId);
  const start = Math.max(0, input.page) * LIST_PAGE_SIZE;
  const slice = requests.slice(start, start + LIST_PAGE_SIZE);
  const summary = slice.length === 0
    ? "Pending join requests\nNo pending join requests right now."
    : `Pending join requests\n${slice.map((request, index) =>
      `${start + index + 1}. ${request.requestType === "agent" ? "Agent" : "Human"} join (${request.status})`,
    ).join("\n")}`;
  const replyMarkup = joinListKeyboard(input.page, slice, requests.length);
  if (input.editMessageId) {
    await editTelegramMessage(ctx, token, {
      chatId: input.linkedChat.chatId,
      messageId: input.editMessageId,
      text: summary,
      replyMarkup,
    });
    return;
  }
  await sendTelegramMessage(ctx, token, {
    chatId: input.linkedChat.chatId,
    text: summary,
    replyMarkup,
  });
}

async function sendBudgetIncidentCard(
  ctx: PluginContext,
  token: string,
  incident: BudgetIncident,
  input: {
    chatId: string;
    prefix?: string;
    editMessageId?: number;
    reason: string;
  },
): Promise<void> {
  const text = renderBudgetIncidentMessage(incident, { prefix: input.prefix });
  const keyboard = budgetActionKeyboard(incident);
  const message = input.editMessageId
    ? await editTelegramMessage(ctx, token, {
      chatId: input.chatId,
      messageId: input.editMessageId,
      text,
      replyMarkup: keyboard,
    })
    : await sendTelegramMessage(ctx, token, {
      chatId: input.chatId,
      text,
      replyMarkup: keyboard,
    });
  await upsertThreadLink(ctx, {
    companyId: incident.companyId,
    resourceType: "budget_incident",
    resourceId: incident.id,
    budgetIncidentId: incident.id,
    chatId: String(message.chat.id),
    messageId: message.message_id,
    direction: "outbound",
    linkedAt: new Date().toISOString(),
    reason: input.reason,
  });
}

async function sendBudgetIncidentList(
  ctx: PluginContext,
  token: string,
  input: {
    companyId: string;
    linkedChat: TelegramLinkedChat;
    page: number;
    editMessageId?: number;
  },
): Promise<void> {
  const incidents = await listBudgetIncidentsForCompany(ctx, input.companyId);
  const start = Math.max(0, input.page) * LIST_PAGE_SIZE;
  const slice = incidents.slice(start, start + LIST_PAGE_SIZE);
  const summary = slice.length === 0
    ? "Open budget incidents\nNo open budget incidents right now."
    : `Open budget incidents\n${slice.map((incident, index) =>
      `${start + index + 1}. ${incident.scopeName} (${incident.thresholdType}) ${renderMoney(incident.amountObserved)} / ${renderMoney(incident.amountLimit)}`,
    ).join("\n")}`;
  const replyMarkup = budgetListKeyboard(input.page, slice, incidents.length);
  if (input.editMessageId) {
    await editTelegramMessage(ctx, token, {
      chatId: input.linkedChat.chatId,
      messageId: input.editMessageId,
      text: summary,
      replyMarkup,
    });
    return;
  }
  await sendTelegramMessage(ctx, token, {
    chatId: input.linkedChat.chatId,
    text: summary,
    replyMarkup,
  });
}

async function sendInboxCard(
  ctx: PluginContext,
  token: string,
  input: {
    companyId: string;
    linkedChat: TelegramLinkedChat;
    editMessageId?: number;
  },
): Promise<void> {
  const summary = await buildInboxSummary(ctx, input.companyId, input.linkedChat);
  if (input.editMessageId) {
    await editTelegramMessage(ctx, token, {
      chatId: input.linkedChat.chatId,
      messageId: input.editMessageId,
      text: summary.text,
      replyMarkup: summary.keyboard,
    });
    return;
  }
  await sendTelegramMessage(ctx, token, {
    chatId: input.linkedChat.chatId,
    text: summary.text,
    replyMarkup: summary.keyboard,
  });
}

async function findIssueByReference(
  ctx: PluginContext,
  companyId: string,
  rawReference: string,
): Promise<Issue | null> {
  const reference = rawReference.trim();
  if (!reference) return null;
  const matches = await ctx.issues.list({
    companyId,
    q: reference,
    limit: 25,
    offset: 0,
  });
  const needle = reference.toLowerCase();
  return matches.find((issue) => (issue.identifier ?? "").toLowerCase() === needle)
    ?? matches.find((issue) => issue.id === reference)
    ?? matches[0]
    ?? null;
}

function createTelegramCommentBody(message: TelegramMessage): string {
  const author = getDisplayName(message.from);
  const username = message.from?.username ? ` (@${message.from.username})` : "";
  const text = trimToNull(message.text) ?? trimToNull(message.caption) ?? "";
  return `[Telegram reply from ${author}${username}; telegramUserId=${message.from?.id ?? "unknown"}]\n${text}`;
}

async function handleIssueReply(
  ctx: PluginContext,
  token: string,
  linkedChat: TelegramLinkedChat,
  issue: Issue,
  message: TelegramMessage,
): Promise<void> {
  const commentBody = createTelegramCommentBody(message);
  if (!trimToNull(commentBody)) return;
  await ctx.issues.createComment(issue.id, commentBody, issue.companyId);
  await watchIssueForLinkedChat(ctx, issue, linkedChat);
  if (issue.assigneeAgentId && !isClosedIssue(issue)) {
    try {
      await ctx.agents.invoke(issue.assigneeAgentId, issue.companyId, {
        prompt: "Operator replied in Telegram. Read the latest issue comments and continue.",
        reason: "telegram_reply",
      });
    } catch (error) {
      ctx.logger.warn("Failed to wake assignee after Telegram reply", {
        issueId: issue.id,
        agentId: issue.assigneeAgentId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  await sendTelegramMessage(ctx, token, {
    chatId: linkedChat.chatId,
    text: `Added your reply to ${issue.identifier ?? issue.id}.`,
  });
}

async function handleApprovalReply(
  ctx: PluginContext,
  token: string,
  linkedChat: TelegramLinkedChat,
  approval: Approval,
  message: TelegramMessage,
): Promise<void> {
  const commentBody = createTelegramCommentBody(message);
  if (!trimToNull(commentBody)) return;
  await ctx.approvals.addComment(approval.id, { body: commentBody });
  if (approval.requestedByAgentId && ACTIONABLE_APPROVAL_STATUSES.has(approval.status)) {
    try {
      await ctx.agents.invoke(approval.requestedByAgentId, approval.companyId, {
        prompt: "Operator replied on the approval in Telegram. Read the latest approval comments and continue.",
        reason: "telegram_approval_reply",
      });
    } catch (error) {
      ctx.logger.warn("Failed to wake approval requester after Telegram reply", {
        approvalId: approval.id,
        agentId: approval.requestedByAgentId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  await sendTelegramMessage(ctx, token, {
    chatId: linkedChat.chatId,
    text: `Added your reply to approval ${approval.id}.`,
  });
}

async function handleStartCommand(
  ctx: PluginContext,
  token: string,
  message: TelegramMessage,
  companyRows: PluginCompanySettingsRecord[],
): Promise<void> {
  const chatId = String(message.chat.id);
  const rawText = trimToNull(message.text) ?? "";
  const [, code] = rawText.split(/\s+/, 2);
  if (!code) {
    await sendTelegramMessage(ctx, token, {
      chatId,
      text: "Use /start <code> with a Paperclip-generated link code.",
    });
    return;
  }

  for (const row of companyRows) {
    const claim = await getClaimCodeRecord(ctx, row.companyId, code);
    if (!claim) continue;
    if (claim.consumedAt) {
      await sendTelegramMessage(ctx, token, {
        chatId,
        text: "This Telegram link code has already been used.",
      });
      return;
    }
    if (new Date(claim.expiresAt).getTime() < Date.now()) {
      await sendTelegramMessage(ctx, token, {
        chatId,
        text: "This Telegram link code has expired. Generate a new one in Paperclip.",
      });
      return;
    }

    const linkedChat: TelegramLinkedChat = {
      companyId: row.companyId,
      chatId,
      telegramUserId: message.from?.id ?? message.chat.id,
      username: trimToNull(message.from?.username),
      displayName: getDisplayName(message.from),
      boardUserId: claim.boardUserId,
      linkedAt: new Date().toISOString(),
      revokedAt: null,
    };
    await setLinkedChatForBoardUser(ctx, row.companyId, linkedChat);
    await upsertClaimCode(ctx, {
      ...claim,
      consumedAt: new Date().toISOString(),
    });
    await sendTelegramMessage(ctx, token, {
      chatId,
      text: "Telegram chat linked to your Paperclip company. Try /inbox, /tasks, /blocked, /mine, /approvals, /myapprovals, /joins, /budgets, /channels, /queue, /task PAP-123, or /new.",
    });
    return;
  }

  await sendTelegramMessage(ctx, token, {
    chatId,
    text: "Link code not found. Generate a new Telegram link code in Paperclip settings.",
  });
}

async function handleTaskWizardMessage(
  ctx: PluginContext,
  token: string,
  linkedChat: TelegramLinkedChat,
  message: TelegramMessage,
  wizard: TelegramTaskWizardState,
): Promise<boolean> {
  const text = trimToNull(message.text) ?? trimToNull(message.caption) ?? "";
  if (!text) {
    await sendTelegramMessage(ctx, token, {
      chatId: linkedChat.chatId,
      text: "Send text for the current step or /new to restart the task wizard.",
    });
    return true;
  }

  if (wizard.step === "title") {
    await setWizardState(ctx, linkedChat.companyId, linkedChat.chatId, {
      ...wizard,
      title: text,
      step: "description",
    });
    await sendTelegramMessage(ctx, token, {
      chatId: linkedChat.chatId,
      text: "Description? Send text or type skip.",
    });
    return true;
  }

  if (wizard.step === "description") {
    await setWizardState(ctx, linkedChat.companyId, linkedChat.chatId, {
      ...wizard,
      description: text.toLowerCase() === "skip" ? "" : text,
      step: "project",
    });
    await sendTelegramMessage(ctx, token, {
      chatId: linkedChat.chatId,
      text: "Project? Send project name or identifier, or type skip.",
    });
    return true;
  }

  if (wizard.step === "project") {
    let projectId: string | null = null;
    if (text.toLowerCase() !== "skip") {
      const projects = await ctx.projects.list({ companyId: linkedChat.companyId, limit: 100, offset: 0 });
      const needle = text.toLowerCase();
      const matched = projects.find((project) => project.name.toLowerCase() === needle)
        ?? projects.find((project) => project.name.toLowerCase().includes(needle))
        ?? projects.find((project) => project.id === text);
      projectId = matched?.id ?? null;
    }
    await setWizardState(ctx, linkedChat.companyId, linkedChat.chatId, {
      ...wizard,
      projectId,
      step: "priority",
    });
    await sendTelegramMessage(ctx, token, {
      chatId: linkedChat.chatId,
      text: "Priority? Send low, medium, high, critical, or skip.",
    });
    return true;
  }

  if (wizard.step === "priority") {
    const normalized = text.toLowerCase();
    const priority: Issue["priority"] =
      normalized === "low" || normalized === "medium" || normalized === "high" || normalized === "critical"
        ? normalized
        : wizard.priority;
    const issue = await ctx.issues.create({
      companyId: linkedChat.companyId,
      projectId: wizard.projectId ?? undefined,
      title: wizard.title,
      description: wizard.description || undefined,
      status: "backlog",
      priority,
    });
    await watchIssueForLinkedChat(ctx, issue, linkedChat);
    await setWizardState(ctx, linkedChat.companyId, linkedChat.chatId, null);
    await sendIssueCard(ctx, token, issue, {
      chatId: linkedChat.chatId,
      prefix: "Created task",
      reason: "task_created",
    });
    return true;
  }

  return false;
}

async function handleBudgetWizardMessage(
  ctx: PluginContext,
  token: string,
  linkedChat: TelegramLinkedChat,
  message: TelegramMessage,
  wizard: TelegramBudgetWizardState,
): Promise<boolean> {
  const text = trimToNull(message.text) ?? trimToNull(message.caption) ?? "";
  if (!text) {
    await sendTelegramMessage(ctx, token, {
      chatId: linkedChat.chatId,
      text: "Send the new budget amount in dollars, for example 125.00.",
    });
    return true;
  }
  if (!linkedChat.boardUserId) {
    await setWizardState(ctx, linkedChat.companyId, linkedChat.chatId, null);
    await sendTelegramMessage(ctx, token, {
      chatId: linkedChat.chatId,
      text: "This linked chat has no board user binding, so budget changes must be done in the web UI.",
    });
    return true;
  }
  const nextAmount = parseMoneyToCents(text);
  if (nextAmount === null) {
    await sendTelegramMessage(ctx, token, {
      chatId: linkedChat.chatId,
      text: "Invalid amount. Send a dollar amount like 125.00.",
    });
    return true;
  }
  try {
    const updated = await ctx.budgets.resolveIncident(linkedChat.companyId, wizard.incidentId, {
      action: "raise_budget_and_resume",
      amount: nextAmount,
      decidedByUserId: linkedChat.boardUserId,
    });
    await setWizardState(ctx, linkedChat.companyId, linkedChat.chatId, null);
    await sendBudgetIncidentCard(ctx, token, updated, {
      chatId: linkedChat.chatId,
      prefix: "Budget incident resolved",
      reason: "budget_raise_resume",
    });
  } catch (error) {
    await sendTelegramMessage(ctx, token, {
      chatId: linkedChat.chatId,
      text: error instanceof Error ? error.message : String(error),
    });
  }
  return true;
}

async function handleTaskCommand(
  ctx: PluginContext,
  token: string,
  linkedChat: TelegramLinkedChat,
  command: string,
  args: string,
): Promise<void> {
  if (command === "/help") {
    await sendTelegramMessage(ctx, token, {
      chatId: linkedChat.chatId,
      text: [
        "Paperclip Telegram bot commands:",
        "/inbox - operator inbox summary",
        "/tasks - open tasks",
        "/blocked - blocked tasks",
        "/mine - tasks assigned to you",
        "/approvals - board approval queue",
        "/myapprovals - approvals you requested",
        "/joins - pending join requests",
        "/budgets - open budget incidents",
        "/channels - configured Telegram destinations and sources",
        "/queue - scheduled Telegram publishes",
        "/task PAP-123 - open one task",
        "/new - create a new backlog task",
      ].join("\n"),
    });
    return;
  }

  if (command === "/tasks" || command === "/blocked" || command === "/mine") {
    const kind = command === "/tasks" ? "tasks" : command === "/blocked" ? "blocked" : "mine";
    await sendIssueList(ctx, token, {
      companyId: linkedChat.companyId,
      linkedChat,
      kind,
      page: 0,
    });
    return;
  }

  if (command === "/inbox") {
    await sendInboxCard(ctx, token, {
      companyId: linkedChat.companyId,
      linkedChat,
    });
    return;
  }

  if (command === "/approvals" || command === "/myapprovals") {
    await sendApprovalList(ctx, token, {
      companyId: linkedChat.companyId,
      linkedChat,
      kind: command === "/approvals" ? "board" : "mine",
      page: 0,
    });
    return;
  }

  if (command === "/joins") {
    await sendJoinRequestList(ctx, token, {
      companyId: linkedChat.companyId,
      linkedChat,
      page: 0,
    });
    return;
  }

  if (command === "/budgets") {
    await sendBudgetIncidentList(ctx, token, {
      companyId: linkedChat.companyId,
      linkedChat,
      page: 0,
    });
    return;
  }

  if (command === "/channels") {
    await sendTelegramMessage(ctx, token, {
      chatId: linkedChat.chatId,
      text: await renderChannelsSummary(ctx, linkedChat.companyId),
    });
    return;
  }

  if (command === "/queue") {
    await sendTelegramMessage(ctx, token, {
      chatId: linkedChat.chatId,
      text: await renderPublicationQueueSummary(ctx, linkedChat.companyId),
    });
    return;
  }

  if (command === "/task") {
    const issue = await findIssueByReference(ctx, linkedChat.companyId, args);
    if (!issue) {
      await sendTelegramMessage(ctx, token, {
        chatId: linkedChat.chatId,
        text: "Task not found. Try /tasks or provide an identifier like /task PAP-123.",
      });
      return;
    }
    await watchIssueForLinkedChat(ctx, issue, linkedChat);
    await sendIssueCard(ctx, token, issue, {
      chatId: linkedChat.chatId,
      prefix: "Task details",
      reason: "task_lookup",
    });
    return;
  }

  if (command === "/new") {
    const wizard: TelegramTaskWizardState = {
      kind: "task_create",
      step: "title",
      title: "",
      description: "",
      projectId: null,
      priority: "medium",
      startedAt: new Date().toISOString(),
      boardUserId: linkedChat.boardUserId,
      telegramUserId: linkedChat.telegramUserId,
    };
    await setWizardState(ctx, linkedChat.companyId, linkedChat.chatId, wizard);
    await sendTelegramMessage(ctx, token, {
      chatId: linkedChat.chatId,
      text: "New task wizard started. Send the task title.",
    });
    return;
  }

  await sendTelegramMessage(ctx, token, {
    chatId: linkedChat.chatId,
    text: "Unknown command. Use /help to see available Paperclip Telegram commands.",
  });
}

async function processStatusCallback(
  ctx: PluginContext,
  token: string,
  linkedChat: TelegramLinkedChat,
  issueId: string,
  statusAction: string,
  messageId: number | undefined,
  callbackQueryId: string,
): Promise<void> {
  const issue = await ctx.issues.get(issueId, linkedChat.companyId);
  if (!issue) {
    await answerCallbackQuery(ctx, token, {
      callbackQueryId,
      text: "Issue not found.",
    });
    return;
  }

  const nextStatus: Issue["status"] =
    statusAction === "reopen"
      ? "todo"
      : (statusAction as Issue["status"]);

  try {
    const updated = await ctx.issues.update(issue.id, { status: nextStatus }, linkedChat.companyId);
    await watchIssueForLinkedChat(ctx, updated, linkedChat);
    if (messageId) {
      await sendIssueCard(ctx, token, updated, {
        chatId: linkedChat.chatId,
        editMessageId: messageId,
        prefix: "Task updated",
        reason: "status_update",
      });
    } else {
      await sendIssueCard(ctx, token, updated, {
        chatId: linkedChat.chatId,
        prefix: "Task updated",
        reason: "status_update",
      });
    }
    await answerCallbackQuery(ctx, token, {
      callbackQueryId,
      text: `Issue set to ${updated.status}.`,
    });
  } catch (error) {
    await answerCallbackQuery(ctx, token, {
      callbackQueryId,
      text: error instanceof Error ? error.message : String(error),
    });
  }
}

async function processApprovalDecisionCallback(
  ctx: PluginContext,
  token: string,
  linkedChat: TelegramLinkedChat,
  approvalId: string,
  decision: "approve" | "reject" | "revision" | "resubmit",
  listKind: "board" | "mine",
  messageId: number | undefined,
  callbackQueryId: string,
): Promise<void> {
  if (!linkedChat.boardUserId) {
    await answerCallbackQuery(ctx, token, {
      callbackQueryId,
      text: "This linked chat has no board user binding.",
    });
    return;
  }
  const approval = await ctx.approvals.get(approvalId);
  if (!approval || approval.companyId !== linkedChat.companyId) {
    await answerCallbackQuery(ctx, token, {
      callbackQueryId,
      text: "Approval not found.",
    });
    return;
  }
  try {
    const updated = decision === "approve"
      ? await ctx.approvals.approve(approval.id, { decidedByUserId: linkedChat.boardUserId })
      : decision === "reject"
        ? await ctx.approvals.reject(approval.id, { decidedByUserId: linkedChat.boardUserId })
        : decision === "revision"
          ? await ctx.approvals.requestRevision(approval.id, { decidedByUserId: linkedChat.boardUserId })
          : canResubmitApproval(approval, linkedChat, listKind)
            ? await ctx.approvals.resubmit(approval.id, { payload: approval.payload as Record<string, unknown> })
            : (() => {
              throw new Error("Only your revision-requested approvals can be resubmitted from Telegram.");
            })();
    await sendApprovalCard(ctx, token, updated, {
      linkedChat,
      chatId: linkedChat.chatId,
      listKind,
      editMessageId: messageId,
      prefix: decision === "resubmit" ? "Approval resubmitted" : "Approval updated",
      includeComments: true,
      reason: `approval_${decision}`,
    });
    await answerCallbackQuery(ctx, token, {
      callbackQueryId,
      text: decision === "resubmit" ? "Approval resubmitted." : `Approval set to ${updated.status}.`,
    });
  } catch (error) {
    await answerCallbackQuery(ctx, token, {
      callbackQueryId,
      text: error instanceof Error ? error.message : String(error),
    });
  }
}

async function processJoinDecisionCallback(
  ctx: PluginContext,
  token: string,
  linkedChat: TelegramLinkedChat,
  requestId: string,
  decision: "approve" | "reject",
  messageId: number | undefined,
  callbackQueryId: string,
): Promise<void> {
  if (!linkedChat.boardUserId) {
    await answerCallbackQuery(ctx, token, {
      callbackQueryId,
      text: "This linked chat has no board user binding.",
    });
    return;
  }
  try {
    const updated = decision === "approve"
      ? await ctx.joinRequests.approve(linkedChat.companyId, requestId, { decidedByUserId: linkedChat.boardUserId })
      : await ctx.joinRequests.reject(linkedChat.companyId, requestId, { decidedByUserId: linkedChat.boardUserId });
    await sendJoinRequestCard(ctx, token, updated, {
      chatId: linkedChat.chatId,
      editMessageId: messageId,
      prefix: "Join request updated",
      reason: `join_${decision}`,
    });
    await answerCallbackQuery(ctx, token, {
      callbackQueryId,
      text: `Join request ${updated.status}.`,
    });
  } catch (error) {
    await answerCallbackQuery(ctx, token, {
      callbackQueryId,
      text: error instanceof Error ? error.message : String(error),
    });
  }
}

async function processBudgetDecisionCallback(
  ctx: PluginContext,
  token: string,
  linkedChat: TelegramLinkedChat,
  incidentId: string,
  decision: "keep_paused" | "raise",
  messageId: number | undefined,
  callbackQueryId: string,
): Promise<void> {
  if (!linkedChat.boardUserId) {
    await answerCallbackQuery(ctx, token, {
      callbackQueryId,
      text: "This linked chat has no board user binding.",
    });
    return;
  }
  try {
    if (decision === "raise") {
      await setWizardState(ctx, linkedChat.companyId, linkedChat.chatId, {
        kind: "budget_raise_amount",
        incidentId,
        companyId: linkedChat.companyId,
        chatId: linkedChat.chatId,
        boardUserId: linkedChat.boardUserId,
        telegramUserId: linkedChat.telegramUserId,
        startedAt: new Date().toISOString(),
      });
      await answerCallbackQuery(ctx, token, {
        callbackQueryId,
        text: "Send the new budget amount in dollars.",
      });
      await sendTelegramMessage(ctx, token, {
        chatId: linkedChat.chatId,
        text: "Send the new budget amount in dollars, for example 125.00.",
      });
      return;
    }
    const updated = await ctx.budgets.resolveIncident(linkedChat.companyId, incidentId, {
      action: "keep_paused",
      decidedByUserId: linkedChat.boardUserId,
    });
    await setWizardState(ctx, linkedChat.companyId, linkedChat.chatId, null);
    await sendBudgetIncidentCard(ctx, token, updated, {
      chatId: linkedChat.chatId,
      editMessageId: messageId,
      prefix: "Budget incident updated",
      reason: "budget_keep_paused",
    });
    await answerCallbackQuery(ctx, token, {
      callbackQueryId,
      text: "Budget incident kept paused.",
    });
  } catch (error) {
    await answerCallbackQuery(ctx, token, {
      callbackQueryId,
      text: error instanceof Error ? error.message : String(error),
    });
  }
}

async function handleCallbackQuery(
  ctx: PluginContext,
  token: string,
  linkedChat: TelegramLinkedChat,
  query: TelegramCallbackQuery,
): Promise<void> {
  const data = trimToNull(query.data) ?? "";
  const parts = data.split(":");
  const kind = parts[0] ?? "";
  const messageId = query.message?.message_id;

  if (kind === CALLBACK_PREFIX.list) {
    const listKind = parts[1] as "tasks" | "blocked" | "mine" | "review";
    const page = Number(parts[2] ?? 0);
    await sendIssueList(ctx, token, {
      companyId: linkedChat.companyId,
      linkedChat,
      kind: listKind,
      page: Number.isFinite(page) ? Math.max(0, Math.floor(page)) : 0,
      editMessageId: messageId,
    });
    await answerCallbackQuery(ctx, token, { callbackQueryId: query.id });
    return;
  }

  if (kind === CALLBACK_PREFIX.view) {
    const issueId = parts[1] ?? "";
    const issue = await ctx.issues.get(issueId, linkedChat.companyId);
    if (!issue) {
      await answerCallbackQuery(ctx, token, {
        callbackQueryId: query.id,
        text: "Issue not found.",
      });
      return;
    }
    await watchIssueForLinkedChat(ctx, issue, linkedChat);
    await sendIssueCard(ctx, token, issue, {
      chatId: linkedChat.chatId,
      editMessageId: messageId,
      prefix: "Task details",
      reason: "task_view",
    });
    await answerCallbackQuery(ctx, token, { callbackQueryId: query.id });
    return;
  }

  if (kind === CALLBACK_PREFIX.refresh) {
    const issueId = parts[1] ?? "";
    const issue = await ctx.issues.get(issueId, linkedChat.companyId);
    if (!issue) {
      await answerCallbackQuery(ctx, token, {
        callbackQueryId: query.id,
        text: "Issue not found.",
      });
      return;
    }
    await sendIssueCard(ctx, token, issue, {
      chatId: linkedChat.chatId,
      editMessageId: messageId,
      prefix: "Task details",
      reason: "task_refresh",
    });
    await answerCallbackQuery(ctx, token, { callbackQueryId: query.id });
    return;
  }

  if (kind === CALLBACK_PREFIX.status) {
    const issueId = parts[1] ?? "";
    const statusAction = parts[2] ?? "";
    await processStatusCallback(ctx, token, linkedChat, issueId, statusAction, messageId, query.id);
    return;
  }

  if (kind === CALLBACK_PREFIX.approvalList) {
    const listKind = (parts[1] ?? "board") as "board" | "mine";
    const page = Number(parts[2] ?? 0);
    await sendApprovalList(ctx, token, {
      companyId: linkedChat.companyId,
      linkedChat,
      kind: listKind,
      page: Number.isFinite(page) ? Math.max(0, Math.floor(page)) : 0,
      editMessageId: messageId,
    });
    await answerCallbackQuery(ctx, token, { callbackQueryId: query.id });
    return;
  }

  if (kind === CALLBACK_PREFIX.approvalView || kind === CALLBACK_PREFIX.approvalRefresh || kind === CALLBACK_PREFIX.approvalComments) {
    const approvalId = parts[1] ?? "";
    const listKind = (parts[2] ?? "board") as "board" | "mine";
    const approval = await ctx.approvals.get(approvalId);
    if (!approval || approval.companyId !== linkedChat.companyId) {
      await answerCallbackQuery(ctx, token, {
        callbackQueryId: query.id,
        text: "Approval not found.",
      });
      return;
    }
    await sendApprovalCard(ctx, token, approval, {
      linkedChat,
      chatId: linkedChat.chatId,
      listKind,
      editMessageId: messageId,
      prefix: kind === CALLBACK_PREFIX.approvalComments ? "Approval comments" : "Approval details",
      includeComments: kind === CALLBACK_PREFIX.approvalComments,
      reason: kind,
    });
    await answerCallbackQuery(ctx, token, { callbackQueryId: query.id });
    return;
  }

  if (kind === CALLBACK_PREFIX.approvalDecision) {
    const approvalId = parts[1] ?? "";
    const decision = (parts[2] ?? "") as "approve" | "reject" | "revision" | "resubmit";
    const listKind = (parts[3] ?? "board") as "board" | "mine";
    await processApprovalDecisionCallback(
      ctx,
      token,
      linkedChat,
      approvalId,
      decision,
      listKind,
      messageId,
      query.id,
    );
    return;
  }

  if (kind === CALLBACK_PREFIX.inbox) {
    await sendInboxCard(ctx, token, {
      companyId: linkedChat.companyId,
      linkedChat,
      editMessageId: messageId,
    });
    await answerCallbackQuery(ctx, token, { callbackQueryId: query.id });
    return;
  }

  if (kind === CALLBACK_PREFIX.joinList) {
    const page = Number(parts[1] ?? 0);
    await sendJoinRequestList(ctx, token, {
      companyId: linkedChat.companyId,
      linkedChat,
      page: Number.isFinite(page) ? Math.max(0, Math.floor(page)) : 0,
      editMessageId: messageId,
    });
    await answerCallbackQuery(ctx, token, { callbackQueryId: query.id });
    return;
  }

  if (kind === CALLBACK_PREFIX.joinView || kind === CALLBACK_PREFIX.joinRefresh) {
    const requestId = parts[1] ?? "";
    const request = (await ctx.joinRequests.list(linkedChat.companyId))
      .find((entry) => entry.id === requestId) ?? null;
    if (!request) {
      await answerCallbackQuery(ctx, token, {
        callbackQueryId: query.id,
        text: "Join request not found.",
      });
      return;
    }
    await sendJoinRequestCard(ctx, token, request, {
      chatId: linkedChat.chatId,
      editMessageId: messageId,
      prefix: "Join request details",
      reason: kind,
    });
    await answerCallbackQuery(ctx, token, { callbackQueryId: query.id });
    return;
  }

  if (kind === CALLBACK_PREFIX.joinDecision) {
    const requestId = parts[1] ?? "";
    const decision = (parts[2] ?? "") as "approve" | "reject";
    await processJoinDecisionCallback(ctx, token, linkedChat, requestId, decision, messageId, query.id);
    return;
  }

  if (kind === CALLBACK_PREFIX.budgetList) {
    const page = Number(parts[1] ?? 0);
    await sendBudgetIncidentList(ctx, token, {
      companyId: linkedChat.companyId,
      linkedChat,
      page: Number.isFinite(page) ? Math.max(0, Math.floor(page)) : 0,
      editMessageId: messageId,
    });
    await answerCallbackQuery(ctx, token, { callbackQueryId: query.id });
    return;
  }

  if (kind === CALLBACK_PREFIX.budgetView || kind === CALLBACK_PREFIX.budgetRefresh) {
    const incidentId = parts[1] ?? "";
    const incident = (await listBudgetIncidentsForCompany(ctx, linkedChat.companyId))
      .find((entry) => entry.id === incidentId) ?? null;
    if (!incident) {
      await answerCallbackQuery(ctx, token, {
        callbackQueryId: query.id,
        text: "Budget incident not found.",
      });
      return;
    }
    await sendBudgetIncidentCard(ctx, token, incident, {
      chatId: linkedChat.chatId,
      editMessageId: messageId,
      prefix: "Budget incident details",
      reason: kind,
    });
    await answerCallbackQuery(ctx, token, { callbackQueryId: query.id });
    return;
  }

  if (kind === CALLBACK_PREFIX.budgetDecision) {
    const incidentId = parts[1] ?? "";
    const decision = (parts[2] ?? "") as "keep_paused" | "raise";
    await processBudgetDecisionCallback(ctx, token, linkedChat, incidentId, decision, messageId, query.id);
    return;
  }

  await answerCallbackQuery(ctx, token, {
    callbackQueryId: query.id,
    text: "Unsupported action.",
  });
}

async function handlePrivateMessage(
  ctx: PluginContext,
  token: string,
  effective: EffectiveCompanySettings,
  linkedChat: TelegramLinkedChat | null,
  message: TelegramMessage,
  companyRows: PluginCompanySettingsRecord[],
): Promise<void> {
  const rawText = trimToNull(message.text) ?? trimToNull(message.caption) ?? "";
  const chatId = String(message.chat.id);

  if (rawText.startsWith("/start")) {
    await handleStartCommand(ctx, token, message, companyRows);
    return;
  }

  if (!linkedChat) {
    await sendTelegramMessage(ctx, token, {
      chatId,
      text: "This chat is not linked to a Paperclip company yet. Generate a Telegram link code in Paperclip settings and use /start <code>.",
    });
    return;
  }

  if (message.reply_to_message?.message_id) {
    const threadLink = await getThreadLinkByReply(ctx, linkedChat.chatId, message.reply_to_message.message_id);
    if (threadLink) {
      if ((threadLink.resourceType ?? "issue") === "approval") {
        const approvalId = threadLink.approvalId ?? threadLink.resourceId ?? null;
        const approval = approvalId ? await ctx.approvals.get(approvalId) : null;
        if (approval && approval.companyId === linkedChat.companyId) {
          await handleApprovalReply(ctx, token, linkedChat, approval, message);
          return;
        }
      } else if (threadLink.resourceType === "join_request") {
        await sendTelegramMessage(ctx, token, {
          chatId,
          text: "Join request cards only support inline approve/reject actions right now. Use the buttons or the web UI.",
        });
        return;
      } else if (threadLink.resourceType === "budget_incident") {
        await sendTelegramMessage(ctx, token, {
          chatId,
          text: "Budget incident cards use inline actions. Use Keep paused or Raise budget & resume.",
        });
        return;
      }
      const issueId = threadLink.issueId ?? threadLink.resourceId ?? null;
      const issue = issueId ? await ctx.issues.get(issueId, linkedChat.companyId) : null;
      if (issue) {
        await handleIssueReply(ctx, token, linkedChat, issue, message);
        return;
      }
    }
  }

  const wizard = await getWizardState(ctx, linkedChat.companyId, linkedChat.chatId);
  if (wizard) {
    const consumed = wizard.kind === "budget_raise_amount"
      ? await handleBudgetWizardMessage(ctx, token, linkedChat, message, wizard)
      : await handleTaskWizardMessage(ctx, token, linkedChat, message, wizard);
    if (consumed) return;
  }

  if (rawText.startsWith("/")) {
    const [command, ...rest] = rawText.split(/\s+/);
    await handleTaskCommand(ctx, token, linkedChat, command.toLowerCase(), rest.join(" "));
    return;
  }

  await sendTelegramMessage(ctx, token, {
    chatId,
    text: [
      "Paperclip Telegram bot is ready.",
      "Use /inbox, /tasks, /blocked, /mine, /approvals, /myapprovals, /joins, /budgets, /channels, /queue, /task PAP-123, or /new.",
      effective.settings.taskBot.enabled
        ? "Replies to task and approval cards become comments in Paperclip."
        : "Task bot is configured in read-only mode right now.",
    ].join("\n"),
  });
}

async function handleUpdate(
  ctx: PluginContext,
  token: string,
  effective: EffectiveCompanySettings,
  update: TelegramUpdate,
  companyRows: PluginCompanySettingsRecord[],
): Promise<void> {
  const inboundSourceMessage = update.channel_post ?? update.edited_channel_post
    ?? (update.message && update.message.chat.type !== "private" ? update.message : undefined)
    ?? (update.edited_message && update.edited_message.chat.type !== "private" ? update.edited_message : undefined);
  if (inboundSourceMessage) {
    const consumed = await ingestConfiguredSourceUpdate(ctx, effective, inboundSourceMessage);
    if (consumed) return;
  }

  const message = update.message ?? update.edited_message;
  const callbackQuery = update.callback_query;

  if (message) {
    if (message.chat.type !== "private") return;
    const chatId = String(message.chat.id);
    const linkedChats = getActiveLinkedChats(await listLinkedChats(ctx, effective.companyId));
    const linkedChat = linkedChats.find((entry) => entry.chatId === chatId) ?? null;
    await handlePrivateMessage(ctx, token, effective, linkedChat, message, companyRows);
    return;
  }

  const callbackMessage = callbackQuery?.message;
  if (callbackQuery && callbackMessage) {
    if (callbackMessage.chat.type !== "private") return;
    const linkedChats = getActiveLinkedChats(await listLinkedChats(ctx, effective.companyId));
    const linkedChat = linkedChats.find((entry) => entry.chatId === String(callbackMessage.chat.id)) ?? null;
    if (!linkedChat) {
      await answerCallbackQuery(ctx, token, {
        callbackQueryId: callbackQuery.id,
        text: "This chat is no longer linked.",
      });
      return;
    }
    await handleCallbackQuery(ctx, token, linkedChat, callbackQuery);
  }
}

async function reconcileNotifications(
  ctx: PluginContext,
  token: string,
  effective: EffectiveCompanySettings,
  health: TelegramBotHealth,
): Promise<TelegramBotHealth> {
  const companyId = effective.companyId;
  const linkedChats = getActiveLinkedChats(await listLinkedChats(ctx, companyId));
  const boardChats = linkedChats.filter((chat) => Boolean(chat.boardUserId));
  const [allApprovals, joinRequests, budgetOverview] = await Promise.all([
    ctx.approvals.list(companyId),
    ctx.joinRequests.list(companyId, { status: "pending_approval" }),
    ctx.budgets.overview(companyId),
  ]);
  const openApprovalCount = allApprovals.filter((approval) => ACTIONABLE_APPROVAL_STATUSES.has(approval.status)).length;
  const revisionApprovalCount = allApprovals.filter((approval) => approval.status === "revision_requested").length;
  const openJoinRequestCount = joinRequests.length;
  const openBudgetIncidentCount = budgetOverview.activeIncidents.filter((incident) => incident.status === "open").length;
  if (linkedChats.length === 0) {
    return {
      ...health,
      lastActivityCursor: health.lastActivityCursor ?? new Date().toISOString(),
      openApprovalCount,
      revisionApprovalCount,
      openJoinRequestCount,
      openBudgetIncidentCount,
    };
  }

  if (!health.lastActivityCursor) {
    return {
      ...health,
      lastActivityCursor: new Date().toISOString(),
      openApprovalCount,
      revisionApprovalCount,
      openJoinRequestCount,
      openBudgetIncidentCount,
    };
  }

  const issueActivities = await ctx.activity.list({
    companyId,
    sinceCreatedAt: health.lastActivityCursor,
    entityType: "issue",
    actions: ["issue.updated"],
    limit: 200,
  });
  const approvalActivities = await ctx.activity.list({
    companyId,
    sinceCreatedAt: health.lastActivityCursor,
    entityType: "approval",
    actions: [
      "approval.created",
      "approval.approved",
      "approval.rejected",
      "approval.revision_requested",
      "approval.resubmitted",
    ],
    limit: 200,
  });
  const joinActivities = await ctx.activity.list({
    companyId,
    sinceCreatedAt: health.lastActivityCursor,
    entityType: "join_request",
    actions: ["join.requested", "join.approved", "join.rejected"],
    limit: 200,
  });
  const budgetActivities = await ctx.activity.list({
    companyId,
    sinceCreatedAt: health.lastActivityCursor,
    entityType: "budget_incident",
    actions: [
      "budget.soft_threshold_crossed",
      "budget.hard_threshold_crossed",
      "budget.incident_resolved",
    ],
    limit: 200,
  });

  const sorted = [...issueActivities, ...approvalActivities, ...joinActivities, ...budgetActivities]
    .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime());
  let lastCursor = health.lastActivityCursor;
  let lastNotificationAt = health.lastNotificationAt;
  let lastApprovalNotificationAt = health.lastApprovalNotificationAt;
  let lastControlPlaneNotificationAt = health.lastControlPlaneNotificationAt;

  for (const activity of sorted) {
    if (activity.entityType === "approval") {
      const sentKey = `${STATE_KEYS.notificationSentPrefix}:${activity.id}`;
      const alreadySent = await getCompanyState<boolean>(ctx, companyId, sentKey);
      if (alreadySent) {
        lastCursor = activity.createdAt.toISOString();
        continue;
      }

      const approval = await ctx.approvals.get(activity.entityId);
      if (!approval) {
        lastCursor = activity.createdAt.toISOString();
        await setCompanyState(ctx, companyId, sentKey, true);
        continue;
      }

      const recipients = new Map<string, TelegramLinkedChat>();
      const requesterChats = approval.requestedByUserId
        ? boardChats.filter((chat) => chat.boardUserId === approval.requestedByUserId)
        : [];
      if (
        activity.action === "approval.created"
        || activity.action === "approval.resubmitted"
        || activity.action === "approval.revision_requested"
      ) {
        for (const linked of boardChats) recipients.set(linked.chatId, linked);
        for (const linked of requesterChats) recipients.set(linked.chatId, linked);
      } else if (activity.action === "approval.approved" || activity.action === "approval.rejected") {
        for (const linked of requesterChats) recipients.set(linked.chatId, linked);
        if (recipients.size === 0 && effective.settings.taskBot.notificationMode === "fallback_all_linked") {
          for (const linked of boardChats) recipients.set(linked.chatId, linked);
        }
      }

      for (const recipient of recipients.values()) {
        const listKind: "board" | "mine" = recipient.boardUserId && recipient.boardUserId === approval.requestedByUserId
          ? "mine"
          : "board";
        const prefix = activity.action === "approval.approved"
          ? "Approval approved"
          : activity.action === "approval.rejected"
            ? "Approval rejected"
            : listKind === "mine"
              ? "My request updated"
              : "Board approval queue";
        await sendApprovalCard(ctx, token, approval, {
          linkedChat: recipient,
          chatId: recipient.chatId,
          listKind,
          prefix,
          reason: `notification:${activity.action}`,
        });
      }
      await setCompanyState(ctx, companyId, sentKey, true);
      lastCursor = activity.createdAt.toISOString();
      if (recipients.size > 0) {
        lastApprovalNotificationAt = new Date().toISOString();
        lastControlPlaneNotificationAt = lastApprovalNotificationAt;
      }
      continue;
    }

    if (activity.entityType === "join_request") {
      const sentKey = `${STATE_KEYS.notificationSentPrefix}:${activity.id}`;
      const alreadySent = await getCompanyState<boolean>(ctx, companyId, sentKey);
      if (alreadySent) {
        lastCursor = activity.createdAt.toISOString();
        continue;
      }
      const request = (await ctx.joinRequests.list(companyId))
        .find((entry) => entry.id === activity.entityId) ?? null;
      if (!request) {
        lastCursor = activity.createdAt.toISOString();
        await setCompanyState(ctx, companyId, sentKey, true);
        continue;
      }
      const prefix = activity.action === "join.approved"
        ? "Join request approved"
        : activity.action === "join.rejected"
          ? "Join request rejected"
          : "New join request";
      for (const recipient of boardChats) {
        await sendJoinRequestCard(ctx, token, request, {
          chatId: recipient.chatId,
          prefix,
          reason: `notification:${activity.action}`,
        });
      }
      await setCompanyState(ctx, companyId, sentKey, true);
      lastCursor = activity.createdAt.toISOString();
      if (boardChats.length > 0) {
        lastControlPlaneNotificationAt = new Date().toISOString();
      }
      continue;
    }

    if (activity.entityType === "budget_incident") {
      const sentKey = `${STATE_KEYS.notificationSentPrefix}:${activity.id}`;
      const alreadySent = await getCompanyState<boolean>(ctx, companyId, sentKey);
      if (alreadySent) {
        lastCursor = activity.createdAt.toISOString();
        continue;
      }
      const currentOverview = await ctx.budgets.overview(companyId);
      const incident = currentOverview.activeIncidents.find((entry) => entry.id === activity.entityId) ?? null;
      const prefix = activity.action === "budget.incident_resolved"
        ? "Budget incident resolved"
        : "Budget alert";
      for (const recipient of boardChats) {
        if (incident) {
          await sendBudgetIncidentCard(ctx, token, incident, {
            chatId: recipient.chatId,
            prefix,
            reason: `notification:${activity.action}`,
          });
        } else {
          await sendTelegramMessage(ctx, token, {
            chatId: recipient.chatId,
            text: `${prefix}\n${activity.entityId}\nAction: ${activity.action}`,
          });
        }
      }
      await setCompanyState(ctx, companyId, sentKey, true);
      lastCursor = activity.createdAt.toISOString();
      if (boardChats.length > 0) {
        lastControlPlaneNotificationAt = new Date().toISOString();
      }
      continue;
    }

    const details = (activity.details ?? {}) as Record<string, unknown>;
    const nextStatus = trimToNull(details.status);
    if (nextStatus !== "blocked" && nextStatus !== "done" && nextStatus !== "in_review") {
      lastCursor = activity.createdAt.toISOString();
      continue;
    }

    const sentKey = `${STATE_KEYS.notificationSentPrefix}:${activity.id}`;
    const alreadySent = await getCompanyState<boolean>(ctx, companyId, sentKey);
    if (alreadySent) {
      lastCursor = activity.createdAt.toISOString();
      continue;
    }

    const issue = await ctx.issues.get(activity.entityId, companyId);
    if (!issue) {
      lastCursor = activity.createdAt.toISOString();
      await setCompanyState(ctx, companyId, sentKey, true);
      continue;
    }

    const recipients = new Map<string, TelegramLinkedChat>();
    if (nextStatus === "blocked" || nextStatus === "done") {
      const watchers = await listIssueWatchers(ctx, issue.id);
      for (const watcher of watchers) {
        const linked = linkedChats.find((chat) => chat.chatId === watcher.chatId);
        if (linked) recipients.set(linked.chatId, linked);
      }
      if (issue.assigneeUserId) {
        for (const linked of linkedChats.filter((chat) => chat.boardUserId === issue.assigneeUserId)) {
          recipients.set(linked.chatId, linked);
        }
      }
    }
    if (nextStatus === "in_review" && issue.reviewerUserId) {
      for (const linked of linkedChats.filter((chat) => chat.boardUserId === issue.reviewerUserId)) {
        recipients.set(linked.chatId, linked);
      }
    }
    if (recipients.size === 0 && effective.settings.taskBot.notificationMode === "fallback_all_linked") {
      for (const linked of linkedChats) recipients.set(linked.chatId, linked);
    }

    for (const recipient of recipients.values()) {
      const prefix = nextStatus === "blocked"
        ? "Issue blocked"
        : nextStatus === "done"
          ? "Issue done"
          : "Issue ready for review";
      await sendIssueCard(ctx, token, issue, {
        chatId: recipient.chatId,
        prefix,
        reason: `notification:${nextStatus}`,
      });
    }
    await setCompanyState(ctx, companyId, sentKey, true);
    lastCursor = activity.createdAt.toISOString();
    if (recipients.size > 0) {
      lastNotificationAt = new Date().toISOString();
    }
  }

  return {
    ...health,
    lastActivityCursor: lastCursor,
    lastNotificationAt,
    lastApprovalNotificationAt,
    lastControlPlaneNotificationAt,
    openApprovalCount,
    revisionApprovalCount,
    openJoinRequestCount,
    openBudgetIncidentCount,
  };
}

async function syncTelegramForCompany(
  ctx: PluginContext,
  row: PluginCompanySettingsRecord,
  allCompanyRows: PluginCompanySettingsRecord[],
): Promise<void> {
  const effective = await getEffectiveCompanySettings(ctx, row.companyId);
  const previousHealth = getBotHealthDefaults(await getBotHealth(ctx, row.companyId));
  const healthBase = {
    ...previousHealth,
    checkedAt: new Date().toISOString(),
    error: null,
  };

  try {
    const token = await resolveBotTokenForSettings(ctx, effective.settings);
    const updates = await telegramRequest<TelegramUpdate[]>(ctx, token, "getUpdates", {
      offset: previousHealth.lastUpdateId != null ? previousHealth.lastUpdateId + 1 : undefined,
      allowed_updates: ["message", "edited_message", "callback_query", "channel_post", "edited_channel_post"],
      timeout: 0,
    });

    const orderedUpdates = [...updates].sort((left, right) => left.update_id - right.update_id);
    let maxUpdateId = previousHealth.lastUpdateId;
    for (const update of orderedUpdates) {
      await handleUpdate(ctx, token, effective, update, allCompanyRows);
      maxUpdateId = Math.max(maxUpdateId ?? update.update_id, update.update_id);
    }

    let nextHealth: TelegramBotHealth = {
      ...healthBase,
      ok: true,
      lastUpdateId: maxUpdateId ?? previousHealth.lastUpdateId,
      lastActivityCursor: previousHealth.lastActivityCursor,
      lastNotificationAt: previousHealth.lastNotificationAt,
      error: null,
    };
    nextHealth = await reconcileNotifications(ctx, token, effective, nextHealth);
    await setBotHealth(ctx, row.companyId, nextHealth);
    await ctx.metrics.write("telegram.sync", 1, {
      companyId: row.companyId,
      updates: String(orderedUpdates.length),
      notifications: nextHealth.lastNotificationAt ? "yes" : "no",
    });
  } catch (error) {
    const failedHealth: TelegramBotHealth = {
      ...healthBase,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
    await setBotHealth(ctx, row.companyId, failedHealth);
    ctx.logger.error("Telegram sync failed", {
      companyId: row.companyId,
      error: failedHealth.error,
    });
  }
}

async function buildOverview(ctx: PluginContext, companyId: string): Promise<TelegramOverview> {
  const effective = await getEffectiveCompanySettings(ctx, companyId);
  const [lastValidation, lastPublication, recentPublications, linkedChats, rawBotHealth, issues, approvals, joinRequests, budgetOverview, scheduledPublications, recentIngestedStories] = await Promise.all([
    getCompanyState<Record<string, unknown>>(ctx, companyId, STATE_KEYS.lastValidation),
    getCompanyState<TelegramPublication>(ctx, companyId, STATE_KEYS.lastPublication),
    listRecentPublications(ctx, companyId),
    listLinkedChats(ctx, companyId),
    getBotHealth(ctx, companyId),
    ctx.issues.list({ companyId, limit: 500, offset: 0 }),
    ctx.approvals.list(companyId),
    ctx.joinRequests.list(companyId, { status: "pending_approval" }),
    ctx.budgets.overview(companyId),
    listPublicationJobs(ctx, companyId, { limit: 50 }),
    listRecentSourceMessages(ctx, companyId, 25),
  ]);
  const activeLinkedChats = getActiveLinkedChats(linkedChats);
  const actionableApprovalCount = approvals.filter((approval) => ACTIONABLE_APPROVAL_STATUSES.has(approval.status)).length;
  const reviewTaskCount = issues.filter((issue) => issue.status === "in_review").length;
  const myRequests = approvals.filter((approval) =>
    activeLinkedChats.some((chat) => chat.boardUserId && chat.boardUserId === approval.requestedByUserId),
  );
  const myPendingApprovalCount = myRequests.filter((approval) => approval.status === "pending").length;
  const myRevisionApprovalCount = myRequests.filter((approval) => approval.status === "revision_requested").length;
  const destinations = getConfiguredDestinations(effective.settings);
  const sources = getConfiguredSources(effective.settings);
  const scheduledPublishCount = scheduledPublications.filter((job) => isQueuedPublicationStatus(job.status)).length;
  const failedPublishCount = scheduledPublications.filter((job) => job.status === "failed").length;
  const ingestedStoryCount = recentIngestedStories.length;
  const defaultDestination = getDefaultDestination(effective.settings);
  const botHealth = rawBotHealth
    ? {
      ...rawBotHealth,
      scheduledPublishCount,
      failedPublishCount,
      ingestedStoryCount,
      lastIngestionAt: rawBotHealth.lastIngestionAt ?? recentIngestedStories[0]?.linkedAt ?? null,
    }
    : null;

  const configured = Boolean(
    trimToNull(effective.settings.publishing.botTokenSecretRef)
    && (
      trimToNull(effective.settings.publishing.defaultChatId)
      || defaultDestination
    ),
  );

  return {
    configured,
    config: {
      defaultChatId: trimToNull(defaultDestination?.chatId) ?? trimToNull(effective.settings.publishing.defaultChatId),
      defaultPublicHandle: sanitizePublicHandle(defaultDestination?.publicHandle) ?? sanitizePublicHandle(effective.settings.publishing.defaultPublicHandle),
      defaultParseMode: trimToNull(defaultDestination?.parseMode) ?? trimToNull(effective.settings.publishing.defaultParseMode),
      defaultDisableLinkPreview: defaultDestination?.disableLinkPreview ?? effective.settings.publishing.defaultDisableLinkPreview === true,
      defaultDisableNotification: defaultDestination?.disableNotification ?? effective.settings.publishing.defaultDisableNotification === true,
    },
    companySettings: effective.settings,
    legacyConfigDetected: effective.legacyConfigDetected,
    destinations,
    sources,
    linkedChats,
    botHealth,
    lastValidation: lastValidation as TelegramOverview["lastValidation"],
    lastPublication,
    recentPublications,
    scheduledPublications,
    recentIngestedStories,
    blockedTaskCount: issues.filter((issue) => issue.status === "blocked").length,
    openTaskCount: issues.filter((issue) => OPEN_ISSUE_STATUSES.has(issue.status)).length,
    reviewTaskCount,
    approvalsInboxEnabled: effective.settings.taskBot.enabled,
    actionableApprovalCount,
    myPendingApprovalCount,
    myRevisionApprovalCount,
    pendingJoinRequestCount: joinRequests.length,
    openBudgetIncidentCount: budgetOverview.activeIncidents.filter((incident) => incident.status === "open").length,
    scheduledPublishCount,
    failedPublishCount,
    ingestedStoryCount,
  };
}

async function publishTelegramMessage(
  ctx: PluginContext,
  companyId: string,
  params: Record<string, unknown>,
): Promise<TelegramPublication> {
  const issueId = trimToNull(params.issueId);
  const issueIdentifier = trimToNull(params.issueIdentifier);
  const issueTitle = trimToNull(params.issueTitle);
  const approvalId = trimToNull(params.approvalId);
  const text = asString(params.text).trim();
  if (!text) {
    throw new Error("Message text is required");
  }
  if (text.length > TELEGRAM_MAX_MESSAGE_LENGTH) {
    throw new Error(`Telegram messages must be ${TELEGRAM_MAX_MESSAGE_LENGTH} characters or fewer`);
  }

  const effective = await getEffectiveCompanySettings(ctx, companyId);
  const token = await resolveBotTokenForSettings(ctx, effective.settings);
  const requestedDestinationId = trimToNull(params.destinationId);
  const explicitDestination = requestedDestinationId
    ? findDestinationById(effective.settings, requestedDestinationId)
    : null;
  if (requestedDestinationId && !explicitDestination) {
    throw new Error(`Configured Telegram destination "${requestedDestinationId}" no longer exists.`);
  }
  if (explicitDestination && !explicitDestination.enabled) {
    throw new Error(`Configured Telegram destination "${explicitDestination.label}" is disabled.`);
  }
  const destination = explicitDestination ?? resolveDestinationForParams(effective.settings, params);
  const publishing = effective.settings.publishing;
  const chatId = trimToNull(params.chatId) ?? trimToNull(destination?.chatId) ?? trimToNull(publishing.defaultChatId);
  if (!chatId) {
    throw new Error("Target chat_id is required");
  }
  const parseMode = trimToNull(params.parseMode)
    ?? trimToNull(destination?.parseMode)
    ?? trimToNull(publishing.defaultParseMode);
  const disableNotification = typeof params.disableNotification === "boolean"
    ? params.disableNotification
    : destination?.disableNotification === true || publishing.defaultDisableNotification === true;
  const disableLinkPreview = typeof params.disableLinkPreview === "boolean"
    ? params.disableLinkPreview
    : destination?.disableLinkPreview === true || publishing.defaultDisableLinkPreview === true;
  const publicHandle = sanitizePublicHandle(trimToNull(params.publicHandle))
    ?? sanitizePublicHandle(destination?.publicHandle)
    ?? sanitizePublicHandle(publishing.defaultPublicHandle)
    ?? sanitizePublicHandle(chatId);

  const message = await telegramRequest<TelegramMessage>(ctx, token, "sendMessage", {
    chat_id: chatId,
    text,
    ...(parseMode ? { parse_mode: parseMode } : {}),
    ...(disableNotification ? { disable_notification: true } : {}),
    ...(disableLinkPreview ? { link_preview_options: { is_disabled: true } } : {}),
  });

  const sentAt = new Date((message.date ?? Math.floor(Date.now() / 1000)) * 1000).toISOString();
  const destinationLabel = trimToNull(params.destinationLabel)
    ?? trimToNull(destination?.label)
    ?? (publicHandle ? `@${publicHandle}` : null)
    ?? trimToNull(message.chat.title)
    ?? chatId;
  const publicationRecord: TelegramPublication = {
    externalId: `${message.chat.id}:${message.message_id}`,
    issueId,
    issueIdentifier,
    issueTitle,
    companyId,
    destinationLabel: destinationLabel ?? chatId,
    chatId: String(message.chat.id),
    chatTitle: message.chat.title ?? null,
    publicHandle,
    messageId: message.message_id,
    url: buildTelegramMessageUrl({
      publicHandle,
      chat: message.chat,
      chatId,
      messageId: message.message_id,
    }),
    approvalId,
    parseMode,
    sentAt,
    summary: excerpt(text),
    destinationId: destination?.id ?? trimToNull(params.destinationId),
  };

  await ctx.entities.upsert({
    entityType: ENTITY_TYPES.publication,
    scopeKind: issueId ? "issue" : "company",
    scopeId: issueId ?? companyId,
    externalId: publicationRecord.externalId,
    title: issueIdentifier
      ? `Telegram publish for ${issueIdentifier}`
      : `Telegram publish ${publicationRecord.externalId}`,
    status: "published",
    data: publicationRecord,
  });
  await setCompanyState(ctx, companyId, STATE_KEYS.lastPublication, publicationRecord);
  await ctx.activity.log({
    companyId,
    message: `Published Telegram message to ${publicationRecord.destinationLabel}`,
    entityType: issueId ? "issue" : "company",
    entityId: issueId ?? companyId,
    metadata: {
      pluginId: PLUGIN_ID,
      approvalId,
      externalId: publicationRecord.externalId,
      url: publicationRecord.url,
      destinationLabel: publicationRecord.destinationLabel,
    },
  });
  await ctx.metrics.write("telegram.publish", 1, {
    companyId,
    destination: publicationRecord.destinationLabel,
    has_url: publicationRecord.url ? "true" : "false",
  });
  return publicationRecord;
}

const plugin: PaperclipPlugin = definePlugin({
  async setup(ctx) {
    ctx.data.register(DATA_KEYS.overview, async (params) => {
      const companyId = trimToNull(params.companyId) ?? "";
      if (!companyId) {
        return {
          configured: false,
          companySettings: { ...DEFAULT_COMPANY_SETTINGS },
          legacyConfigDetected: false,
          destinations: [],
          sources: [],
          linkedChats: [],
          botHealth: null,
          recentPublications: [],
          scheduledPublications: [],
          recentIngestedStories: [],
          blockedTaskCount: 0,
          openTaskCount: 0,
          reviewTaskCount: 0,
          approvalsInboxEnabled: false,
          actionableApprovalCount: 0,
          myPendingApprovalCount: 0,
          myRevisionApprovalCount: 0,
          pendingJoinRequestCount: 0,
          openBudgetIncidentCount: 0,
          scheduledPublishCount: 0,
          failedPublishCount: 0,
          ingestedStoryCount: 0,
        } satisfies Partial<TelegramOverview>;
      }
      return await buildOverview(ctx, companyId);
    });

    ctx.data.register(DATA_KEYS.issuePublications, async (params) => {
      const companyId = trimToNull(params.companyId) ?? "";
      const issueId = trimToNull(params.issueId) ?? "";
      if (!companyId || !issueId) return [];
      return await listIssuePublications(ctx, companyId, issueId);
    });

    ctx.data.register(DATA_KEYS.issuePublicationJobs, async (params) => {
      const companyId = trimToNull(params.companyId) ?? "";
      const issueId = trimToNull(params.issueId) ?? "";
      if (!companyId || !issueId) return [];
      return await listPublicationJobs(ctx, companyId, { issueId, limit: 50 });
    });

    ctx.actions.register(ACTION_KEYS.testConnection, async (params) => {
      const companyId = trimToNull(params.companyId) ?? "";
      if (!companyId) throw new Error("companyId is required");
      const effective = await getEffectiveCompanySettings(ctx, companyId);
      const token = await resolveBotTokenForSettings(ctx, effective.settings);
      const bot = await telegramRequest<{
        id: number;
        username?: string;
        first_name?: string;
        can_join_groups?: boolean;
        can_read_all_group_messages?: boolean;
      }>(ctx, token, "getMe");
      const defaultChatId = trimToNull(getDefaultDestination(effective.settings)?.chatId)
        ?? trimToNull(effective.settings.publishing.defaultChatId);
      const defaultChat = defaultChatId
        ? await telegramRequest<TelegramChat>(ctx, token, "getChat", { chat_id: defaultChatId })
        : null;
      const result = {
        connected: true,
        checkedAt: new Date().toISOString(),
        bot: {
          id: bot.id,
          username: bot.username ?? null,
          firstName: bot.first_name ?? null,
          canJoinGroups: bot.can_join_groups ?? null,
          canReadAllGroupMessages: bot.can_read_all_group_messages ?? null,
        },
        defaultChat: defaultChat
          ? {
            id: String(defaultChat.id),
            title: defaultChat.title ?? null,
            username: defaultChat.username ?? null,
            type: defaultChat.type,
          }
          : null,
        settingsSource: effective.source,
      };
      await setCompanyState(ctx, companyId, STATE_KEYS.lastValidation, result);
      await ctx.metrics.write("telegram.connection_test", 1, {
        companyId,
        success: "true",
        source: effective.source,
      });
      return result;
    });

    ctx.actions.register(ACTION_KEYS.publishMessage, async (params) => {
      const companyId = trimToNull(params.companyId) ?? "";
      if (!companyId) throw new Error("companyId is required");
      return await publishTelegramMessage(ctx, companyId, params);
    });

    ctx.actions.register(ACTION_KEYS.scheduleMessage, async (params) => {
      const companyId = trimToNull(params.companyId) ?? "";
      const issueId = trimToNull(params.issueId) ?? "";
      if (!companyId || !issueId) throw new Error("companyId and issueId are required");
      const issue = await ctx.issues.get(issueId, companyId);
      if (!issue) throw new Error("Issue not found");
      const approvalId = trimToNull(params.approvalId);
      if (!approvalId) throw new Error("An approved Telegram publish approval is required before scheduling.");
      const approval = await ctx.approvals.get(approvalId);
      if (
        !approval
        || approval.companyId !== companyId
        || approval.status !== "approved"
        || approval.type !== "publish_content"
        || trimToNull(approval.payload.channel)?.toLowerCase() !== "telegram"
      ) {
        throw new Error("An approved Telegram publish_content approval is required before scheduling.");
      }
      const effective = await getEffectiveCompanySettings(ctx, companyId);
      const destinationId = trimToNull(params.destinationId) ?? getDefaultDestination(effective.settings)?.id ?? null;
      const destination = destinationId ? findDestinationById(effective.settings, destinationId) : null;
      if (!destination) {
        throw new Error("Choose a configured Telegram destination before scheduling.");
      }
      if (!destination.enabled) {
        throw new Error(`Configured Telegram destination "${destination.label}" is disabled.`);
      }
      const now = new Date().toISOString();
      return await upsertPublicationJob(ctx, {
        id: trimToNull(params.jobId) ?? undefined,
        companyId,
        issueId,
        approvalId: approval.id,
        destinationId: destination.id,
        publishAt: normalizePublishAt(params.publishAt),
        status: "scheduled",
        attemptCount: 0,
        lastAttemptAt: null,
        failureReason: null,
        publishedMessageId: null,
        publishedUrl: null,
        createdByUserId: trimToNull(params.createdByUserId),
        createdByAgentId: trimToNull(params.createdByAgentId),
        createdAt: now,
        updatedAt: now,
      });
    });

    ctx.actions.register(ACTION_KEYS.cancelPublicationJob, async (params) => {
      const companyId = trimToNull(params.companyId) ?? "";
      const jobId = trimToNull(params.jobId) ?? "";
      if (!companyId || !jobId) throw new Error("companyId and jobId are required");
      const existing = await getPublicationJobById(ctx, companyId, jobId);
      if (!existing) throw new Error("Telegram publication job not found");
      return await upsertPublicationJob(ctx, {
        ...existing,
        status: "cancelled",
        updatedAt: new Date().toISOString(),
      });
    });

    ctx.actions.register(ACTION_KEYS.reschedulePublicationJob, async (params) => {
      const companyId = trimToNull(params.companyId) ?? "";
      const jobId = trimToNull(params.jobId) ?? "";
      if (!companyId || !jobId) throw new Error("companyId and jobId are required");
      const existing = await getPublicationJobById(ctx, companyId, jobId);
      if (!existing) throw new Error("Telegram publication job not found");
      if (existing.status === "published") {
        throw new Error("Published Telegram jobs cannot be rescheduled.");
      }
      return await upsertPublicationJob(ctx, {
        ...existing,
        publishAt: normalizePublishAt(params.publishAt ?? existing.publishAt),
        status: "scheduled",
        failureReason: null,
        updatedAt: new Date().toISOString(),
      });
    });

    ctx.actions.register(ACTION_KEYS.generateLinkCode, async (params) => {
      const companyId = trimToNull(params.companyId) ?? "";
      if (!companyId) throw new Error("companyId is required");
      const boardUserId = trimToNull(params.boardUserId);
      const effective = await getEffectiveCompanySettings(ctx, companyId);
      const code = await generateClaimCode(
        ctx,
        companyId,
        boardUserId,
        effective.settings.taskBot.claimCodeTtlMinutes,
      );
      await ctx.activity.log({
        companyId,
        message: "Generated Telegram link code",
        entityType: "company",
        entityId: companyId,
        metadata: {
          pluginId: PLUGIN_ID,
          boardUserId,
          code: code.code,
          expiresAt: code.expiresAt,
        },
      });
      return {
        code: code.code,
        expiresAt: code.expiresAt,
        startCommand: `/start ${code.code}`,
      };
    });

    ctx.actions.register(ACTION_KEYS.revokeLinkedChat, async (params) => {
      const companyId = trimToNull(params.companyId) ?? "";
      const chatId = trimToNull(params.chatId) ?? "";
      if (!companyId || !chatId) {
        throw new Error("companyId and chatId are required");
      }
      const revoked = await revokeLinkedChatByChatId(ctx, companyId, chatId);
      if (!revoked) {
        throw new Error("Linked Telegram chat not found");
      }
      return revoked;
    });

    ctx.jobs.register(JOB_KEYS.syncTelegram, async (_job: PluginJobContext) => {
      const rows = await ctx.companySettings.list({ enabledOnly: true });
      const companiesToSync = rows.filter((row) => {
        const settings = sanitizeTelegramCompanySettings(row.settingsJson);
        const hasEnabledSources = getConfiguredSources(settings).some((source) => source.enabled);
        return settings.taskBot.pollingEnabled && (settings.taskBot.enabled || hasEnabledSources);
      });
      for (const row of companiesToSync) {
        await syncTelegramForCompany(ctx, row, rows);
      }
    });

    ctx.jobs.register(JOB_KEYS.dispatchTelegramPublications, async (_job: PluginJobContext) => {
      const rows = await ctx.companySettings.list({ enabledOnly: true });
      for (const row of rows) {
        const effective = await getEffectiveCompanySettings(ctx, row.companyId);
        if (!trimToNull(effective.settings.publishing.botTokenSecretRef)) continue;
        await dispatchPublicationJobsForCompany(ctx, effective);
      }
    });
  },

  async onHealth() {
    return {
      status: "ok",
      message: "Telegram connector worker is ready",
    };
  },

  async onValidateConfig(config) {
    const errors: string[] = [];
    const warnings: string[] = [];
    const typedConfig = {
      ...DEFAULT_CONFIG,
      ...sanitizeLegacyTelegramConfig(config),
    };
    if (!trimToNull(typedConfig.botTokenSecretRef)) {
      warnings.push("Legacy bot token secret is not set. Company-scoped Telegram settings are preferred.");
    }
    if (
      trimToNull(typedConfig.defaultParseMode)
      && !["HTML", "MarkdownV2"].includes(String(typedConfig.defaultParseMode))
    ) {
      errors.push("Default parse mode must be HTML or MarkdownV2.");
    }
    return {
      ok: errors.length === 0,
      warnings,
      errors,
    };
  },
});

export default plugin;
runWorker(plugin, import.meta.url);
