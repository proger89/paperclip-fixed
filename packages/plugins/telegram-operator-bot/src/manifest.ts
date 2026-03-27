import type { PaperclipPluginManifestV1 } from "@paperclipai/plugin-sdk";
import {
  DEFAULT_CONFIG,
  EXPORT_NAMES,
  JOB_KEYS,
  PAGE_ROUTE,
  PLUGIN_ID,
  PLUGIN_VERSION,
  SLOT_IDS,
} from "./constants.js";

const manifest: PaperclipPluginManifestV1 = {
  id: PLUGIN_ID,
  apiVersion: 1,
  version: PLUGIN_VERSION,
  displayName: {
    en: "Telegram Operator Bot",
    ru: "Telegram-бот оператора",
  },
  description: {
    en: "Private-chat Telegram operator bot for tasks, approvals, joins, budgets, and controlled Paperclip replies over getUpdates polling.",
    ru: "Telegram-бот для личных чатов: задачи, approvals, joins, бюджеты и управляемые ответы Paperclip через polling getUpdates.",
  },
  author: "Paperclip",
  categories: ["connector", "ui"],
  capabilities: [
    "companies.read",
    "projects.read",
    "routines.read",
    "routines.write",
    "issues.read",
    "issues.create",
    "issues.update",
    "issue.comments.read",
    "issue.comments.create",
    "issue.documents.read",
    "issue.documents.write",
    "approvals.read",
    "approval.comments.read",
    "approval.comments.create",
    "approvals.resolve",
    "joins.read",
    "joins.resolve",
    "budgets.read",
    "budgets.resolve",
    "agents.read",
    "agents.invoke",
    "activity.read",
    "http.outbound",
    "secrets.read-ref",
    "plugin.state.read",
    "plugin.state.write",
    "activity.log.write",
    "metrics.write",
    "jobs.schedule",
    "instance.settings.register",
    "ui.page.register",
  ],
  jobs: [
    {
      jobKey: JOB_KEYS.syncTelegram,
      displayName: {
        en: "Sync Telegram operator bot",
        ru: "Синхронизация Telegram-бота оператора",
      },
      description: {
        en: "Poll Telegram getUpdates and reconcile private-chat control-plane notifications.",
        ru: "Опрашивает Telegram через getUpdates и синхронизирует control-plane уведомления в личных чатах.",
      },
      schedule: "* * * * *",
    },
  ],
  entrypoints: {
    worker: "./dist/src/worker.js",
    ui: "./dist/ui",
  },
  instanceConfigSchema: {
    type: "object",
    properties: {
      botTokenSecretRef: {
        type: "string",
        title: { en: "Legacy Bot Token Secret", ru: "Legacy-секрет токена бота" },
        description: {
          en: "Legacy instance-scoped secret UUID. Prefer company-scoped operator settings instead.",
          ru: "Legacy UUID секрета на уровне инстанса. Предпочтительнее использовать company-scoped настройки operator bot.",
        },
        format: "secret-ref",
        default: DEFAULT_CONFIG.botTokenSecretRef,
      },
    },
  },
  ui: {
    slots: [
      {
        type: "settingsPage",
        id: SLOT_IDS.settingsPage,
        displayName: {
          en: "Telegram Operator Settings",
          ru: "Настройки Telegram-бота оператора",
        },
        exportName: EXPORT_NAMES.settingsPage,
      },
      {
        type: "page",
        id: SLOT_IDS.page,
        displayName: {
          en: "Telegram Operator Bot",
          ru: "Telegram-бот оператора",
        },
        exportName: EXPORT_NAMES.page,
        routePath: PAGE_ROUTE,
      },
    ],
  },
};

export default manifest;
