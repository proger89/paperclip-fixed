import type { PaperclipPluginManifestV1 } from "@paperclipai/plugin-sdk";

const PLUGIN_ID = "paperclip.author-voice-profiles";
const PLUGIN_VERSION = "0.1.0";

const manifest: PaperclipPluginManifestV1 = {
  id: PLUGIN_ID,
  apiVersion: 1,
  version: PLUGIN_VERSION,
  displayName: {
    en: "Author Voice Profiles",
    ru: "Профили авторского стиля",
  },
  description: {
    en: "Per-channel author voice rules used by Telegram publishing rewrites.",
    ru: "Профили стиля по каналам для рерайта и подготовки постов в Telegram.",
  },
  author: "Paperclip",
  categories: ["ui", "automation"],
  capabilities: ["instance.settings.register", "ui.page.register"],
  entrypoints: {
    worker: "./dist/worker.js",
    ui: "./dist/ui",
  },
  ui: {
    slots: [
      {
        type: "settingsPage",
        id: "author-voice-profiles-settings-page",
        displayName: {
          en: "Author Voice Profiles Settings",
          ru: "Настройки профилей стиля",
        },
        exportName: "AuthorVoiceProfilesSettingsPage",
      },
      {
        type: "page",
        id: "author-voice-profiles-page",
        displayName: {
          en: "Author Voice Profiles",
          ru: "Профили авторского стиля",
        },
        exportName: "AuthorVoiceProfilesPage",
        routePath: "author-voice",
      },
    ],
  },
};

export default manifest;
