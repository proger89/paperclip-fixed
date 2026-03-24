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
  },
  {
    packageName: "@paperclipai/plugin-file-browser-example",
    pluginKey: "paperclip-file-browser-example",
    displayName: "File Browser (Example)",
    description: "Example plugin that adds a Files link in project navigation plus a project detail file browser.",
    localPath: "packages/plugins/examples/plugin-file-browser-example",
    tag: "example",
    categories: ["workspace", "ui"],
  },
  {
    packageName: "@paperclipai/plugin-kitchen-sink-example",
    pluginKey: "paperclip-kitchen-sink-example",
    displayName: "Kitchen Sink (Example)",
    description: "Reference plugin that demonstrates the current Paperclip plugin API surface, bridge flows, UI extension surfaces, jobs, webhooks, tools, streams, and trusted local workspace/process demos.",
    localPath: "packages/plugins/examples/plugin-kitchen-sink-example",
    tag: "example",
    categories: ["ui", "automation", "workspace", "connector"],
  },
  {
    packageName: "@paperclipai/plugin-authoring-smoke-example",
    pluginKey: "paperclipai.plugin-authoring-smoke-example",
    displayName: "Plugin Authoring Smoke Example",
    description: "Minimal connector example used to validate local plugin authoring and install flows.",
    localPath: "packages/plugins/examples/plugin-authoring-smoke-example",
    tag: "example",
    categories: ["connector"],
  },
  {
    packageName: "@paperclipai/plugin-telegram-channel-connector",
    pluginKey: "paperclip.telegram-channel-connector",
    displayName: "Telegram Channel Connector",
    description: "Bundled Telegram connector with company dashboard, issue-level publish handoff, approval-aware publishing, and Telegram work product tracking.",
    localPath: "packages/plugins/telegram-channel-connector",
    tag: "bundled",
    categories: ["connector", "ui"],
  },
];

export function listBundledPluginExamples(): BundledPluginExample[] {
  return BUNDLED_PLUGIN_EXAMPLES.flatMap((plugin) => {
    const absoluteLocalPath = path.resolve(REPO_ROOT, plugin.localPath);
    if (!existsSync(absoluteLocalPath)) return [];
    return [{ ...plugin, localPath: absoluteLocalPath }];
  });
}
