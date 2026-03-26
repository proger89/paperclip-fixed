import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { PluginCategory } from "@paperclipai/shared";

export interface BundledPluginExample {
  packageName: string;
  pluginKey: string;
  displayName: string;
  description: string;
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
    displayName: "Hello World Widget (Example)",
    description: "Reference UI plugin that adds a simple Hello World widget to the Paperclip dashboard.",
    localPath: "packages/plugins/examples/plugin-hello-world-example",
    tag: "example",
    categories: ["ui"],
    devOnly: true,
  },
  {
    packageName: "@paperclipai/plugin-file-browser-example",
    pluginKey: "paperclip-file-browser-example",
    displayName: "File Browser (Example)",
    description: "Example plugin that adds a Files link in project navigation plus a project detail file browser.",
    localPath: "packages/plugins/examples/plugin-file-browser-example",
    tag: "example",
    categories: ["workspace", "ui"],
    devOnly: true,
  },
  {
    packageName: "@paperclipai/plugin-kitchen-sink-example",
    pluginKey: "paperclip-kitchen-sink-example",
    displayName: "Kitchen Sink (Example)",
    description: "Reference plugin that demonstrates the current Paperclip plugin API surface, bridge flows, UI extension surfaces, jobs, webhooks, tools, streams, and trusted local workspace/process demos.",
    localPath: "packages/plugins/examples/plugin-kitchen-sink-example",
    tag: "example",
    categories: ["ui", "automation", "workspace", "connector"],
    devOnly: true,
  },
  {
    packageName: "@paperclipai/plugin-authoring-smoke-example",
    pluginKey: "paperclipai.plugin-authoring-smoke-example",
    displayName: "Plugin Authoring Smoke Example",
    description: "Minimal connector example used to validate local plugin authoring and install flows.",
    localPath: "packages/plugins/examples/plugin-authoring-smoke-example",
    tag: "example",
    categories: ["connector"],
    devOnly: true,
  },
  {
    packageName: "@paperclipai/plugin-telegram-publishing",
    pluginKey: "paperclip.telegram-publishing",
    displayName: "Telegram Publishing",
    description: "Laconic Telegram publishing surface with channel setup, donor channels, ready-for-approval queue, and governed dispatch.",
    localPath: "packages/plugins/telegram-publishing",
    tag: "bundled",
    categories: ["connector", "ui"],
  },
  {
    packageName: "@paperclipai/plugin-telegram-operator-bot",
    pluginKey: "paperclip.telegram-operator-bot",
    displayName: "Telegram Operator Bot",
    description: "Private-chat Telegram bot for tasks, approvals, joins, and budget incidents over getUpdates polling.",
    localPath: "packages/plugins/telegram-operator-bot",
    tag: "bundled",
    categories: ["connector", "automation"],
  },
  {
    packageName: "@paperclipai/plugin-author-voice-profiles",
    pluginKey: "paperclip.author-voice-profiles",
    displayName: "Author Voice Profiles",
    description: "Per-channel author style profiles for editorial workflows and Telegram rewrites.",
    localPath: "packages/plugins/author-voice-profiles",
    tag: "bundled",
    categories: ["ui", "automation"],
  },
  {
    packageName: "@paperclipai/plugin-web-content-import",
    pluginKey: "paperclip.web-content-import",
    displayName: "Web Content Import",
    description: "Simple URL import surface that extracts clean source text into the Paperclip editorial flow.",
    localPath: "packages/plugins/web-content-import",
    tag: "bundled",
    categories: ["automation", "ui"],
  },
  {
    packageName: "@paperclipai/plugin-feed-sources",
    pluginKey: "paperclip.feed-sources",
    displayName: "Feed Sources",
    description: "Laconic RSS, Atom, and web source intake configuration for editorial queues.",
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
