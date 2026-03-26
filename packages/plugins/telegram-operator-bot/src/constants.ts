import type { TelegramCompanySettings, LegacyTelegramConfig } from "./plugin-types.js";

export const PLUGIN_ID = "paperclip.telegram-operator-bot";
export const PLUGIN_VERSION = "0.1.0";
export const PAGE_ROUTE = "telegram-ops";
export const TELEGRAM_MAX_MESSAGE_LENGTH = 4096;
export const JOB_KEYS = {
  syncTelegram: "sync-telegram",
  dispatchTelegramPublications: "dispatch-telegram-publications",
} as const;

export const SLOT_IDS = {
  settingsPage: "telegram-operator-settings-page",
  dashboardWidget: "telegram-operator-dashboard-widget",
  sidebar: "telegram-operator-sidebar-link",
  page: "telegram-operator-page",
  issueTab: "telegram-operator-issue-tab",
} as const;

export const EXPORT_NAMES = {
  settingsPage: "TelegramOperatorSettingsPage",
  dashboardWidget: "TelegramOperatorDashboardWidget",
  sidebar: "TelegramOperatorSidebarLink",
  page: "TelegramOperatorPage",
  issueTab: "TelegramOperatorIssueTab",
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
