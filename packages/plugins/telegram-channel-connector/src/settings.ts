import { DEFAULT_COMPANY_SETTINGS, DEFAULT_CONFIG } from "./constants.js";
import type {
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
  const ttlRaw = Number(taskBotInput.claimCodeTtlMinutes);
  const ttl = Number.isFinite(ttlRaw) ? Math.min(Math.max(Math.floor(ttlRaw), 5), 24 * 60) : DEFAULT_COMPANY_SETTINGS.taskBot.claimCodeTtlMinutes;

  return {
    publishing: {
      botTokenSecretRef: trimString(publishingInput.botTokenSecretRef),
      defaultChatId: trimString(publishingInput.defaultChatId),
      defaultPublicHandle: trimString(publishingInput.defaultPublicHandle),
      defaultParseMode: normalizeParseMode(publishingInput.defaultParseMode),
      defaultDisableLinkPreview: publishingInput.defaultDisableLinkPreview === true,
      defaultDisableNotification: publishingInput.defaultDisableNotification === true,
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
  };
}

export function companySettingsFromLegacyConfig(input: unknown): TelegramCompanySettings {
  const legacy = sanitizeLegacyTelegramConfig(input);
  return {
    publishing: {
      botTokenSecretRef: legacy.botTokenSecretRef ?? DEFAULT_CONFIG.botTokenSecretRef ?? "",
      defaultChatId: legacy.defaultChatId ?? DEFAULT_CONFIG.defaultChatId ?? "",
      defaultPublicHandle: legacy.defaultPublicHandle ?? DEFAULT_CONFIG.defaultPublicHandle ?? "",
      defaultParseMode: legacy.defaultParseMode ?? DEFAULT_CONFIG.defaultParseMode ?? "",
      defaultDisableLinkPreview: legacy.defaultDisableLinkPreview ?? DEFAULT_CONFIG.defaultDisableLinkPreview ?? false,
      defaultDisableNotification: legacy.defaultDisableNotification ?? DEFAULT_CONFIG.defaultDisableNotification ?? false,
    },
    taskBot: { ...DEFAULT_COMPANY_SETTINGS.taskBot },
  };
}

export function hasLegacyTelegramConfig(input: unknown) {
  const legacy = sanitizeLegacyTelegramConfig(input);
  return Boolean(legacy.botTokenSecretRef || legacy.defaultChatId || legacy.defaultPublicHandle);
}
