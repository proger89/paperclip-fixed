import type { TelegramCompanySettings, LegacyTelegramConfig } from "./plugin-types.js";

export const PLUGIN_ID = "paperclip.telegram-channel-connector";
export const PLUGIN_VERSION = "0.1.0";
export const PAGE_ROUTE = "telegram";
export const TELEGRAM_MAX_MESSAGE_LENGTH = 4096;
export const JOB_KEYS = {
  syncTelegram: "sync-telegram",
  dispatchTelegramPublications: "dispatch-telegram-publications",
} as const;

export const SLOT_IDS = {
  settingsPage: "telegram-settings-page",
  dashboardWidget: "telegram-dashboard-widget",
  sidebar: "telegram-sidebar-link",
  page: "telegram-page",
  issueTab: "telegram-issue-tab",
} as const;

export const EXPORT_NAMES = {
  settingsPage: "TelegramSettingsPage",
  dashboardWidget: "TelegramDashboardWidget",
  sidebar: "TelegramSidebarLink",
  page: "TelegramPage",
  issueTab: "TelegramIssueTab",
} as const;

export const ACTION_KEYS = {
  testConnection: "test-connection",
  publishMessage: "publish-message",
  scheduleMessage: "schedule-message",
  cancelPublicationJob: "cancel-publication-job",
  reschedulePublicationJob: "reschedule-publication-job",
  generateLinkCode: "generate-link-code",
  revokeLinkedChat: "revoke-linked-chat",
} as const;

export const DATA_KEYS = {
  overview: "overview",
  issuePublications: "issue-publications",
  issuePublicationJobs: "issue-publication-jobs",
} as const;

export const DEFAULT_CONFIG: LegacyTelegramConfig = {
  botTokenSecretRef: "",
  defaultChatId: "",
  defaultPublicHandle: "",
  defaultParseMode: "",
  defaultDisableLinkPreview: false,
  defaultDisableNotification: false,
};

export const DEFAULT_COMPANY_SETTINGS: TelegramCompanySettings = {
  publishing: {
    botTokenSecretRef: "",
    defaultChatId: "",
    defaultPublicHandle: "",
    defaultParseMode: "",
    defaultDisableLinkPreview: false,
    defaultDisableNotification: false,
    destinations: [],
    defaultDestinationId: "",
  },
  taskBot: {
    enabled: false,
    pollingEnabled: true,
    notificationMode: "fallback_all_linked",
    claimCodeTtlMinutes: 30,
  },
  ingestion: {
    sources: [],
  },
};
