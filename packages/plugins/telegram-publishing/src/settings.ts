import { DEFAULT_COMPANY_SETTINGS, DEFAULT_CONFIG } from "./constants.js";
import type {
  TelegramDestination,
  TelegramPublishingAiSettings,
  TelegramIngestionSource,
  LegacyTelegramConfig,
  TelegramCompanySettings,
  TelegramParseMode,
} from "./plugin-types.js";

function trimString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeParseMode(value: unknown): TelegramParseMode {
  return value === "HTML" || value === "MarkdownV2" ? value : "";
}

function normalizeDestination(input: unknown, index: number): TelegramDestination {
  const record = typeof input === "object" && input !== null ? input as Record<string, unknown> : {};
  const id = trimString(record.id) || `destination-${index + 1}`;
  const chatId = trimString(record.chatId);
  const publicHandle = trimString(record.publicHandle);
  return {
    id,
    label: trimString(record.label) || publicHandle || chatId || `Destination ${index + 1}`,
    chatId,
    publicHandle,
    parseMode: normalizeParseMode(record.parseMode),
    disableLinkPreview: record.disableLinkPreview === true,
    disableNotification: record.disableNotification === true,
    enabled: record.enabled !== false,
    isDefault: record.isDefault === true,
  };
}

function normalizeSource(input: unknown, index: number): TelegramIngestionSource {
  const record = typeof input === "object" && input !== null ? input as Record<string, unknown> : {};
  const id = trimString(record.id) || `source-${index + 1}`;
  const chatId = trimString(record.chatId);
  const publicHandle = trimString(record.publicHandle);
  return {
    id,
    label: trimString(record.label) || publicHandle || chatId || `Source ${index + 1}`,
    chatId,
    publicHandle,
    discussionChatId: trimString(record.discussionChatId),
    mode: record.mode === "discussion_replies" || record.mode === "both" ? record.mode : "channel_posts",
    enabled: record.enabled !== false,
    projectId: trimString(record.projectId),
    assigneeAgentId: trimString(record.assigneeAgentId),
    routineId: trimString(record.routineId),
    issueTemplateKey: trimString(record.issueTemplateKey),
  };
}

function normalizeAiSettings(input: unknown): TelegramPublishingAiSettings {
  const record = typeof input === "object" && input !== null ? input as Record<string, unknown> : {};
  const adapterType = trimString(record.adapterType) === "codex_local" ? "codex_local" : "codex_local";
  const reasoningEffortRaw = trimString(record.reasoningEffort);
  const reasoningEffort =
    reasoningEffortRaw === "low" || reasoningEffortRaw === "medium" || reasoningEffortRaw === "high"
      ? reasoningEffortRaw
      : DEFAULT_COMPANY_SETTINGS.ai.reasoningEffort;

  return {
    adapterType,
    model: trimString(record.model),
    reasoningEffort,
  };
}

function materializeLegacyDestinations(input: LegacyTelegramConfig): TelegramDestination[] {
  const chatId = trimString(input.defaultChatId);
  const publicHandle = trimString(input.defaultPublicHandle);
  if (!chatId && !publicHandle) return [];
  return [{
    id: "legacy-default",
    label: publicHandle || chatId || "Default destination",
    chatId,
    publicHandle,
    parseMode: normalizeParseMode(input.defaultParseMode),
    disableLinkPreview: input.defaultDisableLinkPreview === true,
    disableNotification: input.defaultDisableNotification === true,
    enabled: true,
    isDefault: true,
  }];
}

export function sanitizeLegacyTelegramConfig(input: unknown): LegacyTelegramConfig {
  const record = typeof input === "object" && input !== null ? input as Record<string, unknown> : {};
  return {
    botTokenSecretRef: trimString(record.botTokenSecretRef),
    defaultChatId: trimString(record.defaultChatId),
    defaultPublicHandle: trimString(record.defaultPublicHandle),
    defaultParseMode: normalizeParseMode(record.defaultParseMode),
    defaultDisableLinkPreview: record.defaultDisableLinkPreview === true,
    defaultDisableNotification: record.defaultDisableNotification === true,
  };
}

export function sanitizeTelegramCompanySettings(input: unknown): TelegramCompanySettings {
  const record = typeof input === "object" && input !== null ? input as Record<string, unknown> : {};
  const publishingInput =
    typeof record.publishing === "object" && record.publishing !== null
      ? record.publishing as Record<string, unknown>
      : {};
  const taskBotInput =
    typeof record.taskBot === "object" && record.taskBot !== null
      ? record.taskBot as Record<string, unknown>
      : {};
  const aiInput =
    typeof record.ai === "object" && record.ai !== null
      ? record.ai as Record<string, unknown>
      : {};
  const ingestionInput =
    typeof record.ingestion === "object" && record.ingestion !== null
      ? record.ingestion as Record<string, unknown>
      : {};
  const ttlRaw = Number(taskBotInput.claimCodeTtlMinutes);
  const ttl = Number.isFinite(ttlRaw) ? Math.min(Math.max(Math.floor(ttlRaw), 5), 24 * 60) : DEFAULT_COMPANY_SETTINGS.taskBot.claimCodeTtlMinutes;
  const legacy = sanitizeLegacyTelegramConfig(input);
  const destinationInputs = Array.isArray(publishingInput.destinations) ? publishingInput.destinations : [];
  const destinations = destinationInputs.length > 0
    ? destinationInputs.map((entry, index) => normalizeDestination(entry, index)).filter((entry) => entry.chatId || entry.publicHandle)
    : materializeLegacyDestinations(legacy);
  const explicitDefaultId = trimString(publishingInput.defaultDestinationId);
  const defaultDestinationId = (
    (explicitDefaultId && destinations.some((entry) => entry.id === explicitDefaultId) ? explicitDefaultId : "")
    || destinations.find((entry) => entry.isDefault)?.id
    || destinations[0]?.id
    || ""
  );
  const normalizedDestinations = destinations.map((entry) => ({
    ...entry,
    isDefault: defaultDestinationId !== "" && entry.id === defaultDestinationId,
  }));
  const sourceInputs = Array.isArray(ingestionInput.sources) ? ingestionInput.sources : [];

  return {
    publishing: {
      botTokenSecretRef: trimString(publishingInput.botTokenSecretRef),
      defaultChatId: trimString(publishingInput.defaultChatId),
      defaultPublicHandle: trimString(publishingInput.defaultPublicHandle),
      defaultParseMode: normalizeParseMode(publishingInput.defaultParseMode),
      defaultDisableLinkPreview: publishingInput.defaultDisableLinkPreview === true,
      defaultDisableNotification: publishingInput.defaultDisableNotification === true,
      destinations: normalizedDestinations,
      defaultDestinationId,
    },
    taskBot: {
      enabled: taskBotInput.enabled === true,
      pollingEnabled: taskBotInput.pollingEnabled !== false,
      notificationMode:
        taskBotInput.notificationMode === "linked_only"
          ? "linked_only"
          : DEFAULT_COMPANY_SETTINGS.taskBot.notificationMode,
      claimCodeTtlMinutes: ttl,
    },
    ai: normalizeAiSettings(aiInput),
    ingestion: {
      sources: sourceInputs.map((entry, index) => normalizeSource(entry, index)).filter((entry) => entry.chatId),
    },
  };
}

export function companySettingsFromLegacyConfig(input: unknown): TelegramCompanySettings {
  const legacy = sanitizeLegacyTelegramConfig(input);
  const destinations = materializeLegacyDestinations(legacy);
  return {
    publishing: {
      botTokenSecretRef: legacy.botTokenSecretRef ?? DEFAULT_CONFIG.botTokenSecretRef ?? "",
      defaultChatId: legacy.defaultChatId ?? DEFAULT_CONFIG.defaultChatId ?? "",
      defaultPublicHandle: legacy.defaultPublicHandle ?? DEFAULT_CONFIG.defaultPublicHandle ?? "",
      defaultParseMode: legacy.defaultParseMode ?? DEFAULT_CONFIG.defaultParseMode ?? "",
      defaultDisableLinkPreview: legacy.defaultDisableLinkPreview ?? DEFAULT_CONFIG.defaultDisableLinkPreview ?? false,
      defaultDisableNotification: legacy.defaultDisableNotification ?? DEFAULT_CONFIG.defaultDisableNotification ?? false,
      destinations,
      defaultDestinationId: destinations[0]?.id ?? "",
    },
    taskBot: { ...DEFAULT_COMPANY_SETTINGS.taskBot },
    ai: { ...DEFAULT_COMPANY_SETTINGS.ai },
    ingestion: { ...DEFAULT_COMPANY_SETTINGS.ingestion },
  };
}

export function hasLegacyTelegramConfig(input: unknown) {
  const legacy = sanitizeLegacyTelegramConfig(input);
  return Boolean(legacy.botTokenSecretRef || legacy.defaultChatId || legacy.defaultPublicHandle);
}
