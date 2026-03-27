import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function read(relativePath) {
  return await fs.readFile(path.join(repoRoot, relativePath), "utf8");
}

function assertIncludes(haystack, needle, message) {
  if (!haystack.includes(needle)) {
    throw new Error(message);
  }
}

function assertExcludes(haystack, needle, message) {
  if (haystack.includes(needle)) {
    throw new Error(message);
  }
}

const [
  agentAuthJwt,
  heartbeatService,
  ceoAgentsMarkdown,
  telegramPublishingPackageJson,
  telegramOperatorPackageJson,
] = await Promise.all([
  read("server/dist/agent-auth-jwt.js"),
  read("server/dist/services/heartbeat.js"),
  read("server/dist/onboarding-assets/ceo/AGENTS.md"),
  read("packages/plugins/telegram-publishing/package.json"),
  read("packages/plugins/telegram-operator-bot/package.json"),
]);

assertIncludes(
  agentAuthJwt,
  "BETTER_AUTH_SECRET",
  "server/dist/agent-auth-jwt.js is missing BETTER_AUTH_SECRET fallback",
);
assertIncludes(
  heartbeatService,
  "local_agent_jwt_unavailable",
  "server/dist/services/heartbeat.js is missing authenticated fail-fast error code",
);
assertIncludes(
  heartbeatService,
  "Using agent home workspace",
  "server/dist/services/heartbeat.js is missing updated agent-home workspace log wording",
);
assertIncludes(
  heartbeatService,
  "Starting a fresh session",
  "server/dist/services/heartbeat.js is missing updated fresh-session wording",
);
assertIncludes(
  ceoAgentsMarkdown,
  "$PAPERCLIP_INSTRUCTIONS_DIR/HEARTBEAT.md",
  "server/dist/onboarding-assets/ceo/AGENTS.md still references the old AGENT_HOME contract",
);
assertExcludes(
  ceoAgentsMarkdown,
  "$AGENT_HOME/HEARTBEAT.md",
  "server/dist/onboarding-assets/ceo/AGENTS.md still references $AGENT_HOME/HEARTBEAT.md",
);
assertExcludes(
  ceoAgentsMarkdown,
  "$AGENT_HOME/SOUL.md",
  "server/dist/onboarding-assets/ceo/AGENTS.md still references $AGENT_HOME/SOUL.md",
);
assertExcludes(
  ceoAgentsMarkdown,
  "$AGENT_HOME/TOOLS.md",
  "server/dist/onboarding-assets/ceo/AGENTS.md still references $AGENT_HOME/TOOLS.md",
);

const telegramPublishingPackage = JSON.parse(telegramPublishingPackageJson);
const telegramPublishingManifestPath = path.join(
  repoRoot,
  "packages/plugins/telegram-publishing",
  telegramPublishingPackage.paperclipPlugin.manifest,
);
const telegramPublishingWorkerPath = path.join(
  repoRoot,
  "packages/plugins/telegram-publishing",
  telegramPublishingPackage.paperclipPlugin.worker,
);

const telegramOperatorPackage = JSON.parse(telegramOperatorPackageJson);
const telegramOperatorManifestPath = path.join(
  repoRoot,
  "packages/plugins/telegram-operator-bot",
  telegramOperatorPackage.paperclipPlugin.manifest,
);
const telegramOperatorWorkerPath = path.join(
  repoRoot,
  "packages/plugins/telegram-operator-bot",
  telegramOperatorPackage.paperclipPlugin.worker,
);

await Promise.all([
  fs.access(telegramPublishingManifestPath),
  fs.access(telegramPublishingWorkerPath),
  fs.access(telegramOperatorManifestPath),
  fs.access(telegramOperatorWorkerPath),
]);

console.log("Docker runtime build verification passed.");
