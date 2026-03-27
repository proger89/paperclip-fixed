import type { PaperclipPluginManifestV1 } from "@paperclipai/plugin-sdk";

const PLUGIN_ID = "paperclip.web-content-import";
const PLUGIN_VERSION = "0.1.0";

const manifest: PaperclipPluginManifestV1 = {
  id: PLUGIN_ID,
  apiVersion: 1,
  version: PLUGIN_VERSION,
  displayName: {
    en: "Web Content Import",
    ru: "Импорт текста по ссылке",
  },
  description: {
    en: "Simple URL import surface that extracts clean source text for editorial workflows.",
    ru: "Лаконичный импорт URL в чистый текст для editorial workflow.",
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
        id: "web-content-import-settings-page",
        displayName: {
          en: "Web Content Import Settings",
          ru: "Настройки импорта по ссылке",
        },
        exportName: "WebContentImportSettingsPage",
      },
      {
        type: "page",
        id: "web-content-import-page",
        displayName: {
          en: "Web Content Import",
          ru: "Импорт текста по ссылке",
        },
        exportName: "WebContentImportPage",
        routePath: "web-import",
      },
    ],
  },
};

export default manifest;
