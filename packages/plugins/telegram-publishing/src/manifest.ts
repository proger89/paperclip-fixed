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
    en: "Telegram Publishing",
    ru: "Telegram Publishing",
  },
  description: {
    en: "Minimal Telegram publishing plugin with channel setup, donor channels, ready-for-approval queue, and governed publication dispatch.",
    ru: "Minimal Telegram publishing plugin with channel setup, donor channels, ready-for-approval queue, and governed publication dispatch.",
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
        en: "Sync Telegram publishing",
        ru: "Sync Telegram publishing",
      },
      description: {
        en: "Poll Telegram getUpdates for donor channels and reconcile publishing state.",
        ru: "Poll Telegram getUpdates for donor channels and reconcile publishing state.",
      },
      schedule: "* * * * *",
    },
    {
      jobKey: JOB_KEYS.dispatchTelegramPublications,
      displayName: {
        en: "Dispatch Telegram publications",
        ru: "Dispatch Telegram publications",
      },
      description: {
        en: "Publish due Telegram publication jobs from the governed queue.",
        ru: "Publish due Telegram publication jobs from the governed queue.",
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
        title: { en: "Legacy Bot Token Secret", ru: "Legacy Bot Token Secret" },
        description: {
          en: "Legacy instance-scoped secret UUID. Prefer company-scoped publishing settings instead.",
          ru: "Legacy instance-scoped secret UUID. Prefer company-scoped publishing settings instead.",
        },
        format: "secret-ref",
        default: DEFAULT_CONFIG.botTokenSecretRef,
      },
      defaultChatId: {
        type: "string",
        title: { en: "Legacy Default Channel", ru: "Legacy Default Channel" },
        description: {
          en: "Legacy fallback target channel username like @my_channel or numeric chat id.",
          ru: "Legacy fallback target channel username like @my_channel or numeric chat id.",
        },
        default: DEFAULT_CONFIG.defaultChatId,
      },
      defaultPublicHandle: {
        type: "string",
        title: { en: "Legacy Public Handle", ru: "Legacy Public Handle" },
        description: {
          en: "Legacy fallback @handle used to build clickable t.me post links.",
          ru: "Legacy fallback @handle used to build clickable t.me post links.",
        },
        default: DEFAULT_CONFIG.defaultPublicHandle,
      },
      defaultParseMode: {
        type: "string",
        title: { en: "Legacy Default Parse Mode", ru: "Legacy Default Parse Mode" },
        enum: ["", "HTML", "MarkdownV2"],
        default: DEFAULT_CONFIG.defaultParseMode,
      },
      defaultDisableLinkPreview: {
        type: "boolean",
        title: { en: "Legacy Disable Link Preview", ru: "Legacy Disable Link Preview" },
        default: DEFAULT_CONFIG.defaultDisableLinkPreview,
      },
      defaultDisableNotification: {
        type: "boolean",
        title: { en: "Legacy Send Silently", ru: "Legacy Send Silently" },
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
          en: "Telegram Publishing Settings",
          ru: "Telegram Publishing Settings",
        },
        exportName: EXPORT_NAMES.settingsPage,
      },
      {
        type: "dashboardWidget",
        id: SLOT_IDS.dashboardWidget,
        displayName: {
          en: "Telegram Publishing",
          ru: "Telegram Publishing",
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
          en: "Telegram Publishing",
          ru: "Telegram Publishing",
        },
        exportName: EXPORT_NAMES.page,
        routePath: PAGE_ROUTE,
      },
      {
        type: "detailTab",
        id: SLOT_IDS.issueTab,
        displayName: {
          en: "Telegram Trace",
          ru: "Telegram Trace",
        },
        exportName: EXPORT_NAMES.issueTab,
        entityTypes: ["issue"],
      },
    ],
  },
};

export default manifest;
