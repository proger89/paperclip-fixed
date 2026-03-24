import {
  definePlugin,
  runWorker,
  type PluginContext,
} from "@paperclipai/plugin-sdk";
import {
  ACTION_KEYS,
  DATA_KEYS,
  DEFAULT_CONFIG,
  PLUGIN_ID,
  TELEGRAM_MAX_MESSAGE_LENGTH,
} from "./constants.js";

type TelegramConfig = {
  botTokenSecretRef?: string;
  defaultChatId?: string;
  defaultPublicHandle?: string;
  defaultParseMode?: "" | "HTML" | "MarkdownV2";
  defaultDisableLinkPreview?: boolean;
  defaultDisableNotification?: boolean;
};

type TelegramApiSuccess<T> = {
  ok: true;
  result: T;
};

type TelegramApiFailure = {
  ok: false;
  description?: string;
  error_code?: number;
};

type TelegramUser = {
  id: number;
  is_bot: boolean;
  first_name: string;
  username?: string;
  can_join_groups?: boolean;
  can_read_all_group_messages?: boolean;
};

type TelegramChat = {
  id: number;
  type: string;
  title?: string;
  username?: string;
};

type TelegramMessage = {
  message_id: number;
  date: number;
  text?: string;
  chat: TelegramChat;
};

type PublicationRecord = {
  externalId: string;
  issueId: string | null;
  issueIdentifier: string | null;
  issueTitle: string | null;
  companyId: string;
  destinationLabel: string;
  chatId: string;
  chatTitle: string | null;
  publicHandle: string | null;
  messageId: number;
  url: string | null;
  approvalId: string | null;
  parseMode: string | null;
  sentAt: string;
  summary: string;
};

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function trimToNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function sanitizePublicHandle(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = value
    .trim()
    .replace(/^https?:\/\/t\.me\//i, "")
    .replace(/^@+/, "")
    .replace(/\/+$/, "");
  return normalized.length > 0 ? normalized : null;
}

function excerpt(text: string, limit = 180): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= limit) return normalized;
  return `${normalized.slice(0, Math.max(0, limit - 1)).trimEnd()}…`;
}

async function getConfig(ctx: PluginContext): Promise<TelegramConfig> {
  const raw = await ctx.config.get();
  return {
    ...DEFAULT_CONFIG,
    ...(raw as TelegramConfig),
  };
}

async function resolveBotToken(ctx: PluginContext, config: TelegramConfig): Promise<string> {
  const secretRef = trimToNull(config.botTokenSecretRef);
  if (!secretRef) {
    throw new Error("Telegram bot token secret is not configured");
  }
  return await ctx.secrets.resolve(secretRef);
}

async function telegramRequest<T>(
  ctx: PluginContext,
  token: string,
  method: string,
  body?: Record<string, unknown>,
): Promise<T> {
  const response = await ctx.http.fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: body ? "POST" : "GET",
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });

  const payload = await response.json() as TelegramApiSuccess<T> | TelegramApiFailure;
  if (!response.ok || !payload.ok) {
    const description = "description" in payload && typeof payload.description === "string"
      ? payload.description
      : `Telegram request failed (${response.status})`;
    throw new Error(description);
  }

  return payload.result;
}

function buildTelegramMessageUrl(input: {
  publicHandle?: string | null;
  chat?: TelegramChat | null;
  chatId?: string | null;
  messageId: number;
}): string | null {
  const handle = sanitizePublicHandle(
    input.publicHandle
    ?? input.chat?.username
    ?? input.chatId,
  );
  if (!handle || handle.startsWith("-")) return null;
  return `https://t.me/${handle}/${input.messageId}`;
}

async function listRecentPublications(
  ctx: PluginContext,
  companyId: string,
  limit = 10,
): Promise<PublicationRecord[]> {
  const entities = await ctx.entities.list({ entityType: "telegram-message", limit: 100, offset: 0 });
  return entities
    .map((entity) => entity.data as Partial<PublicationRecord>)
    .filter((entity): entity is PublicationRecord =>
      entity.companyId === companyId
      && typeof entity.externalId === "string"
      && typeof entity.chatId === "string"
      && typeof entity.destinationLabel === "string"
      && typeof entity.sentAt === "string"
      && typeof entity.summary === "string",
    )
    .sort((left, right) => right.sentAt.localeCompare(left.sentAt))
    .slice(0, limit);
}

async function setCompanyState(ctx: PluginContext, companyId: string, stateKey: string, value: unknown): Promise<void> {
  await ctx.state.set({ scopeKind: "company", scopeId: companyId, stateKey }, value);
}

async function getCompanyState<T = unknown>(ctx: PluginContext, companyId: string, stateKey: string): Promise<T | null> {
  return await ctx.state.get({ scopeKind: "company", scopeId: companyId, stateKey }) as T | null;
}

const plugin = definePlugin({
  async setup(ctx) {
    ctx.data.register(DATA_KEYS.overview, async (params) => {
      const companyId = trimToNull(params.companyId) ?? "";
      if (!companyId) {
        return {
          configured: false,
          recentPublications: [],
        };
      }

      const config = await getConfig(ctx);
      const lastValidation = await getCompanyState(ctx, companyId, "last-validation");
      const lastPublication = await getCompanyState(ctx, companyId, "last-publication");
      const recentPublications = await listRecentPublications(ctx, companyId);
      return {
        configured: Boolean(trimToNull(config.botTokenSecretRef) && trimToNull(config.defaultChatId)),
        config: {
          defaultChatId: trimToNull(config.defaultChatId),
          defaultPublicHandle: sanitizePublicHandle(config.defaultPublicHandle),
          defaultParseMode: trimToNull(config.defaultParseMode),
          defaultDisableLinkPreview: config.defaultDisableLinkPreview === true,
          defaultDisableNotification: config.defaultDisableNotification === true,
        },
        lastValidation,
        lastPublication,
        recentPublications,
      };
    });

    ctx.data.register(DATA_KEYS.issuePublications, async (params) => {
      const companyId = trimToNull(params.companyId) ?? "";
      const issueId = trimToNull(params.issueId) ?? "";
      if (!companyId || !issueId) return [];

      const entities = await ctx.entities.list({
        entityType: "telegram-message",
        scopeKind: "issue",
        scopeId: issueId,
        limit: 50,
        offset: 0,
      });

      return entities
        .map((entity) => entity.data as Partial<PublicationRecord>)
        .filter((entity): entity is PublicationRecord => entity.companyId === companyId && entity.issueId === issueId)
        .sort((left, right) => right.sentAt.localeCompare(left.sentAt));
    });

    ctx.actions.register(ACTION_KEYS.testConnection, async (params) => {
      const companyId = trimToNull(params.companyId) ?? "";
      if (!companyId) throw new Error("companyId is required");

      const config = await getConfig(ctx);
      const token = await resolveBotToken(ctx, config);
      const bot = await telegramRequest<TelegramUser>(ctx, token, "getMe");
      const defaultChatId = trimToNull(config.defaultChatId);
      const defaultChat = defaultChatId
        ? await telegramRequest<TelegramChat>(ctx, token, "getChat", { chat_id: defaultChatId })
        : null;

      const result = {
        connected: true,
        checkedAt: new Date().toISOString(),
        bot: {
          id: bot.id,
          username: bot.username ?? null,
          firstName: bot.first_name,
          canJoinGroups: bot.can_join_groups ?? null,
          canReadAllGroupMessages: bot.can_read_all_group_messages ?? null,
        },
        defaultChat: defaultChat
          ? {
              id: String(defaultChat.id),
              title: defaultChat.title ?? null,
              username: defaultChat.username ?? null,
              type: defaultChat.type,
            }
          : null,
      };

      await setCompanyState(ctx, companyId, "last-validation", result);
      await ctx.metrics.write("telegram.connection_test", 1, { companyId, success: "true" });
      return result;
    });

    ctx.actions.register(ACTION_KEYS.publishMessage, async (params) => {
      const companyId = trimToNull(params.companyId) ?? "";
      if (!companyId) throw new Error("companyId is required");

      const issueId = trimToNull(params.issueId);
      const issueIdentifier = trimToNull(params.issueIdentifier);
      const issueTitle = trimToNull(params.issueTitle);
      const approvalId = trimToNull(params.approvalId);
      const text = asString(params.text).trim();
      if (!text) throw new Error("Message text is required");
      if (text.length > TELEGRAM_MAX_MESSAGE_LENGTH) {
        throw new Error(`Telegram messages must be ${TELEGRAM_MAX_MESSAGE_LENGTH} characters or fewer`);
      }

      const config = await getConfig(ctx);
      const token = await resolveBotToken(ctx, config);
      const chatId = trimToNull(params.chatId) ?? trimToNull(config.defaultChatId);
      if (!chatId) throw new Error("Target chat_id is required");

      const parseMode = trimToNull(params.parseMode) ?? trimToNull(config.defaultParseMode);
      const disableNotification =
        typeof params.disableNotification === "boolean"
          ? params.disableNotification
          : config.defaultDisableNotification === true;
      const disableLinkPreview =
        typeof params.disableLinkPreview === "boolean"
          ? params.disableLinkPreview
          : config.defaultDisableLinkPreview === true;
      const publicHandle =
        sanitizePublicHandle(trimToNull(params.publicHandle))
        ?? sanitizePublicHandle(config.defaultPublicHandle)
        ?? sanitizePublicHandle(chatId);

      const message = await telegramRequest<TelegramMessage>(ctx, token, "sendMessage", {
        chat_id: chatId,
        text,
        ...(parseMode ? { parse_mode: parseMode } : {}),
        ...(disableNotification ? { disable_notification: true } : {}),
        ...(disableLinkPreview ? { link_preview_options: { is_disabled: true } } : {}),
      });

      const sentAt = new Date((message.date ?? Math.floor(Date.now() / 1000)) * 1000).toISOString();
      const destinationLabel =
        trimToNull(params.destinationLabel)
        ?? (publicHandle ? `@${publicHandle}` : null)
        ?? trimToNull(message.chat.title)
        ?? chatId;
      const publicationRecord: PublicationRecord = {
        externalId: `${message.chat.id}:${message.message_id}`,
        issueId,
        issueIdentifier,
        issueTitle,
        companyId,
        destinationLabel,
        chatId: String(message.chat.id),
        chatTitle: message.chat.title ?? null,
        publicHandle,
        messageId: message.message_id,
        url: buildTelegramMessageUrl({
          publicHandle,
          chat: message.chat,
          chatId,
          messageId: message.message_id,
        }),
        approvalId,
        parseMode,
        sentAt,
        summary: excerpt(text),
      };

      await ctx.entities.upsert({
        entityType: "telegram-message",
        scopeKind: issueId ? "issue" : "company",
        scopeId: issueId ?? companyId,
        externalId: publicationRecord.externalId,
        title: issueIdentifier
          ? `Telegram publish for ${issueIdentifier}`
          : `Telegram publish ${publicationRecord.externalId}`,
        status: "published",
        data: publicationRecord,
      });

      await setCompanyState(ctx, companyId, "last-publication", publicationRecord);
      await ctx.activity.log({
        companyId,
        message: `Published Telegram message to ${destinationLabel}`,
        entityType: issueId ? "issue" : "company",
        entityId: issueId ?? companyId,
        metadata: {
          pluginId: PLUGIN_ID,
          approvalId,
          externalId: publicationRecord.externalId,
          url: publicationRecord.url,
          destinationLabel,
        },
      });
      await ctx.metrics.write("telegram.publish", 1, {
        companyId,
        destination: destinationLabel,
        has_url: publicationRecord.url ? "true" : "false",
      });

      return publicationRecord;
    });
  },

  async onHealth() {
    return {
      status: "ok",
      message: "Telegram connector worker is ready",
    };
  },

  async onValidateConfig(config) {
    const errors: string[] = [];
    const warnings: string[] = [];
    const typedConfig = {
      ...DEFAULT_CONFIG,
      ...(config as TelegramConfig),
    };

    if (!trimToNull(typedConfig.botTokenSecretRef)) {
      warnings.push("Bot token secret is not set yet.");
    }
    if (!trimToNull(typedConfig.defaultChatId)) {
      warnings.push("Default chat/channel is not configured yet.");
    }
    if (trimToNull(typedConfig.defaultParseMode) && !["HTML", "MarkdownV2"].includes(String(typedConfig.defaultParseMode))) {
      errors.push("Default parse mode must be HTML or MarkdownV2.");
    }

    return {
      ok: errors.length === 0,
      warnings,
      errors,
    };
  },
});

export default plugin;
runWorker(plugin, import.meta.url);
