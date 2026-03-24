export const PLUGIN_ID = "paperclip.telegram-channel-connector";
export const PLUGIN_VERSION = "0.1.0";
export const PAGE_ROUTE = "telegram";
export const TELEGRAM_MAX_MESSAGE_LENGTH = 4096;

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
} as const;

export const DATA_KEYS = {
  overview: "overview",
  issuePublications: "issue-publications",
} as const;

export const DEFAULT_CONFIG = {
  botTokenSecretRef: "",
  defaultChatId: "",
  defaultPublicHandle: "",
  defaultParseMode: "",
  defaultDisableLinkPreview: false,
  defaultDisableNotification: false,
} as const;
