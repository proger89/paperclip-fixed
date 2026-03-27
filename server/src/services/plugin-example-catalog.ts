import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { LocalizedText, PluginCategory } from "@paperclipai/shared";

export interface BundledPluginExample {
  packageName: string;
  pluginKey: string;
  displayName: LocalizedText;
  description: LocalizedText;
  localPath: string;
  tag: "example" | "bundled";
  categories: PluginCategory[];
  devOnly?: boolean;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../..");

const BUNDLED_PLUGIN_EXAMPLES: BundledPluginExample[] = [
  {
    packageName: "@paperclipai/plugin-hello-world-example",
    pluginKey: "paperclip.hello-world-example",
    displayName: { en: "Hello World Widget (Example)", ru: "Hello World Widget (пример)" },
    description: {
      en: "Reference UI plugin that adds a simple Hello World widget to the Paperclip dashboard.",
      ru: "Справочный UI-плагин, который добавляет простой виджет Hello World на дашборд Paperclip.",
    },
    localPath: "packages/plugins/examples/plugin-hello-world-example",
    tag: "example",
    categories: ["ui"],
    devOnly: true,
  },
  {
    packageName: "@paperclipai/plugin-file-browser-example",
    pluginKey: "paperclip-file-browser-example",
    displayName: { en: "File Browser (Example)", ru: "File Browser (пример)" },
    description: {
      en: "Example plugin that adds a Files link in project navigation plus a project detail file browser.",
      ru: "Пример плагина, который добавляет ссылку Files в навигацию проекта и файловый браузер на странице проекта.",
    },
    localPath: "packages/plugins/examples/plugin-file-browser-example",
    tag: "example",
    categories: ["workspace", "ui"],
    devOnly: true,
  },
  {
    packageName: "@paperclipai/plugin-kitchen-sink-example",
    pluginKey: "paperclip-kitchen-sink-example",
    displayName: { en: "Kitchen Sink (Example)", ru: "Kitchen Sink (пример)" },
    description: {
      en: "Reference plugin that demonstrates the current Paperclip plugin API surface, bridge flows, UI extension surfaces, jobs, webhooks, tools, streams, and trusted local workspace/process demos.",
      ru: "Справочный плагин, который показывает текущую API-поверхность плагинов Paperclip, bridge-флоу, UI-слоты, jobs, webhooks, tools, streams и trusted local workspace/process демо.",
    },
    localPath: "packages/plugins/examples/plugin-kitchen-sink-example",
    tag: "example",
    categories: ["ui", "automation", "workspace", "connector"],
    devOnly: true,
  },
  {
    packageName: "@paperclipai/plugin-authoring-smoke-example",
    pluginKey: "paperclipai.plugin-authoring-smoke-example",
    displayName: { en: "Plugin Authoring Smoke Example", ru: "Smoke Example для авторинга плагинов" },
    description: {
      en: "Minimal connector example used to validate local plugin authoring and install flows.",
      ru: "Минимальный пример connector-плагина для проверки локального авторинга и установки.",
    },
    localPath: "packages/plugins/examples/plugin-authoring-smoke-example",
    tag: "example",
    categories: ["connector"],
    devOnly: true,
  },
  {
    packageName: "@paperclipai/plugin-telegram-publishing",
    pluginKey: "paperclip.telegram-publishing",
    displayName: { en: "Telegram Publishing", ru: "Публикации в Telegram" },
    description: {
      en: "Laconic Telegram publishing surface with channel setup, donor channels, ready-for-approval queue, and governed dispatch.",
      ru: "Лаконичный плагин публикаций в Telegram с каналами публикации, каналами-донорами, очередью готовых постов и управляемой отправкой.",
    },
    localPath: "packages/plugins/telegram-publishing",
    tag: "bundled",
    categories: ["connector", "ui"],
  },
  {
    packageName: "@paperclipai/plugin-telegram-operator-bot",
    pluginKey: "paperclip.telegram-operator-bot",
    displayName: { en: "Telegram Operator Bot", ru: "Telegram-бот оператора" },
    description: {
      en: "Private-chat Telegram bot for tasks, approvals, joins, and budget incidents over getUpdates polling.",
      ru: "Telegram-бот для личных чатов: задачи, согласования, заявки на вход и бюджетные инциденты через polling getUpdates.",
    },
    localPath: "packages/plugins/telegram-operator-bot",
    tag: "bundled",
    categories: ["connector", "automation"],
  },
  {
    packageName: "@paperclipai/plugin-author-voice-profiles",
    pluginKey: "paperclip.author-voice-profiles",
    displayName: { en: "Author Voice Profiles", ru: "Профили авторского стиля" },
    description: {
      en: "Per-channel author style profiles for editorial workflows and Telegram rewrites.",
      ru: "Профили авторского стиля по каналам для редакционных сценариев и рерайта постов в Telegram.",
    },
    localPath: "packages/plugins/author-voice-profiles",
    tag: "bundled",
    categories: ["ui", "automation"],
  },
  {
    packageName: "@paperclipai/plugin-web-content-import",
    pluginKey: "paperclip.web-content-import",
    displayName: { en: "Web Content Import", ru: "Импорт текста по ссылке" },
    description: {
      en: "Simple URL import surface that extracts clean source text into the Paperclip editorial flow.",
      ru: "Простой импорт по ссылке, который извлекает чистый исходный текст в редакционный поток Paperclip.",
    },
    localPath: "packages/plugins/web-content-import",
    tag: "bundled",
    categories: ["automation", "ui"],
  },
  {
    packageName: "@paperclipai/plugin-feed-sources",
    pluginKey: "paperclip.feed-sources",
    displayName: { en: "Feed Sources", ru: "Источники ленты" },
    description: {
      en: "Laconic RSS, Atom, and web source intake configuration for editorial queues.",
      ru: "Лаконичная настройка RSS, Atom и веб-источников для редакционной очереди.",
    },
    localPath: "packages/plugins/feed-sources",
    tag: "bundled",
    categories: ["automation", "ui"],
  },
];

export function listBundledPluginExamples(options?: { includeDevOnly?: boolean }): BundledPluginExample[] {
  return BUNDLED_PLUGIN_EXAMPLES.flatMap((plugin) => {
    if (plugin.devOnly && options?.includeDevOnly === false) return [];
    const absoluteLocalPath = path.resolve(REPO_ROOT, plugin.localPath);
    if (!existsSync(absoluteLocalPath)) return [];
    return [{ ...plugin, localPath: absoluteLocalPath }];
  });
}

export function listBundledProductPlugins(): BundledPluginExample[] {
  return listBundledPluginExamples({ includeDevOnly: false })
    .filter((plugin) => plugin.tag === "bundled");
}

export function findBundledPluginCatalogEntry(pluginKey: string): BundledPluginExample | null {
  return listBundledPluginExamples().find((plugin) => plugin.pluginKey === pluginKey) ?? null;
}
