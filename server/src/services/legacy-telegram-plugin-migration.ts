import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Db } from "@paperclipai/db";
import { logger } from "../middleware/logger.js";
import { pluginCompanySettingsService } from "./plugin-company-settings.js";
import type { PluginLifecycleManager } from "./plugin-lifecycle.js";
import type { PluginLoader } from "./plugin-loader.js";
import { pluginRegistryService } from "./plugin-registry.js";
import { pluginStateStore } from "./plugin-state-store.js";

const LEGACY_PLUGIN_KEY = "paperclip.telegram-channel-connector";
const TELEGRAM_PUBLISHING_PLUGIN_KEY = "paperclip.telegram-publishing";
const TELEGRAM_OPERATOR_PLUGIN_KEY = "paperclip.telegram-operator-bot";
const LEGACY_PUBLISHING_ENTITY_TYPES = new Set([
  "telegram-message",
  "telegram-publication-job",
  "telegram-source-message",
]);
const LEGACY_OPERATOR_ENTITY_TYPES = new Set([
  "telegram-linked-chat",
  "telegram-claim-code",
  "telegram-thread-link",
  "telegram-issue-watcher",
]);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../..");

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? structuredClone(value as Record<string, unknown>)
    : {};
}

function migratePublishingSettings(value: unknown) {
  const next = asRecord(value);
  const taskBot = next.taskBot && typeof next.taskBot === "object" && !Array.isArray(next.taskBot)
    ? structuredClone(next.taskBot as Record<string, unknown>)
    : {};
  taskBot.enabled = false;
  next.taskBot = taskBot;
  return next;
}

function migrateOperatorSettings(value: unknown) {
  const next = asRecord(value);
  const publishing = next.publishing && typeof next.publishing === "object" && !Array.isArray(next.publishing)
    ? structuredClone(next.publishing as Record<string, unknown>)
    : {};
  const taskBot = next.taskBot && typeof next.taskBot === "object" && !Array.isArray(next.taskBot)
    ? structuredClone(next.taskBot as Record<string, unknown>)
    : {};
  publishing.defaultChatId = "";
  publishing.defaultPublicHandle = "";
  publishing.defaultParseMode = "";
  publishing.defaultDisableLinkPreview = false;
  publishing.defaultDisableNotification = false;
  publishing.destinations = [];
  publishing.defaultDestinationId = "";
  next.publishing = publishing;
  next.ingestion = { sources: [] };
  taskBot.enabled = taskBot.enabled !== false;
  next.taskBot = taskBot;
  return next;
}

async function ensureLocalPluginInstalled(
  registry: ReturnType<typeof pluginRegistryService>,
  loader: PluginLoader,
  pluginKey: string,
  relativeLocalPath: string,
) {
  const existing = await registry.getByKey(pluginKey);
  if (existing && existing.status !== "uninstalled") {
    return existing;
  }

  const localPath = path.resolve(REPO_ROOT, relativeLocalPath);
  await loader.installPlugin({ localPath });
  const installed = await registry.getByKey(pluginKey);
  if (!installed) {
    throw new Error(`Failed to install split Telegram plugin: ${pluginKey}`);
  }
  if (installed.status !== "ready") {
    await registry.updateStatus(installed.id, { status: "ready", lastError: null });
  }
  return (await registry.getById(installed.id)) ?? installed;
}

export async function migrateLegacyTelegramPlugin(
  db: Db,
  loader: PluginLoader,
  _lifecycle: PluginLifecycleManager,
) {
  const registry = pluginRegistryService(db);
  const pluginSettings = pluginCompanySettingsService(db);
  const stateStore = pluginStateStore(db);

  const legacy = await registry.getByKey(LEGACY_PLUGIN_KEY);
  if (!legacy || legacy.status === "uninstalled") return;

  logger.info({ pluginId: legacy.id }, "migrating legacy Telegram plugin into publishing/operator split");

  const [publishingPlugin, operatorPlugin] = await Promise.all([
    ensureLocalPluginInstalled(
      registry,
      loader,
      TELEGRAM_PUBLISHING_PLUGIN_KEY,
      "packages/plugins/telegram-publishing",
    ),
    ensureLocalPluginInstalled(
      registry,
      loader,
      TELEGRAM_OPERATOR_PLUGIN_KEY,
      "packages/plugins/telegram-operator-bot",
    ),
  ]);

  const [settingsRows, entityRows, stateRows] = await Promise.all([
    pluginSettings.listByPlugin(legacy.id),
    registry.listEntities(legacy.id, { limit: 2_000, offset: 0 }),
    stateStore.list(legacy.id),
  ]);

  for (const row of settingsRows) {
    const [existingPublishing, existingOperator] = await Promise.all([
      pluginSettings.get(publishingPlugin.id, row.companyId),
      pluginSettings.get(operatorPlugin.id, row.companyId),
    ]);

    if (!existingPublishing) {
      await pluginSettings.upsert({
        pluginId: publishingPlugin.id,
        companyId: row.companyId,
        enabled: row.enabled,
        settingsJson: migratePublishingSettings(row.settingsJson),
        lastError: row.lastError,
      });
    }

    if (!existingOperator) {
      await pluginSettings.upsert({
        pluginId: operatorPlugin.id,
        companyId: row.companyId,
        enabled: row.enabled,
        settingsJson: migrateOperatorSettings(row.settingsJson),
        lastError: row.lastError,
      });
    }
  }

  for (const entity of entityRows) {
    if (LEGACY_PUBLISHING_ENTITY_TYPES.has(entity.entityType)) {
      await registry.upsertEntity(publishingPlugin.id, {
        entityType: entity.entityType,
        scopeKind: entity.scopeKind,
        scopeId: entity.scopeId ?? undefined,
        externalId: entity.externalId ?? undefined,
        title: entity.title ?? undefined,
        status: entity.status ?? undefined,
        data: entity.data,
      });
    }
    if (LEGACY_OPERATOR_ENTITY_TYPES.has(entity.entityType)) {
      await registry.upsertEntity(operatorPlugin.id, {
        entityType: entity.entityType,
        scopeKind: entity.scopeKind,
        scopeId: entity.scopeId ?? undefined,
        externalId: entity.externalId ?? undefined,
        title: entity.title ?? undefined,
        status: entity.status ?? undefined,
        data: entity.data,
      });
    }
  }

  for (const row of stateRows) {
    if (
      row.stateKey === "last-validation"
      || row.stateKey === "last-publication"
      || row.stateKey === "bot-health"
      || row.stateKey.startsWith("source-routine:")
    ) {
      await stateStore.set(publishingPlugin.id, {
        scopeKind: row.scopeKind,
        scopeId: row.scopeId ?? undefined,
        namespace: row.namespace,
        stateKey: row.stateKey,
        value: row.valueJson,
      });
    }

    if (row.stateKey !== "last-publication" && !row.stateKey.startsWith("source-routine:")) {
      await stateStore.set(operatorPlugin.id, {
        scopeKind: row.scopeKind,
        scopeId: row.scopeId ?? undefined,
        namespace: row.namespace,
        stateKey: row.stateKey,
        value: row.valueJson,
      });
    }
  }

  await registry.uninstall(legacy.id, false);
  logger.info({ pluginId: legacy.id }, "legacy Telegram plugin migration complete");
}
