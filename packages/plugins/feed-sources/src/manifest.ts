import type { PaperclipPluginManifestV1 } from "@paperclipai/plugin-sdk";

const PLUGIN_ID = "paperclip.feed-sources";
const PLUGIN_VERSION = "0.1.0";

const manifest: PaperclipPluginManifestV1 = {
  id: PLUGIN_ID,
  apiVersion: 1,
  version: PLUGIN_VERSION,
  displayName: {
    en: "Feed Sources",
    ru: "Источники лент",
  },
  description: {
    en: "Simple RSS, Atom, and web feed source configuration for editorial intake.",
    ru: "Лаконичная настройка RSS, Atom и web-источников для editorial intake.",
  },
  author: "Paperclip",
  categories: ["automation", "ui"],
  capabilities: ["instance.settings.register", "ui.page.register"],
  entrypoints: {
    worker: "./dist/worker.js",
    ui: "./dist/ui",
  },
  ui: {
    slots: [
      {
        type: "settingsPage",
        id: "feed-sources-settings-page",
        displayName: {
          en: "Feed Sources Settings",
          ru: "Настройки источников лент",
        },
        exportName: "FeedSourcesSettingsPage",
      },
      {
        type: "page",
        id: "feed-sources-page",
        displayName: {
          en: "Feed Sources",
          ru: "Источники лент",
        },
        exportName: "FeedSourcesPage",
        routePath: "feed-sources",
      },
    ],
  },
};

export default manifest;
