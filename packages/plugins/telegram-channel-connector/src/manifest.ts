import type { PaperclipPluginManifestV1 } from "@paperclipai/plugin-sdk";
import {
  DEFAULT_CONFIG,
  EXPORT_NAMES,
  PAGE_ROUTE,
  PLUGIN_ID,
  PLUGIN_VERSION,
  SLOT_IDS,
} from "./constants.js";

const manifest: PaperclipPluginManifestV1 = {
  id: PLUGIN_ID,
  apiVersion: 1,
  version: PLUGIN_VERSION,
  displayName: "Telegram Channel Connector",
  description: "Connector plugin for governed Telegram channel publishing, board-side approvals, and visible publication outputs.",
  author: "Paperclip",
  categories: ["connector", "ui"],
  capabilities: [
    "http.outbound",
    "secrets.read-ref",
    "plugin.state.read",
    "plugin.state.write",
    "activity.log.write",
    "metrics.write",
    "instance.settings.register",
    "ui.dashboardWidget.register",
    "ui.sidebar.register",
    "ui.page.register",
    "ui.detailTab.register",
  ],
  entrypoints: {
    worker: "./dist/worker.js",
    ui: "./dist/ui",
  },
  instanceConfigSchema: {
    type: "object",
    properties: {
      botTokenSecretRef: {
        type: "string",
        title: "Bot Token Secret",
        description: "Company secret UUID that stores the Telegram bot token.",
        format: "secret-ref",
        default: DEFAULT_CONFIG.botTokenSecretRef,
      },
      defaultChatId: {
        type: "string",
        title: "Default Chat / Channel",
        description: "Target channel username like @my_channel or numeric chat id.",
        default: DEFAULT_CONFIG.defaultChatId,
      },
      defaultPublicHandle: {
        type: "string",
        title: "Public Handle",
        description: "Optional @handle used to build clickable t.me post links.",
        default: DEFAULT_CONFIG.defaultPublicHandle,
      },
      defaultParseMode: {
        type: "string",
        title: "Default Parse Mode",
        enum: ["", "HTML", "MarkdownV2"],
        default: DEFAULT_CONFIG.defaultParseMode,
      },
      defaultDisableLinkPreview: {
        type: "boolean",
        title: "Disable Link Preview",
        default: DEFAULT_CONFIG.defaultDisableLinkPreview,
      },
      defaultDisableNotification: {
        type: "boolean",
        title: "Send Silently",
        default: DEFAULT_CONFIG.defaultDisableNotification,
      },
    },
  },
  ui: {
    slots: [
      {
        type: "settingsPage",
        id: SLOT_IDS.settingsPage,
        displayName: "Telegram Settings",
        exportName: EXPORT_NAMES.settingsPage,
      },
      {
        type: "dashboardWidget",
        id: SLOT_IDS.dashboardWidget,
        displayName: "Telegram",
        exportName: EXPORT_NAMES.dashboardWidget,
      },
      {
        type: "sidebar",
        id: SLOT_IDS.sidebar,
        displayName: "Telegram",
        exportName: EXPORT_NAMES.sidebar,
      },
      {
        type: "page",
        id: SLOT_IDS.page,
        displayName: "Telegram",
        exportName: EXPORT_NAMES.page,
        routePath: PAGE_ROUTE,
      },
      {
        type: "detailTab",
        id: SLOT_IDS.issueTab,
        displayName: "Telegram",
        exportName: EXPORT_NAMES.issueTab,
        entityTypes: ["issue"],
      },
    ],
  },
};

export default manifest;
