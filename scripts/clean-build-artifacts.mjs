import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const DIRECTORIES_TO_REMOVE = [
  "server/dist",
  "server/ui-dist",
  "ui/dist",
  "ui-dist",
  "cli/dist",
  "packages/db/dist",
  "packages/shared/dist",
  "packages/adapter-utils/dist",
  "packages/plugins/sdk/dist",
  "packages/plugins/create-paperclip-plugin/dist",
  "packages/plugins/examples/plugin-hello-world-example/dist",
  "packages/plugins/examples/plugin-file-browser-example/dist",
  "packages/plugins/examples/plugin-kitchen-sink-example/dist",
  "packages/plugins/examples/plugin-authoring-smoke-example/dist",
  "packages/plugins/telegram-publishing/dist",
  "packages/plugins/telegram-operator-bot/dist",
  "packages/plugins/author-voice-profiles/dist",
  "packages/plugins/web-content-import/dist",
  "packages/plugins/feed-sources/dist",
  "packages/adapters/claude-local/dist",
  "packages/adapters/codex-local/dist",
  "packages/adapters/cursor-local/dist",
  "packages/adapters/gemini-local/dist",
  "packages/adapters/openclaw-gateway/dist",
  "packages/adapters/opencode-local/dist",
  "packages/adapters/pi-local/dist",
];

const FILES_TO_REMOVE = [
  "server/tsconfig.tsbuildinfo",
  "ui/tsconfig.tsbuildinfo",
  "cli/tsconfig.tsbuildinfo",
  "packages/db/tsconfig.tsbuildinfo",
  "packages/shared/tsconfig.tsbuildinfo",
  "packages/adapter-utils/tsconfig.tsbuildinfo",
  "packages/plugins/sdk/tsconfig.tsbuildinfo",
  "packages/plugins/create-paperclip-plugin/tsconfig.tsbuildinfo",
  "packages/plugins/examples/plugin-hello-world-example/tsconfig.tsbuildinfo",
  "packages/plugins/examples/plugin-file-browser-example/tsconfig.tsbuildinfo",
  "packages/plugins/examples/plugin-kitchen-sink-example/tsconfig.tsbuildinfo",
  "packages/plugins/examples/plugin-authoring-smoke-example/tsconfig.tsbuildinfo",
  "packages/plugins/telegram-publishing/tsconfig.tsbuildinfo",
  "packages/plugins/telegram-operator-bot/tsconfig.tsbuildinfo",
  "packages/plugins/author-voice-profiles/tsconfig.tsbuildinfo",
  "packages/plugins/web-content-import/tsconfig.tsbuildinfo",
  "packages/plugins/feed-sources/tsconfig.tsbuildinfo",
  "packages/adapters/claude-local/tsconfig.tsbuildinfo",
  "packages/adapters/codex-local/tsconfig.tsbuildinfo",
  "packages/adapters/cursor-local/tsconfig.tsbuildinfo",
  "packages/adapters/gemini-local/tsconfig.tsbuildinfo",
  "packages/adapters/openclaw-gateway/tsconfig.tsbuildinfo",
  "packages/adapters/opencode-local/tsconfig.tsbuildinfo",
  "packages/adapters/pi-local/tsconfig.tsbuildinfo",
];

async function removePath(relativePath) {
  await fs.rm(path.join(repoRoot, relativePath), { recursive: true, force: true });
}

await Promise.all([
  ...DIRECTORIES_TO_REMOVE.map((relativePath) => removePath(relativePath)),
  ...FILES_TO_REMOVE.map((relativePath) => removePath(relativePath)),
]);
