import type { PaperclipPluginManifestV1 } from "@paperclipai/plugin-sdk";
import {
  DEFAULT_CONFIG,
  EXPORT_NAMES,
  JOB_KEYS,
  PAGE_ROUTE,
  PLUGIN_ID,
  PLUGIN_VERSION,
  SLOT_IDS,
} from "./constants.js";

const manifest: PaperclipPluginManifestV1 = {
  id: PLUGIN_ID,
  apiVersion: 1,
  version: PLUGIN_VERSION,
  displayName: {
    en: "Telegram Channel Connector",
    ru: "Коннектор Telegram Channel",
  },
  description: {
    en: "Connector plugin for governed Telegram publishing plus Telegram operator workflows for tasks, approvals, joins, and budgets over getUpdates polling.",
    ru: "Плагин-коннектор для управляемых публикаций в Telegram и операторских workflow по задачам, согласованиям, join-запросам и бюджетам через polling getUpdates.",
  },
  author: "Paperclip",
  categories: ["connector", "ui"],
  capabilities: [
    "companies.read",
    "projects.read",
    "routines.read",
    "routines.write",
    "issues.read",
    "issues.create",
    "issues.update",
    "issue.comments.read",
    "issue.comments.create",
    "issue.documents.read",
    "issue.documents.write",
    "approvals.read",
    "approval.comments.read",
    "approval.comments.create",
    "approvals.resolve",
    "joins.read",
    "joins.resolve",
    "budgets.read",
    "budgets.resolve",
    "agents.read",
    "agents.invoke",
    "activity.read",
    "http.outbound",
    "secrets.read-ref",
    "plugin.state.read",
    "plugin.state.write",
    "activity.log.write",
    "metrics.write",
    "jobs.schedule",
    "instance.settings.register",
    "ui.dashboardWidget.register",
    "ui.sidebar.register",
    "ui.page.register",
    "ui.detailTab.register",
  ],
  jobs: [
    {
      jobKey: JOB_KEYS.syncTelegram,
      displayName: {
        en: "Sync Telegram bot",
        ru: "Синхронизация Telegram-бота",
      },
      description: {
        en: "Poll Telegram getUpdates and reconcile Paperclip task notifications.",
        ru: "Опрашивать Telegram getUpdates и синхронизировать уведомления по задачам Paperclip.",
      },
      schedule: "* * * * *",
    },
    {
      jobKey: JOB_KEYS.dispatchTelegramPublications,
      displayName: {
        en: "Dispatch Telegram publications",
        ru: "Отправка публикаций Telegram",
      },
      description: {
        en: "Publish due Telegram publication jobs from the governed queue.",
        ru: "Публиковать готовые задания публикации Telegram из управляемой очереди.",
      },
      schedule: "* * * * *",
    },
  ],
  entrypoints: {
    worker: "./dist/src/worker.js",
    ui: "./dist/ui",
  },
  instanceConfigSchema: {
    type: "object",
    properties: {
      botTokenSecretRef: {
        type: "string",
        title: {
          en: "Bot Token Secret",
          ru: "Секрет Bot Token",
        },
        description: {
          en: "Company secret UUID that stores the Telegram bot token.",
          ru: "UUID секрета компании, в котором хранится токен Telegram-бота.",
        },
        format: "secret-ref",
        default: DEFAULT_CONFIG.botTokenSecretRef,
      },
      defaultChatId: {
        type: "string",
        title: {
          en: "Default Chat / Channel",
          ru: "Чат / канал по умолчанию",
        },
        description: {
          en: "Target channel username like @my_channel or numeric chat id.",
          ru: "Имя целевого канала вроде @my_channel или числовой chat id.",
        },
        default: DEFAULT_CONFIG.defaultChatId,
      },
      defaultPublicHandle: {
        type: "string",
        title: {
          en: "Public Handle",
          ru: "Публичный handle",
        },
        description: {
          en: "Optional @handle used to build clickable t.me post links.",
          ru: "Необязательный @handle, который используется для построения кликабельных ссылок t.me на посты.",
        },
        default: DEFAULT_CONFIG.defaultPublicHandle,
      },
      defaultParseMode: {
        type: "string",
        title: {
          en: "Default Parse Mode",
          ru: "Режим парсинга по умолчанию",
        },
        enum: ["", "HTML", "MarkdownV2"],
        default: DEFAULT_CONFIG.defaultParseMode,
      },
      defaultDisableLinkPreview: {
        type: "boolean",
        title: {
          en: "Disable Link Preview",
          ru: "Отключить предпросмотр ссылок",
        },
        default: DEFAULT_CONFIG.defaultDisableLinkPreview,
      },
      defaultDisableNotification: {
        type: "boolean",
        title: {
          en: "Send Silently",
          ru: "Отправлять без уведомления",
        },
        default: DEFAULT_CONFIG.defaultDisableNotification,
      },
    },
  },
  ui: {
    slots: [
      {
        type: "settingsPage",
        id: SLOT_IDS.settingsPage,
        displayName: {
          en: "Telegram Settings",
          ru: "Настройки Telegram",
        },
        exportName: EXPORT_NAMES.settingsPage,
      },
      {
        type: "dashboardWidget",
        id: SLOT_IDS.dashboardWidget,
        displayName: {
          en: "Telegram",
          ru: "Telegram",
        },
        exportName: EXPORT_NAMES.dashboardWidget,
      },
      {
        type: "sidebar",
        id: SLOT_IDS.sidebar,
        displayName: {
          en: "Telegram",
          ru: "Telegram",
        },
        exportName: EXPORT_NAMES.sidebar,
      },
      {
        type: "page",
        id: SLOT_IDS.page,
        displayName: {
          en: "Telegram",
          ru: "Telegram",
        },
        exportName: EXPORT_NAMES.page,
        routePath: PAGE_ROUTE,
      },
      {
        type: "detailTab",
        id: SLOT_IDS.issueTab,
        displayName: {
          en: "Telegram",
          ru: "Telegram",
        },
        exportName: EXPORT_NAMES.issueTab,
        entityTypes: ["issue"],
      },
    ],
  },
};

export default manifest;
