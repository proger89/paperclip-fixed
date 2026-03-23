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
