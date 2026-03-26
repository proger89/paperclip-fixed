import { useEffect, useMemo, useState, type CSSProperties, type FormEvent, type ReactNode } from "react";
import {
  usePluginAction,
  usePluginData,
  usePluginToast,
  type PluginDetailTabProps,
  type PluginPageProps,
  type PluginSettingsPageProps,
  type PluginSidebarProps,
  type PluginWidgetProps,
} from "@paperclipai/plugin-sdk/ui";
import {
  ACTION_KEYS,
  DATA_KEYS,
  DEFAULT_COMPANY_SETTINGS,
  DEFAULT_CONFIG,
  PAGE_ROUTE,
  PLUGIN_ID,
} from "../constants.js";
import type {
  LegacyTelegramConfig,
  TelegramCompanySettings,
  TelegramDestination,
  TelegramIngestionSource,
  TelegramLinkedChat,
  TelegramOverview,
  TelegramPublication,
  TelegramPublicationJob,
  TelegramSourceMessageRecord,
} from "../plugin-types.js";
import {
  companySettingsFromLegacyConfig,
  hasLegacyTelegramConfig,
  sanitizeLegacyTelegramConfig,
  sanitizeTelegramCompanySettings,
} from "../settings.js";

type CompanySecret = {
  id: string;
  name: string;
  description: string | null;
};

type PluginConfigJson = LegacyTelegramConfig;

type CompanyPluginSettingsRecord = {
  id: string;
  companyId: string;
  pluginId: string;
  enabled: boolean;
  settingsJson: TelegramCompanySettings;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
};

type IssueDocumentSummary = {
  id: string;
  key: string;
  title: string | null;
  latestRevisionNumber: number;
};

type IssueDocument = IssueDocumentSummary & {
  body: string;
};

type IssueWorkProduct = {
  id: string;
  provider: string;
  status: string;
  reviewState: string;
  title: string;
  url: string | null;
  externalId: string | null;
  summary: string | null;
  metadata: Record<string, unknown> | null;
};

type Approval = {
  id: string;
  type: string;
  status: string;
  payload: Record<string, unknown>;
  updatedAt: string;
};

type IssueDetailResponse = {
  id: string;
  identifier: string | null;
  title: string;
  projectId: string | null;
  planDocument?: IssueDocument | null;
  documentSummaries?: IssueDocumentSummary[];
  workProducts?: IssueWorkProduct[];
};

type TelegramLocale = PluginSettingsPageProps["context"]["locale"];

const layoutStack: CSSProperties = {
  display: "grid",
  gap: "14px",
};

const cardStyle: CSSProperties = {
  border: "1px solid var(--border)",
  borderRadius: "14px",
  padding: "16px",
  background: "var(--card, transparent)",
};

const sectionTitleStyle: CSSProperties = {
  fontSize: "14px",
  fontWeight: 600,
};

const rowStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: "10px",
  alignItems: "center",
};

const buttonStyle: CSSProperties = {
  appearance: "none",
  border: "1px solid var(--border)",
  borderRadius: "999px",
  background: "transparent",
  color: "inherit",
  padding: "8px 14px",
  fontSize: "12px",
  cursor: "pointer",
};

const primaryButtonStyle: CSSProperties = {
  ...buttonStyle,
  background: "var(--foreground)",
  borderColor: "var(--foreground)",
  color: "var(--background)",
};

const inputStyle: CSSProperties = {
  width: "100%",
  border: "1px solid var(--border)",
  borderRadius: "10px",
  background: "transparent",
  color: "inherit",
  padding: "9px 11px",
  fontSize: "12px",
};

const textareaStyle: CSSProperties = {
  ...inputStyle,
  minHeight: "180px",
  resize: "vertical",
  lineHeight: 1.5,
};

const mutedTextStyle: CSSProperties = {
  fontSize: "12px",
  opacity: 0.72,
  lineHeight: 1.45,
};

const TELEGRAM_LOCALE_TAG: Record<TelegramLocale, string> = {
  en: "en-US",
  ru: "ru-RU",
};

const TELEGRAM_TEXT: Record<TelegramLocale, Record<string, string>> = {
  en: {},
  ru: {
    "never": "никогда",
    "connector": "коннектор",
    "configured": "настроен",
    "needs setup": "требует настройки",
    "Ready": "Готов",
    "Needs setup": "Требует настройки",
    "Open settings": "Открыть настройки",
    "Open approval": "Открыть согласование",
    "Open latest pending approval": "Открыть последнее ожидающее согласование",
    "No pending Telegram publish approvals.": "Нет ожидающих согласований на публикацию в Telegram.",
    "No Telegram publications recorded yet.": "Публикации Telegram пока не зафиксированы.",
    "Open Telegram post": "Открыть пост в Telegram",
    "No public post URL available. Set a public handle to surface clickable links.": "Публичный URL поста пока недоступен. Укажите public handle, чтобы появились кликабельные ссылки.",
    "No scheduled Telegram publications queued.": "Запланированных публикаций Telegram в очереди пока нет.",
    "approved": "согласовано",
    "approval missing": "нет согласования",
    "No Telegram source stories ingested yet.": "Истории из Telegram пока не были загружены.",
    "No excerpt captured.": "Отрывок не сохранён.",
    "Approved": "Согласовано",
    "Publication history for this issue": "История публикаций по этой задаче",
    "Scheduled queue for this issue": "Очередь публикации по этой задаче",
    "Existing Telegram outputs": "Существующие Telegram-результаты",
    "Open Telegram link": "Открыть ссылку Telegram",
    "Active queue item": "Активный элемент очереди",
    "State": "Состояние",
    "Issue": "Задача",
    "unknown": "неизвестно",
    "Telegram work products": "Telegram-артефакты",
    "Linked Telegram approvals": "Связанные Telegram-согласования",
    "Recent issue publishes": "Недавние публикации по задаче",
    "Queued publish jobs": "Заданий публикации в очереди",
    "Latest approved publish": "Последняя согласованная публикация",
    "No approved Telegram publish approval is linked to this issue yet.": "С этой задачей пока не связано ни одно согласованное разрешение на публикацию Telegram.",
    "Telegram publish handoff": "Передача публикации Telegram",
    "Keep the draft, approval, and final Telegram post attached to this issue instead of hiding the distribution workflow in comments.": "Храните черновик, согласование и итоговый пост Telegram прямо в задаче, а не прячьте процесс публикации в комментариях.",
    "Approved to publish": "Согласовано к публикации",
    "Approval pending": "Ожидает согласования",
    "Composer": "Редактор",
    "Load issue document": "Загрузить документ задачи",
    "Use an existing issue document as the starting point, then adjust the final Telegram copy here.": "Используйте существующий документ задачи как основу, затем отредактируйте здесь финальный текст для Telegram.",
    "Select document...": "Выберите документ...",
    "Loading...": "Загрузка...",
    "Load": "Загрузить",
    "Telegram draft": "Черновик Telegram",
    "This is the exact text that will be saved for review and later sent to Telegram.": "Именно этот текст будет сохранён на согласование и позже отправлен в Telegram.",
    "Write the final Telegram post here...": "Напишите финальный пост для Telegram здесь...",
    "Configured destination": "Настроенное направление",
    "Use default destination": "Использовать направление по умолчанию",
    "(disabled)": "(отключено)",
    "Destination label": "Название направления",
    "Chat id / username": "Chat id / username",
    "Public handle": "Публичный handle",
    "Parse mode": "Режим парсинга",
    "Plain text": "Обычный текст",
    "Publish at": "Опубликовать в",
    "Disable link preview": "Отключить предпросмотр ссылок",
    "Send silently": "Отправить без уведомления",
    "Saving...": "Сохранение...",
    "Save draft output": "Сохранить черновой результат",
    "Open pending approval": "Открыть ожидающее согласование",
    "Requesting...": "Запрос...",
    "Request publish approval": "Запросить согласование публикации",
    "Scheduling...": "Планирование...",
    "Rescheduling...": "Перепланирование...",
    "Reschedule publish": "Перепланировать публикацию",
    "Schedule publish": "Запланировать публикацию",
    "Cancelling...": "Отмена...",
    "Cancel scheduled publish": "Отменить запланированную публикацию",
    "Publishing...": "Публикация...",
    "Publish approved message": "Опубликовать согласованное сообщение",
    "Telegram": "Telegram",
    "Open Telegram dashboard": "Открыть дашборд Telegram",
    "Default channel": "Канал по умолчанию",
    "not configured": "не настроено",
    "Destinations": "Направления",
    "Sources": "Источники",
    "Linked chats": "Связанные чаты",
    "Blocked tasks": "Заблокированные задачи",
    "Board approvals": "Board-согласования",
    "Pending joins": "Ожидающие join-запросы",
    "Open budget incidents": "Открытые бюджетные инциденты",
    "Recent publishes": "Недавние публикации",
    "Scheduled queue": "Запланированная очередь",
    "Ingested stories": "Загруженные истории",
    "Last publish": "Последняя публикация",
    "Telegram Operations": "Операции Telegram",
    "Company-level view of Telegram capability readiness, pending publish approvals, and recent outbound posts.": "Вид на уровне компании: готовность Telegram, ожидающие согласования публикаций и недавние исходящие посты.",
    "Connection": "Подключение",
    "not set": "не задано",
    "Last validation": "Последняя проверка",
    "Bot": "Бот",
    "Task Bot": "Task Bot",
    "Enabled": "Включено",
    "yes": "да",
    "no": "нет",
    "Approvals inbox enabled": "Инбокс согласований включён",
    "Open tasks": "Открытые задачи",
    "Tasks in review": "Задачи на ревью",
    "Last poll": "Последний polling",
    "Last ingestion": "Последняя загрузка",
    "Approvals Inbox": "Инбокс согласований",
    "Board queue": "Очередь board",
    "My pending approvals": "Мои ожидающие согласования",
    "My revision requests": "Мои запросы на доработку",
    "Last approval notification": "Последнее уведомление о согласовании",
    "Last control-plane notification": "Последнее уведомление control plane",
    "Total Telegram publish approvals": "Всего согласований публикаций Telegram",
    "Recent publishing": "Недавние публикации",
    "Recent posts tracked": "Недавних постов отслеживается",
    "Scheduled publishes": "Запланированные публикации",
    "Failed publishes": "Неудачные публикации",
    "Last publish dispatch": "Последняя отправка публикации",
    "Last post": "Последний пост",
    "Open latest Telegram post": "Открыть последний пост Telegram",
    "No public Telegram post URL recorded yet.": "Публичный URL поста Telegram пока не зафиксирован.",
    "Recent publications": "Недавние публикации",
    "Recent ingested stories": "Недавно загруженные истории",
    "for": "для",
    "at": "в",
    "Item": "Элемент",
    "Telegram settings saved": "Настройки Telegram сохранены",
    "Bot token secret created": "Секрет bot token создан",
    "Failed to create secret": "Не удалось создать секрет",
    "Legacy Telegram config imported": "Наследуемая конфигурация Telegram импортирована",
    "Company-scoped Telegram settings now mirror the previous global connector config.": "Настройки Telegram на уровне компании теперь повторяют прежнюю глобальную конфигурацию коннектора.",
    "Failed to import legacy config": "Не удалось импортировать наследуемую конфигурацию",
    "configured chat": "настроенный чат",
    "Telegram connection OK": "Подключение Telegram успешно",
    "Telegram connection failed": "Подключение Telegram не удалось",
    "Telegram link code created": "Код привязки Telegram создан",
    "Failed to generate link code": "Не удалось создать код привязки",
    "Telegram chat revoked": "Чат Telegram отвязан",
    "Failed to revoke Telegram chat": "Не удалось отвязать чат Telegram",
    "Loading Telegram settings...": "Загрузка настроек Telegram...",
    "Telegram Connector": "Коннектор Telegram",
    "Configure company-scoped Telegram publishing and the Paperclip task bot. Publishing stays governed through approvals; task bot access is linked chat by chat with one-time codes.": "Настройте публикацию Telegram на уровне компании и task bot Paperclip. Публикации остаются под управлением согласований, а доступ task bot привязывается к чатам одноразовыми кодами.",
    "No company selected": "Компания не выбрана",
    "enabled": "включено",
    "disabled": "отключено",
    "bot healthy": "бот в порядке",
    "Publishing": "Публикация",
    "Enable this Telegram connector for the selected company": "Включить этот коннектор Telegram для выбранной компании",
    "Bot token secret": "Секрет bot token",
    "Stored as a Paperclip company secret. The worker resolves it at publish time.": "Хранится как секрет компании Paperclip. Worker получает его во время публикации.",
    "Select a secret...": "Выберите секрет...",
    "Default chat / channel": "Чат / канал по умолчанию",
    "Use @channel_username for public channels or the numeric Telegram chat id.": "Используйте @channel_username для публичных каналов или числовой chat id Telegram.",
    "Optional. Used to build clickable t.me links for published posts.": "Необязательно. Используется для создания кликабельных ссылок t.me для опубликованных постов.",
    "Default parse mode": "Режим парсинга по умолчанию",
    "Leave empty to send raw text. Use HTML or MarkdownV2 only when your draft already matches Telegram formatting rules.": "Оставьте пустым, чтобы отправлять обычный текст. Используйте HTML или MarkdownV2, только если черновик уже соответствует правилам форматирования Telegram.",
    "Disable link preview by default": "Отключать предпросмотр ссылок по умолчанию",
    "Send posts silently by default": "Отправлять посты без уведомления по умолчанию",
    "Manage multiple Telegram publishing targets. The selected default destination also drives the legacy default fields above for backward compatibility.": "Управляйте несколькими направлениями публикации Telegram. Выбранное направление по умолчанию также синхронизирует устаревшие поля по умолчанию выше для обратной совместимости.",
    "Add destination": "Добавить направление",
    "Configured": "Настроено",
    "Destination": "Направление",
    "Label": "Название",
    "Default destination": "Направление по умолчанию",
    "Remove": "Удалить",
    "No multi-channel destinations configured yet. The connector will fall back to the default fields above.": "Многоканальные направления пока не настроены. Коннектор будет использовать поля по умолчанию выше.",
    "Enable Paperclip task bot over Telegram getUpdates polling": "Включить task bot Paperclip через polling Telegram getUpdates",
    "Allow minute polling for inbound Telegram commands and replies": "Разрешить минутный polling для входящих команд и ответов Telegram",
    "Notification mode": "Режим уведомлений",
    "Fallback to all linked chats": "Фолбэк на все связанные чаты",
    "Linked watchers only": "Только связанные наблюдатели",
    "Link code TTL (minutes)": "TTL кода привязки (минуты)",
    "Sources create editorial issues through routines when Telegram sends channel posts or discussion replies to this bot.": "Источники создают редакционные задачи через routines, когда Telegram отправляет этому боту посты канала или ответы из обсуждений.",
    "Add source": "Добавить источник",
    "Source": "Источник",
    "Channel / chat id": "Channel / chat id",
    "Discussion chat id": "Discussion chat id",
    "Mode": "Режим",
    "Channel posts": "Посты канала",
    "Discussion replies": "Ответы в обсуждениях",
    "Both": "Оба режима",
    "Project id": "Project id",
    "Assignee agent id": "Assignee agent id",
    "Routine id": "Routine id",
    "Issue template key": "Ключ шаблона задачи",
    "No Telegram ingestion sources configured yet.": "Источники загрузки Telegram пока не настроены.",
    "Save settings": "Сохранить настройки",
    "Test connection": "Проверить подключение",
    "Importing...": "Импорт...",
    "Import legacy config": "Импортировать наследуемую конфигурацию",
    "Secret bootstrap": "Быстрое создание секрета",
    "There is no dedicated secrets page yet. Create the Telegram bot token secret here and the connector will immediately start using it.": "Отдельной страницы секретов пока нет. Создайте здесь секрет с токеном бота Telegram, и коннектор сразу начнет его использовать.",
    "Secret name": "Имя секрета",
    "Bot token": "Токен бота",
    "Creating...": "Создание...",
    "Create bot token secret": "Создать секрет bot token",
    "Loading company secrets...": "Загрузка секретов компании...",
    "Available secrets": "Доступные секреты",
    "Task Bot Linking": "Привязка Task Bot",
    "Generate one-time link codes for private Telegram chats. Linked users can browse tasks, create new ones, and reply directly from Telegram.": "Создавайте одноразовые коды привязки для приватных чатов Telegram. Связанные пользователи смогут просматривать задачи, создавать новые и отвечать прямо из Telegram.",
    "Generate link code": "Сгенерировать код привязки",
    "min": "мин",
    "Latest link code": "Последний код привязки",
    "Expires": "Истекает",
    "revoked": "отозвано",
    "linked": "привязано",
    "chatId": "chatId",
    "board user": "пользователь board",
    "telegram user": "пользователь Telegram",
    "unscoped": "без привязки",
    "Revoke": "Отвязать",
    "No Telegram chats linked yet.": "Чаты Telegram пока не привязаны.",
    "Bot Health": "Состояние бота",
    "Last update offset": "Последний offset обновлений",
    "none": "нет",
    "Last activity cursor": "Последний cursor активности",
    "Last notification": "Последнее уведомление",
    "Open approvals": "Открытые согласования",
    "Revision approvals": "Согласования на доработку",
    "Telegram bot health looks stable.": "Состояние Telegram-бота выглядит стабильным.",
    "Legacy global Telegram config was detected. Import it once to move this company fully onto scoped settings.": "Обнаружена наследуемая глобальная конфигурация Telegram. Импортируйте её один раз, чтобы полностью перевести компанию на scoped settings.",
    "Draft loaded": "Черновик загружен",
    "Failed to load document": "Не удалось загрузить документ",
    "Telegram Draft": "Черновик Telegram",
    "Updated from Telegram issue tab": "Обновлено из Telegram issue tab",
    "Telegram Final Copy": "Финальный текст Telegram",
    "Synced final copy from Telegram issue tab": "Финальный текст синхронизирован из Telegram issue tab",
    "Draft is empty": "Черновик пуст",
    "Load a document or write the Telegram post before saving the draft output.": "Загрузите документ или напишите пост для Telegram перед сохранением чернового результата.",
    "Telegram draft saved": "Черновик Telegram сохранён",
    "Draft document and work product are now attached to the issue.": "Черновой документ и work product теперь прикреплены к задаче.",
    "Failed to save Telegram draft": "Не удалось сохранить черновик Telegram",
    "Save or compose the Telegram draft before requesting approval.": "Сохраните или подготовьте черновик Telegram перед запросом согласования.",
    "Publish approval requested": "Запрошено согласование публикации",
    "Failed to request publish approval": "Не удалось запросить согласование публикации",
    "Publish approval required": "Требуется согласование публикации",
    "Approve the Telegram publish request before sending the message.": "Согласуйте запрос на публикацию Telegram перед отправкой сообщения.",
    "Write the Telegram post before publishing it.": "Напишите пост для Telegram перед публикацией.",
    "Telegram post published": "Пост Telegram опубликован",
    "The issue now has a visible Telegram work product with a clickable post URL.": "У задачи теперь есть видимый Telegram work product с кликабельным URL поста.",
    "The issue now has a Telegram work product. Set a public handle to expose clickable post URLs.": "У задачи теперь есть Telegram work product. Укажите public handle, чтобы появились кликабельные URL поста.",
    "Failed to publish Telegram post": "Не удалось опубликовать пост Telegram",
    "Approve the Telegram publish request before scheduling the delivery queue.": "Согласуйте запрос на публикацию Telegram перед постановкой в очередь доставки.",
    "Telegram publish rescheduled": "Публикация Telegram перепланирована",
    "Telegram publish scheduled": "Публикация Telegram запланирована",
    "Failed to reschedule Telegram publish": "Не удалось перепланировать публикацию Telegram",
    "Failed to schedule Telegram publish": "Не удалось запланировать публикацию Telegram",
    "Telegram publish cancelled": "Публикация Telegram отменена",
    "The scheduled queue item was cancelled.": "Запланированный элемент очереди был отменён.",
    "Failed to cancel Telegram publish": "Не удалось отменить публикацию Telegram",
    "Issue context is required.": "Требуется контекст задачи.",
    "Loading Telegram issue workflow...": "Загрузка Telegram workflow для задачи...",
  },
};

function translateTelegramText(locale: TelegramLocale, value: string): string {
  return TELEGRAM_TEXT[locale][value] ?? value;
}

function translateTelegramTemplate(locale: TelegramLocale, en: string, ru: string): string {
  return locale === "ru" ? ru : en;
}

function hostPath(companyPrefix: string | null | undefined, suffix: string): string {
  return companyPrefix ? `/${companyPrefix}${suffix}` : suffix;
}

function pluginPagePath(companyPrefix: string | null | undefined): string {
  return hostPath(companyPrefix, `/${PAGE_ROUTE}`);
}

function formatTimestamp(value: string | null | undefined, locale: TelegramLocale): string {
  if (!value) return translateTelegramText(locale, "never");
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(TELEGRAM_LOCALE_TAG[locale]);
}

function toDateTimeLocalValue(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (input: number) => String(input).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function excerpt(value: string, limit = 180): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= limit) return normalized;
  return `${normalized.slice(0, Math.max(0, limit - 3)).trimEnd()}...`;
}

function trimToNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function sanitizeHandle(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = value
    .trim()
    .replace(/^https?:\/\/t\.me\//i, "")
    .replace(/^@+/, "")
    .replace(/\/+$/, "");
  return normalized.length > 0 ? normalized : null;
}

async function hostFetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    credentials: "same-origin",
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(text || `Request failed (${response.status})`);
  }
  return (text.length > 0 ? JSON.parse(text) : null) as T;
}

function cloneCompanySettings(settings?: TelegramCompanySettings | null): TelegramCompanySettings {
  const normalized = sanitizeTelegramCompanySettings(settings ?? DEFAULT_COMPANY_SETTINGS);
  const defaultDestination = normalized.publishing.destinations.find((destination) => destination.id === normalized.publishing.defaultDestinationId)
    ?? normalized.publishing.destinations[0]
    ?? null;
  return {
    publishing: {
      botTokenSecretRef: normalized.publishing.botTokenSecretRef,
      defaultChatId: defaultDestination?.chatId ?? normalized.publishing.defaultChatId ?? DEFAULT_COMPANY_SETTINGS.publishing.defaultChatId,
      defaultPublicHandle: defaultDestination?.publicHandle ?? normalized.publishing.defaultPublicHandle ?? DEFAULT_COMPANY_SETTINGS.publishing.defaultPublicHandle,
      defaultParseMode: defaultDestination?.parseMode ?? normalized.publishing.defaultParseMode ?? DEFAULT_COMPANY_SETTINGS.publishing.defaultParseMode,
      defaultDisableLinkPreview: defaultDestination?.disableLinkPreview ?? normalized.publishing.defaultDisableLinkPreview ?? DEFAULT_COMPANY_SETTINGS.publishing.defaultDisableLinkPreview,
      defaultDisableNotification: defaultDestination?.disableNotification ?? normalized.publishing.defaultDisableNotification ?? DEFAULT_COMPANY_SETTINGS.publishing.defaultDisableNotification,
      destinations: normalized.publishing.destinations.map((destination) => ({ ...destination })),
      defaultDestinationId: normalized.publishing.defaultDestinationId,
    },
    taskBot: {
      enabled: normalized.taskBot.enabled,
      pollingEnabled: normalized.taskBot.pollingEnabled,
      notificationMode: normalized.taskBot.notificationMode,
      claimCodeTtlMinutes: normalized.taskBot.claimCodeTtlMinutes,
    },
    ingestion: {
      sources: normalized.ingestion.sources.map((source) => ({ ...source })),
    },
  };
}

function createDraftId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

function useLegacyConfig() {
  const [configJson, setConfigJson] = useState<PluginConfigJson>({ ...DEFAULT_CONFIG });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    hostFetchJson<{ configJson?: PluginConfigJson | null }>(`/api/plugins/${PLUGIN_ID}/config`)
      .then((result) => {
        if (cancelled) return;
        setConfigJson(sanitizeLegacyTelegramConfig(result?.configJson ?? DEFAULT_CONFIG));
        setError(null);
      })
      .catch((nextError) => {
        if (cancelled) return;
        setError(nextError instanceof Error ? nextError.message : String(nextError));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { configJson, loading, error };
}

function useCompanySettingsConfig(companyId: string | null | undefined) {
  const [settingsJson, setSettingsJson] = useState<TelegramCompanySettings>(cloneCompanySettings());
  const [enabled, setEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!companyId) {
      setSettingsJson(cloneCompanySettings());
      setEnabled(true);
      setLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    hostFetchJson<CompanyPluginSettingsRecord | null>(`/api/companies/${companyId}/plugins/${PLUGIN_ID}/settings`)
      .then((result) => {
        if (cancelled) return;
        setSettingsJson(cloneCompanySettings(result ? sanitizeTelegramCompanySettings(result.settingsJson) : null));
        setEnabled(result?.enabled ?? true);
        setError(null);
      })
      .catch((nextError) => {
        if (cancelled) return;
        setError(nextError instanceof Error ? nextError.message : String(nextError));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [companyId]);

  async function save(nextSettings: TelegramCompanySettings, nextEnabled = enabled) {
    if (!companyId) throw new Error("Select a company before saving Telegram settings");
    setSaving(true);
    try {
      await hostFetchJson(`/api/companies/${companyId}/plugins/${PLUGIN_ID}/settings`, {
        method: "POST",
        body: JSON.stringify({
          enabled: nextEnabled,
          settingsJson: nextSettings,
        }),
      });
      setSettingsJson(cloneCompanySettings(nextSettings));
      setEnabled(nextEnabled);
      setError(null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
      throw nextError;
    } finally {
      setSaving(false);
    }
  }

  return { settingsJson, setSettingsJson, enabled, setEnabled, loading, saving, error, save };
}

function useCompanySecrets(companyId: string | null | undefined) {
  const [secrets, setSecrets] = useState<CompanySecret[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!companyId) {
      setSecrets([]);
      setLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    hostFetchJson<CompanySecret[]>(`/api/companies/${companyId}/secrets`)
      .then((result) => {
        if (cancelled) return;
        setSecrets(result);
        setError(null);
      })
      .catch((nextError) => {
        if (cancelled) return;
        setError(nextError instanceof Error ? nextError.message : String(nextError));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [companyId]);

  async function createSecret(input: { name: string; value: string; description?: string | null }) {
    if (!companyId) throw new Error("Select a company before creating secrets");
    const created = await hostFetchJson<CompanySecret>(`/api/companies/${companyId}/secrets`, {
      method: "POST",
      body: JSON.stringify(input),
    });
    setSecrets((current) => [created, ...current]);
    return created;
  }

  return {
    secrets,
    loading,
    error,
    createSecret,
  };
}

function useIssueTelegramResources(issueId: string | null | undefined) {
  const [issue, setIssue] = useState<IssueDetailResponse | null>(null);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    if (!issueId) return;
    setLoading(true);
    try {
      const [issueResult, approvalsResult] = await Promise.all([
        hostFetchJson<IssueDetailResponse>(`/api/issues/${issueId}`),
        hostFetchJson<Approval[]>(`/api/issues/${issueId}/approvals`),
      ]);
      setIssue(issueResult);
      setApprovals(approvalsResult);
      setError(null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, [issueId]);

  return { issue, approvals, loading, error, refresh };
}

function useCompanyTelegramApprovals(companyId: string | null | undefined) {
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!companyId) {
      setApprovals([]);
      setLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    hostFetchJson<Approval[]>(`/api/companies/${companyId}/approvals`)
      .then((result) => {
        if (cancelled) return;
        setApprovals(result);
        setError(null);
      })
      .catch((nextError) => {
        if (cancelled) return;
        setError(nextError instanceof Error ? nextError.message : String(nextError));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [companyId]);

  return { approvals, loading, error };
}

function approvalDestinationLabel(approval: Approval | null): string | null {
  return approval ? trimToNull(approval.payload.destinationLabel) : null;
}

function isTelegramPublishApproval(approval: Approval): boolean {
  return approval.type === "publish_content" && trimToNull(approval.payload.channel)?.toLowerCase() === "telegram";
}

function isTelegramWorkProduct(product: IssueWorkProduct): boolean {
  return product.provider.toLowerCase() === "telegram";
}

function sortApprovalsNewestFirst(approvals: Approval[]): Approval[] {
  return [...approvals].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

function Pill({ label, tone = "neutral", locale = "en" }: { label: string; tone?: "neutral" | "success" | "warn"; locale?: TelegramLocale }) {
  const borderColor = tone === "success"
    ? "color-mix(in srgb, #16a34a 55%, var(--border))"
    : tone === "warn"
      ? "color-mix(in srgb, #d97706 55%, var(--border))"
      : "var(--border)";
  const color = tone === "success"
    ? "#166534"
    : tone === "warn"
      ? "#b45309"
      : "inherit";
  return (
    <span style={{
      display: "inline-flex",
      alignItems: "center",
      gap: "6px",
      borderRadius: "999px",
      border: `1px solid ${borderColor}`,
      padding: "2px 8px",
      fontSize: "11px",
      color,
    }}>
      {translateTelegramText(locale, label)}
    </span>
  );
}

function PublicationList({ publications, locale }: { publications: TelegramPublication[]; locale: TelegramLocale }) {
  if (publications.length === 0) {
    return <div style={mutedTextStyle}>{translateTelegramText(locale, "No Telegram publications recorded yet.")}</div>;
  }

  return (
    <div style={{ display: "grid", gap: "10px" }}>
      {publications.map((publication) => (
        <div key={publication.externalId} style={{ ...cardStyle, padding: "12px" }}>
          <div style={{ ...rowStyle, justifyContent: "space-between" }}>
            <strong>{publication.destinationLabel}</strong>
            <span style={mutedTextStyle}>{formatTimestamp(publication.sentAt, locale)}</span>
          </div>
          <div style={{ fontSize: "12px", lineHeight: 1.45 }}>{publication.summary}</div>
          <div style={rowStyle}>
            {publication.issueIdentifier ? <Pill label={publication.issueIdentifier} locale={locale} /> : null}
            {publication.publicHandle ? <Pill label={`@${publication.publicHandle}`} locale={locale} /> : null}
            {publication.approvalId ? <Pill label="Approved" tone="success" locale={locale} /> : null}
            {publication.parseMode ? <Pill label={publication.parseMode} locale={locale} /> : null}
          </div>
          {publication.url ? (
            <a href={publication.url} target="_blank" rel="noreferrer" style={{ fontSize: "12px" }}>
              {translateTelegramText(locale, "Open Telegram post")}
            </a>
          ) : (
            <div style={mutedTextStyle}>{translateTelegramText(locale, "No public post URL available. Set a public handle to surface clickable links.")}</div>
          )}
        </div>
      ))}
    </div>
  );
}

function PublicationJobList({ jobs, locale }: { jobs: TelegramPublicationJob[]; locale: TelegramLocale }) {
  if (jobs.length === 0) {
    return <div style={mutedTextStyle}>{translateTelegramText(locale, "No scheduled Telegram publications queued.")}</div>;
  }

  return (
    <div style={{ display: "grid", gap: "10px" }}>
      {jobs.map((job) => (
        <div key={job.id ?? `${job.issueId}:${job.destinationId}:${job.publishAt}`} style={{ ...cardStyle, padding: "12px" }}>
          <div style={{ ...rowStyle, justifyContent: "space-between" }}>
            <strong>{job.destinationId}</strong>
            <span style={mutedTextStyle}>{formatTimestamp(job.publishAt, locale)}</span>
          </div>
          <div style={rowStyle}>
            <Pill label={job.status} tone={job.status === "failed" ? "warn" : job.status === "published" ? "success" : "neutral"} locale={locale} />
            <Pill label={job.issueId} locale={locale} />
            {job.approvalId ? <Pill label="approved" tone="success" locale={locale} /> : <Pill label="approval missing" tone="warn" locale={locale} />}
          </div>
          {job.failureReason ? <div style={mutedTextStyle}>{job.failureReason}</div> : null}
          {job.publishedUrl ? (
            <a href={job.publishedUrl} target="_blank" rel="noreferrer" style={{ fontSize: "12px" }}>
              {translateTelegramText(locale, "Open Telegram post")}
            </a>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function SourceMessageList({ stories, locale }: { stories: TelegramSourceMessageRecord[]; locale: TelegramLocale }) {
  if (stories.length === 0) {
    return <div style={mutedTextStyle}>{translateTelegramText(locale, "No Telegram source stories ingested yet.")}</div>;
  }

  return (
    <div style={{ display: "grid", gap: "10px" }}>
      {stories.map((story) => (
        <div key={`${story.sourceId}:${story.chatId}:${story.messageId}`} style={{ ...cardStyle, padding: "12px" }}>
          <div style={{ ...rowStyle, justifyContent: "space-between" }}>
            <strong>{story.sourceId}</strong>
            <span style={mutedTextStyle}>{formatTimestamp(story.messageDate ?? story.linkedAt, locale)}</span>
          </div>
          <div style={mutedTextStyle}>{story.excerpt ?? translateTelegramText(locale, "No excerpt captured.")}</div>
          <div style={rowStyle}>
            <Pill label={`chat ${story.chatId}`} locale={locale} />
            <Pill label={`message ${story.messageId}`} locale={locale} />
            {story.issueId ? <Pill label={story.issueId} tone="success" locale={locale} /> : null}
          </div>
        </div>
      ))}
    </div>
  );
}

function SettingsField({
  label,
  hint,
  children,
  locale = "en",
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  locale?: TelegramLocale;
}) {
  return (
    <label style={{ display: "grid", gap: "6px" }}>
      <span style={{ fontSize: "12px", fontWeight: 600 }}>{translateTelegramText(locale, label)}</span>
      {children}
      {hint ? <span style={mutedTextStyle}>{translateTelegramText(locale, hint)}</span> : null}
    </label>
  );
}

export function TelegramSettingsPage({ context }: PluginSettingsPageProps) {
  const locale = context.locale;
  const t = (value: string) => translateTelegramText(locale, value);
  const {
    settingsJson,
    setSettingsJson,
    enabled,
    setEnabled,
    loading,
    saving,
    error,
    save,
  } = useCompanySettingsConfig(context.companyId);
  const legacyConfig = useLegacyConfig();
  const overview = usePluginData<TelegramOverview>(DATA_KEYS.overview, context.companyId ? { companyId: context.companyId } : {});
  const { secrets, loading: secretsLoading, error: secretsError, createSecret } = useCompanySecrets(context.companyId);
  const [secretName, setSecretName] = useState("telegram-bot-token");
  const [secretValue, setSecretValue] = useState("");
  const [secretDescription, setSecretDescription] = useState("Telegram bot token");
  const [creatingSecret, setCreatingSecret] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [linkCode, setLinkCode] = useState<{ code: string; expiresAt: string; startCommand: string } | null>(null);
  const [importingLegacy, setImportingLegacy] = useState(false);
  const pushToast = usePluginToast();
  const testConnection = usePluginAction(ACTION_KEYS.testConnection);
  const generateLinkCode = usePluginAction(ACTION_KEYS.generateLinkCode);
  const revokeLinkedChat = usePluginAction(ACTION_KEYS.revokeLinkedChat);
  const legacyDetected = hasLegacyTelegramConfig(legacyConfig.configJson);

  function updateSettings(
    updater: (current: TelegramCompanySettings) => TelegramCompanySettings,
  ) {
    setSettingsJson((current) => cloneCompanySettings(updater(current)));
  }

  function setPublishingField<K extends keyof TelegramCompanySettings["publishing"]>(
    key: K,
    value: TelegramCompanySettings["publishing"][K],
  ) {
    updateSettings((current) => {
      const nextPublishing = {
        ...current.publishing,
        [key]: value,
      };
      const defaultDestinationId = current.publishing.defaultDestinationId;
      if (
        defaultDestinationId
        && ["defaultChatId", "defaultPublicHandle", "defaultParseMode", "defaultDisableLinkPreview", "defaultDisableNotification"].includes(String(key))
      ) {
        nextPublishing.destinations = current.publishing.destinations.map((destination) => (
          destination.id === defaultDestinationId
            ? {
              ...destination,
              chatId: key === "defaultChatId" ? String(value ?? "") : destination.chatId,
              publicHandle: key === "defaultPublicHandle" ? String(value ?? "") : destination.publicHandle,
              parseMode: key === "defaultParseMode"
                ? value as TelegramDestination["parseMode"]
                : destination.parseMode,
              disableLinkPreview: key === "defaultDisableLinkPreview"
                ? Boolean(value)
                : destination.disableLinkPreview,
              disableNotification: key === "defaultDisableNotification"
                ? Boolean(value)
                : destination.disableNotification,
            }
            : destination
        ));
      }
      return {
        ...current,
        publishing: nextPublishing,
      };
    });
  }

  function setTaskBotField<K extends keyof TelegramCompanySettings["taskBot"]>(
    key: K,
    value: TelegramCompanySettings["taskBot"][K],
  ) {
    updateSettings((current) => ({
      ...current,
      taskBot: {
        ...current.taskBot,
        [key]: value,
      },
    }));
  }

  function addDestination() {
    updateSettings((current) => {
      const destination: TelegramDestination = {
        id: createDraftId("destination"),
        label: `Destination ${current.publishing.destinations.length + 1}`,
        chatId: "",
        publicHandle: "",
        parseMode: "",
        disableLinkPreview: false,
        disableNotification: false,
        enabled: true,
        isDefault: current.publishing.destinations.length === 0,
      };
      return {
        ...current,
        publishing: {
          ...current.publishing,
          destinations: [...current.publishing.destinations, destination],
          defaultDestinationId: current.publishing.defaultDestinationId || destination.id,
        },
      };
    });
  }

  function updateDestination(
    destinationId: string,
    patch: Partial<TelegramDestination>,
  ) {
    updateSettings((current) => {
      const nextDefaultId = patch.isDefault === true
        ? destinationId
        : current.publishing.defaultDestinationId;
      return {
        ...current,
        publishing: {
          ...current.publishing,
          defaultDestinationId: nextDefaultId,
          destinations: current.publishing.destinations.map((destination) => (
            destination.id === destinationId
              ? { ...destination, ...patch }
              : destination
          )),
        },
      };
    });
  }

  function removeDestination(destinationId: string) {
    updateSettings((current) => {
      const remaining = current.publishing.destinations.filter((destination) => destination.id !== destinationId);
      const nextDefaultId = current.publishing.defaultDestinationId === destinationId
        ? (remaining[0]?.id ?? "")
        : current.publishing.defaultDestinationId;
      return {
        ...current,
        publishing: {
          ...current.publishing,
          destinations: remaining,
          defaultDestinationId: nextDefaultId,
        },
      };
    });
  }

  function addSource() {
    updateSettings((current) => ({
      ...current,
      ingestion: {
        sources: [
          ...current.ingestion.sources,
          {
            id: createDraftId("source"),
            label: `Source ${current.ingestion.sources.length + 1}`,
            chatId: "",
            publicHandle: "",
            discussionChatId: "",
            mode: "channel_posts",
            enabled: true,
            projectId: "",
            assigneeAgentId: "",
            routineId: "",
            issueTemplateKey: "",
          },
        ],
      },
    }));
  }

  function updateSource(sourceId: string, patch: Partial<TelegramIngestionSource>) {
    updateSettings((current) => ({
      ...current,
      ingestion: {
        sources: current.ingestion.sources.map((source) => (
          source.id === sourceId
            ? { ...source, ...patch }
            : source
        )),
      },
    }));
  }

  function removeSource(sourceId: string) {
    updateSettings((current) => ({
      ...current,
      ingestion: {
        sources: current.ingestion.sources.filter((source) => source.id !== sourceId),
      },
    }));
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    await save(settingsJson, enabled);
    pushToast({
      title: t("Telegram settings saved"),
      tone: "success",
    });
    overview.refresh();
  }

  async function onCreateSecret() {
    if (!context.companyId) return;
    setCreatingSecret(true);
    try {
      const created = await createSecret({
        name: secretName.trim(),
        value: secretValue.trim(),
        description: secretDescription.trim() || null,
      });
      setPublishingField("botTokenSecretRef", created.id);
      setSecretValue("");
      pushToast({
        title: t("Bot token secret created"),
        body: translateTelegramTemplate(locale, `Stored as ${created.name}.`, `Сохранено как ${created.name}.`),
        tone: "success",
      });
    } catch (nextError) {
      pushToast({
        title: t("Failed to create secret"),
        body: nextError instanceof Error ? nextError.message : String(nextError),
        tone: "error",
      });
    } finally {
      setCreatingSecret(false);
    }
  }

  async function onImportLegacy() {
    if (!context.companyId) return;
    setImportingLegacy(true);
    try {
      const nextSettings = companySettingsFromLegacyConfig(legacyConfig.configJson);
      await save(nextSettings, enabled);
      pushToast({
        title: t("Legacy Telegram config imported"),
        body: t("Company-scoped Telegram settings now mirror the previous global connector config."),
        tone: "success",
      });
      overview.refresh();
    } catch (nextError) {
      pushToast({
        title: t("Failed to import legacy config"),
        body: nextError instanceof Error ? nextError.message : String(nextError),
        tone: "error",
      });
    } finally {
      setImportingLegacy(false);
    }
  }

  async function onTestConnection() {
    if (!context.companyId) return;
    try {
      const result = await testConnection({ companyId: context.companyId }) as {
        bot?: { username?: string | null; firstName?: string | null };
        defaultChat?: { title?: string | null; username?: string | null; id?: string | null } | null;
      };
      const botName = result.bot?.username ? `@${result.bot.username}` : (result.bot?.firstName ?? "bot");
      const chatLabel = result.defaultChat?.username
        ? `@${result.defaultChat.username}`
        : (result.defaultChat?.title ?? result.defaultChat?.id ?? t("configured chat"));
      const message = translateTelegramTemplate(
        locale,
        `Connected as ${botName}${result.defaultChat ? ` to ${chatLabel}` : ""}.`,
        `Подключено как ${botName}${result.defaultChat ? ` к ${chatLabel}` : ""}.`,
      );
      setTestResult(message);
      pushToast({
        title: t("Telegram connection OK"),
        body: message,
        tone: "success",
      });
    } catch (nextError) {
      const message = nextError instanceof Error ? nextError.message : String(nextError);
      setTestResult(message);
      pushToast({
        title: t("Telegram connection failed"),
        body: message,
        tone: "error",
      });
    }
    overview.refresh();
  }

  async function onGenerateLinkCode() {
    if (!context.companyId) return;
    try {
      const result = await generateLinkCode({
        companyId: context.companyId,
        boardUserId: context.userId,
      }) as { code: string; expiresAt: string; startCommand: string };
      setLinkCode(result);
      pushToast({
        title: t("Telegram link code created"),
        body: translateTelegramTemplate(
          locale,
          `Use ${result.startCommand} in a private chat with the bot.`,
          `Используйте ${result.startCommand} в приватном чате с ботом.`,
        ),
        tone: "success",
      });
    } catch (nextError) {
      pushToast({
        title: t("Failed to generate link code"),
        body: nextError instanceof Error ? nextError.message : String(nextError),
        tone: "error",
      });
    }
  }

  async function onRevokeLinkedChat(chatId: string) {
    if (!context.companyId) return;
    try {
      await revokeLinkedChat({ companyId: context.companyId, chatId });
      pushToast({
        title: t("Telegram chat revoked"),
        body: translateTelegramTemplate(
          locale,
          `Chat ${chatId} will stop receiving task updates.`,
          `Чат ${chatId} перестанет получать обновления по задачам.`,
        ),
        tone: "success",
      });
      overview.refresh();
    } catch (nextError) {
      pushToast({
        title: t("Failed to revoke Telegram chat"),
        body: nextError instanceof Error ? nextError.message : String(nextError),
        tone: "error",
      });
    }
  }

  if (loading) {
    return <div style={mutedTextStyle}>{t("Loading Telegram settings...")}</div>;
  }

  return (
    <form onSubmit={onSubmit} style={layoutStack}>
      <div style={cardStyle}>
        <div style={{ ...layoutStack, gap: "10px" }}>
          <div style={sectionTitleStyle}>{t("Telegram Connector")}</div>
          <div style={mutedTextStyle}>
            {t("Configure company-scoped Telegram publishing and the Paperclip task bot. Publishing stays governed through approvals; task bot access is linked chat by chat with one-time codes.")}
          </div>
          <div style={rowStyle}>
            <a href={pluginPagePath(context.companyPrefix)} style={{ fontSize: "12px" }}>{t("Open Telegram dashboard")}</a>
            {context.companyId ? <Pill label={context.companyId} locale={locale} /> : <Pill label="No company selected" tone="warn" locale={locale} />}
            {enabled ? <Pill label="enabled" tone="success" locale={locale} /> : <Pill label="disabled" tone="warn" locale={locale} />}
            {overview.data?.botHealth?.ok ? <Pill label="bot healthy" tone="success" locale={locale} /> : null}
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gap: "16px", gridTemplateColumns: "minmax(0, 1.2fr) minmax(280px, 0.8fr)" }}>
        <div style={{ ...cardStyle, ...layoutStack }}>
          <div style={sectionTitleStyle}>{t("Publishing")}</div>
          <label style={rowStyle}>
            <input
              type="checkbox"
              checked={enabled}
              onChange={(event) => setEnabled(event.target.checked)}
            />
            <span style={{ fontSize: "12px" }}>{t("Enable this Telegram connector for the selected company")}</span>
          </label>
          <SettingsField
            label="Bot token secret"
            hint="Stored as a Paperclip company secret. The worker resolves it at publish time."
            locale={locale}
          >
            <select
              style={inputStyle}
              value={settingsJson.publishing.botTokenSecretRef}
              onChange={(event) => setPublishingField("botTokenSecretRef", event.target.value)}
            >
              <option value="">{t("Select a secret...")}</option>
              {secrets.map((secret) => (
                <option key={secret.id} value={secret.id}>
                  {secret.name} ({secret.id.slice(0, 8)}...)
                </option>
              ))}
            </select>
          </SettingsField>

          <SettingsField
            label="Default chat / channel"
            hint="Use @channel_username for public channels or the numeric Telegram chat id."
            locale={locale}
          >
            <input
              style={inputStyle}
              value={settingsJson.publishing.defaultChatId}
              onChange={(event) => setPublishingField("defaultChatId", event.target.value)}
              placeholder="@my_channel"
            />
          </SettingsField>

          <SettingsField
            label="Public handle"
            hint="Optional. Used to build clickable t.me links for published posts."
            locale={locale}
          >
            <input
              style={inputStyle}
              value={settingsJson.publishing.defaultPublicHandle}
              onChange={(event) => setPublishingField("defaultPublicHandle", event.target.value)}
              placeholder="@my_channel"
            />
          </SettingsField>

          <SettingsField
            label="Default parse mode"
            hint="Leave empty to send raw text. Use HTML or MarkdownV2 only when your draft already matches Telegram formatting rules."
            locale={locale}
          >
            <select
              style={inputStyle}
              value={settingsJson.publishing.defaultParseMode}
              onChange={(event) => setPublishingField("defaultParseMode", event.target.value as TelegramCompanySettings["publishing"]["defaultParseMode"])}
            >
              <option value="">{t("Plain text")}</option>
              <option value="HTML">HTML</option>
              <option value="MarkdownV2">MarkdownV2</option>
            </select>
          </SettingsField>

          <label style={rowStyle}>
            <input
              type="checkbox"
              checked={settingsJson.publishing.defaultDisableLinkPreview === true}
              onChange={(event) => setPublishingField("defaultDisableLinkPreview", event.target.checked)}
            />
            <span style={{ fontSize: "12px" }}>{t("Disable link preview by default")}</span>
          </label>
          <label style={rowStyle}>
            <input
              type="checkbox"
              checked={settingsJson.publishing.defaultDisableNotification === true}
              onChange={(event) => setPublishingField("defaultDisableNotification", event.target.checked)}
            />
            <span style={{ fontSize: "12px" }}>{t("Send posts silently by default")}</span>
          </label>

          <div style={{ ...sectionTitleStyle, marginTop: "6px" }}>{t("Destinations")}</div>
          <div style={mutedTextStyle}>
            {t("Manage multiple Telegram publishing targets. The selected default destination also drives the legacy default fields above for backward compatibility.")}
          </div>
          <div style={rowStyle}>
            <button type="button" style={buttonStyle} onClick={addDestination}>
              {t("Add destination")}
            </button>
            <span style={mutedTextStyle}>{t("Configured")}: {settingsJson.publishing.destinations.length}</span>
          </div>
          {settingsJson.publishing.destinations.length > 0 ? (
            <div style={{ display: "grid", gap: "10px" }}>
              {settingsJson.publishing.destinations.map((destination, index) => (
                <div key={destination.id} style={{ border: "1px solid var(--border)", borderRadius: "12px", padding: "12px", display: "grid", gap: "10px" }}>
                  <div style={{ ...rowStyle, justifyContent: "space-between" }}>
                    <strong style={{ fontSize: "12px" }}>{destination.label || `${t("Destination")} ${index + 1}`}</strong>
                    <div style={rowStyle}>
                      {destination.enabled ? <Pill label="enabled" tone="success" locale={locale} /> : <Pill label="disabled" tone="warn" locale={locale} />}
                      {settingsJson.publishing.defaultDestinationId === destination.id ? <Pill label="default" locale={locale} /> : null}
                    </div>
                  </div>
                  <div style={{ display: "grid", gap: "10px", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" }}>
                    <SettingsField label="Label" locale={locale}>
                      <input
                        style={inputStyle}
                        value={destination.label}
                        onChange={(event) => updateDestination(destination.id, { label: event.target.value })}
                      />
                    </SettingsField>
                    <SettingsField label="Chat id / username" locale={locale}>
                      <input
                        style={inputStyle}
                        value={destination.chatId}
                        onChange={(event) => updateDestination(destination.id, { chatId: event.target.value })}
                        placeholder="@my_channel"
                      />
                    </SettingsField>
                    <SettingsField label="Public handle" locale={locale}>
                      <input
                        style={inputStyle}
                        value={destination.publicHandle}
                        onChange={(event) => updateDestination(destination.id, { publicHandle: event.target.value })}
                        placeholder="@my_channel"
                      />
                    </SettingsField>
                    <SettingsField label="Parse mode" locale={locale}>
                      <select
                        style={inputStyle}
                        value={destination.parseMode}
                        onChange={(event) => updateDestination(destination.id, { parseMode: event.target.value as TelegramDestination["parseMode"] })}
                      >
                        <option value="">{t("Plain text")}</option>
                        <option value="HTML">HTML</option>
                        <option value="MarkdownV2">MarkdownV2</option>
                      </select>
                    </SettingsField>
                  </div>
                  <div style={rowStyle}>
                    <label style={rowStyle}>
                      <input
                        type="checkbox"
                        checked={destination.enabled}
                        onChange={(event) => updateDestination(destination.id, { enabled: event.target.checked })}
                      />
                      <span style={{ fontSize: "12px" }}>{t("Enabled")}</span>
                    </label>
                    <label style={rowStyle}>
                      <input
                        type="checkbox"
                        checked={settingsJson.publishing.defaultDestinationId === destination.id}
                        onChange={(event) => {
                          if (event.target.checked) updateDestination(destination.id, { isDefault: true });
                        }}
                      />
                      <span style={{ fontSize: "12px" }}>{t("Default destination")}</span>
                    </label>
                    <label style={rowStyle}>
                      <input
                        type="checkbox"
                        checked={destination.disableLinkPreview}
                        onChange={(event) => updateDestination(destination.id, { disableLinkPreview: event.target.checked })}
                      />
                      <span style={{ fontSize: "12px" }}>{t("Disable link preview")}</span>
                    </label>
                    <label style={rowStyle}>
                      <input
                        type="checkbox"
                        checked={destination.disableNotification}
                        onChange={(event) => updateDestination(destination.id, { disableNotification: event.target.checked })}
                      />
                      <span style={{ fontSize: "12px" }}>{t("Send silently")}</span>
                    </label>
                    <button type="button" style={buttonStyle} onClick={() => removeDestination(destination.id)}>
                      {t("Remove")}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div style={mutedTextStyle}>{t("No multi-channel destinations configured yet. The connector will fall back to the default fields above.")}</div>
          )}

          <div style={{ ...sectionTitleStyle, marginTop: "6px" }}>{t("Task Bot")}</div>
          <label style={rowStyle}>
            <input
              type="checkbox"
              checked={settingsJson.taskBot.enabled === true}
              onChange={(event) => setTaskBotField("enabled", event.target.checked)}
            />
            <span style={{ fontSize: "12px" }}>{t("Enable Paperclip task bot over Telegram getUpdates polling")}</span>
          </label>
          <label style={rowStyle}>
            <input
              type="checkbox"
              checked={settingsJson.taskBot.pollingEnabled !== false}
              onChange={(event) => setTaskBotField("pollingEnabled", event.target.checked)}
            />
            <span style={{ fontSize: "12px" }}>{t("Allow minute polling for inbound Telegram commands and replies")}</span>
          </label>
          <SettingsField label="Notification mode" locale={locale}>
            <select
              style={inputStyle}
              value={settingsJson.taskBot.notificationMode}
              onChange={(event) => setTaskBotField("notificationMode", event.target.value as TelegramCompanySettings["taskBot"]["notificationMode"])}
            >
              <option value="fallback_all_linked">{t("Fallback to all linked chats")}</option>
              <option value="linked_only">{t("Linked watchers only")}</option>
            </select>
          </SettingsField>
          <SettingsField label="Link code TTL (minutes)" locale={locale}>
            <input
              style={inputStyle}
              type="number"
              min={5}
              max={1440}
              value={settingsJson.taskBot.claimCodeTtlMinutes}
              onChange={(event) => setTaskBotField("claimCodeTtlMinutes", Math.max(5, Math.min(1440, Number(event.target.value) || DEFAULT_COMPANY_SETTINGS.taskBot.claimCodeTtlMinutes)))}
            />
          </SettingsField>

          <div style={{ ...sectionTitleStyle, marginTop: "6px" }}>{t("Ingestion Sources")}</div>
          <div style={mutedTextStyle}>
            {t("Sources create editorial issues through routines when Telegram sends channel posts or discussion replies to this bot.")}
          </div>
          <div style={rowStyle}>
            <button type="button" style={buttonStyle} onClick={addSource}>
              {t("Add source")}
            </button>
            <span style={mutedTextStyle}>{t("Configured")}: {settingsJson.ingestion.sources.length}</span>
          </div>
          {settingsJson.ingestion.sources.length > 0 ? (
            <div style={{ display: "grid", gap: "10px" }}>
              {settingsJson.ingestion.sources.map((source, index) => (
                <div key={source.id} style={{ border: "1px solid var(--border)", borderRadius: "12px", padding: "12px", display: "grid", gap: "10px" }}>
                  <div style={{ ...rowStyle, justifyContent: "space-between" }}>
                    <strong style={{ fontSize: "12px" }}>{source.label || `${t("Source")} ${index + 1}`}</strong>
                    {source.enabled ? <Pill label="enabled" tone="success" locale={locale} /> : <Pill label="disabled" tone="warn" locale={locale} />}
                  </div>
                  <div style={{ display: "grid", gap: "10px", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" }}>
                    <SettingsField label="Label" locale={locale}>
                      <input style={inputStyle} value={source.label} onChange={(event) => updateSource(source.id, { label: event.target.value })} />
                    </SettingsField>
                    <SettingsField label="Channel / chat id" locale={locale}>
                      <input style={inputStyle} value={source.chatId} onChange={(event) => updateSource(source.id, { chatId: event.target.value })} placeholder="-100123..." />
                    </SettingsField>
                    <SettingsField label="Public handle" locale={locale}>
                      <input style={inputStyle} value={source.publicHandle} onChange={(event) => updateSource(source.id, { publicHandle: event.target.value })} placeholder="@my_channel" />
                    </SettingsField>
                    <SettingsField label="Discussion chat id" locale={locale}>
                      <input style={inputStyle} value={source.discussionChatId} onChange={(event) => updateSource(source.id, { discussionChatId: event.target.value })} placeholder="-100discussion..." />
                    </SettingsField>
                    <SettingsField label="Mode" locale={locale}>
                      <select style={inputStyle} value={source.mode} onChange={(event) => updateSource(source.id, { mode: event.target.value as TelegramIngestionSource["mode"] })}>
                        <option value="channel_posts">{t("Channel posts")}</option>
                        <option value="discussion_replies">{t("Discussion replies")}</option>
                        <option value="both">{t("Both")}</option>
                      </select>
                    </SettingsField>
                    <SettingsField label="Project id" locale={locale}>
                      <input style={inputStyle} value={source.projectId} onChange={(event) => updateSource(source.id, { projectId: event.target.value })} />
                    </SettingsField>
                    <SettingsField label="Assignee agent id" locale={locale}>
                      <input style={inputStyle} value={source.assigneeAgentId} onChange={(event) => updateSource(source.id, { assigneeAgentId: event.target.value })} />
                    </SettingsField>
                    <SettingsField label="Routine id" locale={locale}>
                      <input style={inputStyle} value={source.routineId} onChange={(event) => updateSource(source.id, { routineId: event.target.value })} placeholder="Optional existing routine" />
                    </SettingsField>
                    <SettingsField label="Issue template key" locale={locale}>
                      <input style={inputStyle} value={source.issueTemplateKey} onChange={(event) => updateSource(source.id, { issueTemplateKey: event.target.value })} placeholder="Optional template key" />
                    </SettingsField>
                  </div>
                  <div style={rowStyle}>
                    <label style={rowStyle}>
                      <input type="checkbox" checked={source.enabled} onChange={(event) => updateSource(source.id, { enabled: event.target.checked })} />
                      <span style={{ fontSize: "12px" }}>{t("Enabled")}</span>
                    </label>
                    <button type="button" style={buttonStyle} onClick={() => removeSource(source.id)}>
                      {t("Remove")}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div style={mutedTextStyle}>{t("No Telegram ingestion sources configured yet.")}</div>
          )}

          {error ? <div style={{ color: "var(--destructive, #c00)", fontSize: "12px" }}>{error}</div> : null}
          {testResult ? <div style={mutedTextStyle}>{testResult}</div> : null}
          {legacyConfig.error ? <div style={{ color: "var(--destructive, #c00)", fontSize: "12px" }}>{legacyConfig.error}</div> : null}

          <div style={rowStyle}>
            <button type="submit" style={primaryButtonStyle} disabled={saving}>
              {saving ? t("Saving...") : t("Save settings")}
            </button>
            <button
              type="button"
              style={buttonStyle}
              disabled={!context.companyId}
              onClick={() => void onTestConnection()}
            >
              {t("Test connection")}
            </button>
            {legacyDetected ? (
              <button
                type="button"
                style={buttonStyle}
                disabled={importingLegacy || legacyConfig.loading}
                onClick={() => void onImportLegacy()}
              >
                {importingLegacy ? t("Importing...") : t("Import legacy config")}
              </button>
            ) : null}
          </div>
        </div>

        <div style={{ ...cardStyle, ...layoutStack }}>
          <div style={sectionTitleStyle}>{t("Secret bootstrap")}</div>
          <div style={mutedTextStyle}>
            {t("There is no dedicated secrets page yet. Create the Telegram bot token secret here and the connector will immediately start using it.")}
          </div>
          <SettingsField label="Secret name" locale={locale}>
            <input style={inputStyle} value={secretName} onChange={(event) => setSecretName(event.target.value)} />
          </SettingsField>
          <SettingsField label="Bot token" locale={locale}>
            <input
              style={inputStyle}
              type="password"
              value={secretValue}
              onChange={(event) => setSecretValue(event.target.value)}
              placeholder="123456:ABCDEF..."
            />
          </SettingsField>
          <SettingsField label="Description" locale={locale}>
            <input style={inputStyle} value={secretDescription} onChange={(event) => setSecretDescription(event.target.value)} />
          </SettingsField>
          <div style={rowStyle}>
            <button
              type="button"
              style={buttonStyle}
              disabled={!context.companyId || creatingSecret || secretValue.trim().length === 0 || secretName.trim().length === 0}
              onClick={() => void onCreateSecret()}
            >
              {creatingSecret ? t("Creating...") : t("Create bot token secret")}
            </button>
          </div>
          {secretsLoading ? <div style={mutedTextStyle}>{t("Loading company secrets...")}</div> : null}
          {secretsError ? <div style={{ color: "var(--destructive, #c00)", fontSize: "12px" }}>{secretsError}</div> : null}
          {secrets.length > 0 ? (
            <div style={{ display: "grid", gap: "8px" }}>
              <div style={{ fontSize: "12px", fontWeight: 600 }}>{t("Available secrets")}</div>
              {secrets.slice(0, 6).map((secret) => (
                <div key={secret.id} style={{ border: "1px solid var(--border)", borderRadius: "10px", padding: "10px" }}>
                  <div style={{ fontSize: "12px", fontWeight: 600 }}>{secret.name}</div>
                  <div style={mutedTextStyle}>{secret.description ?? secret.id}</div>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      <div style={{ display: "grid", gap: "16px", gridTemplateColumns: "minmax(0, 1fr) minmax(280px, 0.9fr)" }}>
        <div style={{ ...cardStyle, ...layoutStack }}>
          <div style={sectionTitleStyle}>{t("Task Bot Linking")}</div>
          <div style={mutedTextStyle}>
            {t("Generate one-time link codes for private Telegram chats. Linked users can browse tasks, create new ones, and reply directly from Telegram.")}
          </div>
          <div style={rowStyle}>
            <button
              type="button"
              style={buttonStyle}
              disabled={!context.companyId || settingsJson.taskBot.enabled !== true}
              onClick={() => void onGenerateLinkCode()}
            >
              {t("Generate link code")}
            </button>
            <span style={mutedTextStyle}>TTL: {settingsJson.taskBot.claimCodeTtlMinutes} {t("min")}</span>
          </div>
          {linkCode ? (
            <div style={{ border: "1px solid var(--border)", borderRadius: "12px", padding: "12px", display: "grid", gap: "6px" }}>
              <div style={{ fontSize: "12px", fontWeight: 600 }}>{t("Latest link code")}</div>
              <div style={{ fontFamily: "monospace", fontSize: "13px" }}>{linkCode.startCommand}</div>
              <div style={mutedTextStyle}>{t("Expires")} {formatTimestamp(linkCode.expiresAt, locale)}</div>
            </div>
          ) : null}
          {overview.data?.linkedChats?.length ? (
            <div style={{ display: "grid", gap: "8px" }}>
              <div style={{ fontSize: "12px", fontWeight: 600 }}>{t("Linked chats")}</div>
              {overview.data.linkedChats.map((chat) => (
                <div key={`${chat.companyId}:${chat.chatId}`} style={{ border: "1px solid var(--border)", borderRadius: "10px", padding: "10px", display: "grid", gap: "8px" }}>
                  <div style={{ ...rowStyle, justifyContent: "space-between" }}>
                    <strong style={{ fontSize: "12px" }}>{chat.username ? `@${chat.username}` : chat.displayName}</strong>
                    {chat.revokedAt ? <Pill label="revoked" tone="warn" locale={locale} /> : <Pill label="linked" tone="success" locale={locale} />}
                  </div>
                  <div style={mutedTextStyle}>
                    {t("chatId")}: {chat.chatId} | {t("linked")} {formatTimestamp(chat.linkedAt, locale)}
                  </div>
                  <div style={mutedTextStyle}>
                    {t("board user")}: {chat.boardUserId ?? t("unscoped")} | {t("telegram user")}: {chat.telegramUserId}
                  </div>
                  {!chat.revokedAt ? (
                    <div style={rowStyle}>
                      <button type="button" style={buttonStyle} onClick={() => void onRevokeLinkedChat(chat.chatId)}>
                        {t("Revoke")}
                      </button>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          ) : (
            <div style={mutedTextStyle}>{t("No Telegram chats linked yet.")}</div>
          )}
        </div>

        <div style={{ ...cardStyle, ...layoutStack }}>
          <div style={sectionTitleStyle}>{t("Bot Health")}</div>
          <div style={{ display: "grid", gap: "6px", fontSize: "12px" }}>
            <div>{t("Last poll")}: {formatTimestamp(overview.data?.botHealth?.checkedAt, locale)}</div>
            <div>{t("Last update offset")}: {overview.data?.botHealth?.lastUpdateId ?? t("none")}</div>
            <div>{t("Last activity cursor")}: {overview.data?.botHealth?.lastActivityCursor ?? t("none")}</div>
            <div>{t("Last notification")}: {formatTimestamp(overview.data?.botHealth?.lastNotificationAt, locale)}</div>
            <div>{t("Last approval notification")}: {formatTimestamp(overview.data?.botHealth?.lastApprovalNotificationAt, locale)}</div>
            <div>{t("Last control-plane notification")}: {formatTimestamp(overview.data?.botHealth?.lastControlPlaneNotificationAt, locale)}</div>
            <div>{t("Last ingestion")}: {formatTimestamp(overview.data?.botHealth?.lastIngestionAt, locale)}</div>
            <div>{t("Last publish dispatch")}: {formatTimestamp(overview.data?.botHealth?.lastPublishDispatchAt, locale)}</div>
            <div>{t("Blocked tasks")}: {overview.data?.blockedTaskCount ?? 0}</div>
            <div>{t("Open tasks")}: {overview.data?.openTaskCount ?? 0}</div>
            <div>{t("Open approvals")}: {overview.data?.botHealth?.openApprovalCount ?? 0}</div>
            <div>{t("Revision approvals")}: {overview.data?.botHealth?.revisionApprovalCount ?? 0}</div>
            <div>{t("Pending join requests")}: {overview.data?.botHealth?.openJoinRequestCount ?? 0}</div>
            <div>{t("Open budget incidents")}: {overview.data?.botHealth?.openBudgetIncidentCount ?? 0}</div>
            <div>{t("Scheduled publishes")}: {overview.data?.scheduledPublishCount ?? 0}</div>
            <div>{t("Failed publishes")}: {overview.data?.failedPublishCount ?? 0}</div>
            <div>{t("Ingested stories")}: {overview.data?.ingestedStoryCount ?? 0}</div>
          </div>
          {overview.data?.botHealth?.error ? (
            <div style={{ color: "var(--destructive, #c00)", fontSize: "12px" }}>
              {overview.data.botHealth.error}
            </div>
          ) : (
            <div style={mutedTextStyle}>{t("Telegram bot health looks stable.")}</div>
          )}
          {legacyDetected ? (
            <div style={mutedTextStyle}>
              {t("Legacy global Telegram config was detected. Import it once to move this company fully onto scoped settings.")}
            </div>
          ) : null}
        </div>
      </div>
    </form>
  );
}

export function TelegramDashboardWidget({ context }: PluginWidgetProps) {
  const locale = context.locale;
  const t = (value: string) => translateTelegramText(locale, value);
  const overview = usePluginData<TelegramOverview>(DATA_KEYS.overview, context.companyId ? { companyId: context.companyId } : {});

  return (
    <div style={layoutStack}>
      <div style={rowStyle}>
        <strong>{t("Telegram")}</strong>
        <Pill label="connector" locale={locale} />
        {overview.data?.configured ? <Pill label="configured" tone="success" locale={locale} /> : <Pill label="needs setup" tone="warn" locale={locale} />}
      </div>
      <div style={mutedTextStyle}>
        {t("Governed Telegram publishing plus Telegram operator coverage for tasks, approvals, joins, and budgets.")}
      </div>
      <div style={{ display: "grid", gap: "4px", fontSize: "12px" }}>
        <div>{t("Default channel")}: {overview.data?.config?.defaultChatId ?? t("not configured")}</div>
        <div>{t("Destinations")}: {overview.data?.destinations.length ?? 0}</div>
        <div>{t("Sources")}: {overview.data?.sources.length ?? 0}</div>
        <div>{t("Linked chats")}: {overview.data?.linkedChats.filter((chat) => !chat.revokedAt).length ?? 0}</div>
        <div>{t("Blocked tasks")}: {overview.data?.blockedTaskCount ?? 0}</div>
        <div>{t("Board approvals")}: {overview.data?.actionableApprovalCount ?? 0}</div>
        <div>{t("Pending joins")}: {overview.data?.pendingJoinRequestCount ?? 0}</div>
        <div>{t("Open budget incidents")}: {overview.data?.openBudgetIncidentCount ?? 0}</div>
        <div>{t("Recent publishes")}: {overview.data?.recentPublications.length ?? 0}</div>
        <div>{t("Scheduled queue")}: {overview.data?.scheduledPublishCount ?? 0}</div>
        <div>{t("Ingested stories")}: {overview.data?.ingestedStoryCount ?? 0}</div>
        <div>{t("Last publish")}: {formatTimestamp(overview.data?.lastPublication?.sentAt, locale)}</div>
      </div>
      <div style={rowStyle}>
        <a href={pluginPagePath(context.companyPrefix)} style={{ fontSize: "12px" }}>{t("Open Telegram dashboard")}</a>
      </div>
    </div>
  );
}

export function TelegramSidebarLink({ context }: PluginSidebarProps) {
  const locale = context.locale;
  const t = (value: string) => translateTelegramText(locale, value);
  const href = pluginPagePath(context.companyPrefix);
  const isActive = typeof window !== "undefined" && window.location.pathname === href;

  return (
    <a
      href={href}
      aria-current={isActive ? "page" : undefined}
      className={[
        "flex items-center gap-2.5 px-3 py-2 text-[13px] font-medium transition-colors",
        isActive
          ? "bg-accent text-foreground"
          : "text-foreground/80 hover:bg-accent/50 hover:text-foreground",
      ].join(" ")}
    >
      <span className="relative shrink-0">
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M21 4L3 11l7 2 2 7 9-16Z" />
        </svg>
      </span>
      <span className="flex-1 truncate">{t("Telegram")}</span>
    </a>
  );
}

export function TelegramPage({ context }: PluginPageProps) {
  const locale = context.locale;
  const t = (value: string) => translateTelegramText(locale, value);
  const overview = usePluginData<TelegramOverview>(DATA_KEYS.overview, context.companyId ? { companyId: context.companyId } : {});
  const companyApprovals = useCompanyTelegramApprovals(context.companyId);

  const telegramApprovals = useMemo(
    () => sortApprovalsNewestFirst(companyApprovals.approvals.filter(isTelegramPublishApproval)),
    [companyApprovals.approvals],
  );
  const pendingApprovals = telegramApprovals.filter((approval) => approval.status === "pending" || approval.status === "revision_requested");

  return (
    <div style={layoutStack}>
      <div style={cardStyle}>
        <div style={{ ...rowStyle, justifyContent: "space-between" }}>
          <div style={{ display: "grid", gap: "8px" }}>
            <div style={sectionTitleStyle}>{t("Telegram Operations")}</div>
            <div style={mutedTextStyle}>
              {t("Company-level view of Telegram capability readiness, pending publish approvals, and recent outbound posts.")}
            </div>
          </div>
          <div style={rowStyle}>
            {overview.data?.configured ? <Pill label="Ready" tone="success" locale={locale} /> : <Pill label="Needs setup" tone="warn" locale={locale} />}
            <a href={`/instance/settings/plugins/${PLUGIN_ID}`} style={{ fontSize: "12px" }}>{t("Open settings")}</a>
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gap: "14px", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
        <div style={cardStyle}>
          <div style={sectionTitleStyle}>{t("Connection")}</div>
          <div style={{ ...layoutStack, gap: "8px", marginTop: "10px" }}>
            <div style={{ fontSize: "12px" }}>{t("Default channel")}: {overview.data?.config?.defaultChatId ?? t("not configured")}</div>
            <div style={{ fontSize: "12px" }}>{t("Public handle")}: {overview.data?.config?.defaultPublicHandle ? `@${overview.data.config.defaultPublicHandle}` : t("not set")}</div>
            <div style={{ fontSize: "12px" }}>{t("Destinations")}: {overview.data?.destinations.length ?? 0}</div>
            <div style={{ fontSize: "12px" }}>{t("Sources")}: {overview.data?.sources.length ?? 0}</div>
            <div style={{ fontSize: "12px" }}>{t("Last validation")}: {formatTimestamp(overview.data?.lastValidation?.checkedAt, locale)}</div>
            <div style={{ fontSize: "12px" }}>{t("Bot")}: {overview.data?.lastValidation?.bot?.username ? `@${overview.data.lastValidation.bot.username}` : (overview.data?.lastValidation?.bot?.firstName ?? t("unknown"))}</div>
          </div>
        </div>
        <div style={cardStyle}>
          <div style={sectionTitleStyle}>{t("Task Bot")}</div>
          <div style={{ ...layoutStack, gap: "8px", marginTop: "10px" }}>
            <div style={{ fontSize: "12px" }}>{t("Enabled")}: {overview.data?.companySettings.taskBot.enabled ? t("yes") : t("no")}</div>
            <div style={{ fontSize: "12px" }}>{t("Approvals inbox enabled")}: {overview.data?.approvalsInboxEnabled ? t("yes") : t("no")}</div>
            <div style={{ fontSize: "12px" }}>{t("Linked chats")}: {overview.data?.linkedChats.filter((chat) => !chat.revokedAt).length ?? 0}</div>
            <div style={{ fontSize: "12px" }}>{t("Blocked tasks")}: {overview.data?.blockedTaskCount ?? 0}</div>
            <div style={{ fontSize: "12px" }}>{t("Open tasks")}: {overview.data?.openTaskCount ?? 0}</div>
            <div style={{ fontSize: "12px" }}>{t("Tasks in review")}: {overview.data?.reviewTaskCount ?? 0}</div>
            <div style={{ fontSize: "12px" }}>{t("Last poll")}: {formatTimestamp(overview.data?.botHealth?.checkedAt, locale)}</div>
            <div style={{ fontSize: "12px" }}>{t("Last ingestion")}: {formatTimestamp(overview.data?.botHealth?.lastIngestionAt, locale)}</div>
          </div>
        </div>
        <div style={cardStyle}>
          <div style={sectionTitleStyle}>{t("Approvals Inbox")}</div>
          <div style={{ ...layoutStack, gap: "8px", marginTop: "10px" }}>
            <div style={{ fontSize: "12px" }}>{t("Board queue")}: {overview.data?.actionableApprovalCount ?? 0}</div>
            <div style={{ fontSize: "12px" }}>{t("My pending approvals")}: {overview.data?.myPendingApprovalCount ?? 0}</div>
            <div style={{ fontSize: "12px" }}>{t("My revision requests")}: {overview.data?.myRevisionApprovalCount ?? 0}</div>
            <div style={{ fontSize: "12px" }}>{t("Last approval notification")}: {formatTimestamp(overview.data?.botHealth?.lastApprovalNotificationAt, locale)}</div>
            <div style={{ fontSize: "12px" }}>{t("Pending join requests")}: {overview.data?.pendingJoinRequestCount ?? 0}</div>
            <div style={{ fontSize: "12px" }}>{t("Open budget incidents")}: {overview.data?.openBudgetIncidentCount ?? 0}</div>
            <div style={{ fontSize: "12px" }}>{t("Last control-plane notification")}: {formatTimestamp(overview.data?.botHealth?.lastControlPlaneNotificationAt, locale)}</div>
            <div style={{ fontSize: "12px" }}>{t("Total Telegram publish approvals")}: {telegramApprovals.length}</div>
            {pendingApprovals[0] ? (
              <a href={`/approvals/${pendingApprovals[0].id}`} style={{ fontSize: "12px" }}>
                {t("Open latest pending approval")}
              </a>
            ) : (
              <div style={mutedTextStyle}>{t("No pending Telegram publish approvals.")}</div>
            )}
          </div>
        </div>
        <div style={cardStyle}>
          <div style={sectionTitleStyle}>{t("Recent publishing")}</div>
          <div style={{ ...layoutStack, gap: "8px", marginTop: "10px" }}>
            <div style={{ fontSize: "12px" }}>{t("Recent posts tracked")}: {overview.data?.recentPublications.length ?? 0}</div>
            <div style={{ fontSize: "12px" }}>{t("Scheduled publishes")}: {overview.data?.scheduledPublishCount ?? 0}</div>
            <div style={{ fontSize: "12px" }}>{t("Failed publishes")}: {overview.data?.failedPublishCount ?? 0}</div>
            <div style={{ fontSize: "12px" }}>{t("Ingested stories")}: {overview.data?.ingestedStoryCount ?? 0}</div>
            <div style={{ fontSize: "12px" }}>{t("Last publish dispatch")}: {formatTimestamp(overview.data?.botHealth?.lastPublishDispatchAt, locale)}</div>
            <div style={{ fontSize: "12px" }}>{t("Last post")}: {formatTimestamp(overview.data?.lastPublication?.sentAt, locale)}</div>
            {overview.data?.lastPublication?.url ? (
              <a href={overview.data.lastPublication.url} target="_blank" rel="noreferrer" style={{ fontSize: "12px" }}>
                {t("Open latest Telegram post")}
              </a>
            ) : (
              <div style={mutedTextStyle}>{t("No public Telegram post URL recorded yet.")}</div>
            )}
          </div>
        </div>
      </div>

      <div style={cardStyle}>
        <div style={sectionTitleStyle}>{t("Recent publications")}</div>
        <div style={{ marginTop: "12px" }}>
          <PublicationList publications={overview.data?.recentPublications ?? []} locale={locale} />
        </div>
      </div>

      <div style={cardStyle}>
        <div style={sectionTitleStyle}>{t("Scheduled queue")}</div>
        <div style={{ marginTop: "12px" }}>
          <PublicationJobList jobs={overview.data?.scheduledPublications ?? []} locale={locale} />
        </div>
      </div>

      <div style={cardStyle}>
        <div style={sectionTitleStyle}>{t("Recent ingested stories")}</div>
        <div style={{ marginTop: "12px" }}>
          <SourceMessageList stories={overview.data?.recentIngestedStories ?? []} locale={locale} />
        </div>
      </div>
    </div>
  );
}

export function TelegramIssueTab({ context }: PluginDetailTabProps) {
  const locale = context.locale;
  const t = (value: string) => translateTelegramText(locale, value);
  const companyId = context.companyId;
  const issueId = context.entityId;
  const pushToast = usePluginToast();
  const publishMessage = usePluginAction(ACTION_KEYS.publishMessage);
  const scheduleMessage = usePluginAction(ACTION_KEYS.scheduleMessage);
  const cancelPublicationJob = usePluginAction(ACTION_KEYS.cancelPublicationJob);
  const reschedulePublicationJob = usePluginAction(ACTION_KEYS.reschedulePublicationJob);
  const { issue, approvals, loading, error, refresh } = useIssueTelegramResources(issueId);
  const issuePublications = usePluginData<TelegramPublication[]>(
    DATA_KEYS.issuePublications,
    companyId && issueId ? { companyId, issueId } : {},
  );
  const issuePublicationJobs = usePluginData<TelegramPublicationJob[]>(
    DATA_KEYS.issuePublicationJobs,
    companyId && issueId ? { companyId, issueId } : {},
  );
  const [selectedDocumentKey, setSelectedDocumentKey] = useState("");
  const [composerText, setComposerText] = useState("");
  const [destinationId, setDestinationId] = useState("");
  const [destinationLabel, setDestinationLabel] = useState("");
  const [chatId, setChatId] = useState("");
  const [publicHandle, setPublicHandle] = useState("");
  const [parseMode, setParseMode] = useState<"" | "HTML" | "MarkdownV2">("");
  const [disableLinkPreview, setDisableLinkPreview] = useState(false);
  const [disableNotification, setDisableNotification] = useState(false);
  const [publishAt, setPublishAt] = useState("");
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const overview = usePluginData<TelegramOverview>(DATA_KEYS.overview, companyId ? { companyId } : {});

  const telegramApprovals = useMemo(
    () => sortApprovalsNewestFirst(approvals.filter(isTelegramPublishApproval)),
    [approvals],
  );
  const latestPendingApproval = telegramApprovals.find((approval) => approval.status === "pending" || approval.status === "revision_requested") ?? null;
  const latestApprovedApproval = telegramApprovals.find((approval) => approval.status === "approved") ?? null;
  const telegramWorkProducts = useMemo(
    () => (issue?.workProducts ?? []).filter(isTelegramWorkProduct),
    [issue?.workProducts],
  );
  const draftWorkProduct = telegramWorkProducts.find((product) => product.status === "draft") ?? null;
  const destinationOptions = overview.data?.destinations ?? [];
  const selectedDestination = destinationOptions.find((destination) => destination.id === destinationId) ?? null;
  const activePublicationJob = useMemo(
    () => (issuePublicationJobs.data ?? []).find((job) => ["pending", "scheduled", "sending"].includes(job.status)) ?? null,
    [issuePublicationJobs.data],
  );

  const documentOptions = useMemo(() => {
    const summaries = issue?.documentSummaries ?? [];
    const seen = new Set<string>();
    const ordered: IssueDocumentSummary[] = [];

    if (issue?.planDocument?.key) {
      ordered.push(issue.planDocument);
      seen.add(issue.planDocument.key);
    }
    for (const summary of summaries) {
      if (seen.has(summary.key)) continue;
      ordered.push(summary);
      seen.add(summary.key);
    }
    return ordered;
  }, [issue?.documentSummaries, issue?.planDocument]);

  useEffect(() => {
    if (selectedDocumentKey || documentOptions.length === 0) return;
    const preferred = documentOptions.find((entry) => ["telegram-final-copy", "telegram-draft", "final", "draft", "plan"].includes(entry.key))
      ?? documentOptions[0]
      ?? null;
    if (preferred) {
      setSelectedDocumentKey(preferred.key);
    }
  }, [documentOptions, selectedDocumentKey]);

  useEffect(() => {
    if (destinationId) return;
    const candidate = trimToNull(latestApprovedApproval?.payload.destinationId)
      ?? trimToNull(latestPendingApproval?.payload.destinationId)
      ?? overview.data?.companySettings.publishing.defaultDestinationId
      ?? destinationOptions[0]?.id
      ?? "";
    if (candidate) setDestinationId(candidate);
  }, [
    destinationId,
    latestApprovedApproval?.payload.destinationId,
    latestPendingApproval?.payload.destinationId,
    overview.data?.companySettings.publishing.defaultDestinationId,
    destinationOptions,
  ]);

  useEffect(() => {
    if (!selectedDestination) return;
    setDestinationLabel(selectedDestination.label);
    setChatId(selectedDestination.chatId);
    setPublicHandle(selectedDestination.publicHandle);
    setParseMode(selectedDestination.parseMode);
    setDisableLinkPreview(selectedDestination.disableLinkPreview);
    setDisableNotification(selectedDestination.disableNotification);
  }, [selectedDestination]);

  useEffect(() => {
    if (publishAt) return;
    const candidate = activePublicationJob?.publishAt
      ?? trimToNull(latestApprovedApproval?.payload.publishAt)
      ?? trimToNull(latestPendingApproval?.payload.publishAt)
      ?? "";
    const nextValue = toDateTimeLocalValue(candidate);
    if (nextValue) setPublishAt(nextValue);
  }, [publishAt, activePublicationJob?.publishAt, latestApprovedApproval?.payload.publishAt, latestPendingApproval?.payload.publishAt]);

  async function loadSelectedDocumentBody() {
    if (!issueId || !selectedDocumentKey) return;
    setBusyAction("load-document");
    try {
      let document: IssueDocument | null = null;
      if (issue?.planDocument?.key === selectedDocumentKey) {
        document = issue.planDocument;
      } else {
        document = await hostFetchJson<IssueDocument>(`/api/issues/${issueId}/documents/${encodeURIComponent(selectedDocumentKey)}`);
      }
      if (!document) throw new Error("Document not found");
      setComposerText(document.body);
      pushToast({
        title: t("Draft loaded"),
        body: translateTelegramTemplate(locale, `Loaded ${document.key} into the Telegram composer.`, `Документ ${document.key} загружен в редактор Telegram.`),
        tone: "success",
      });
    } catch (nextError) {
      pushToast({
        title: t("Failed to load document"),
        body: nextError instanceof Error ? nextError.message : String(nextError),
        tone: "error",
      });
    } finally {
      setBusyAction(null);
    }
  }

  function getSelectedSourceDocumentId() {
    return documentOptions.find((entry) => entry.key === selectedDocumentKey)?.id ?? null;
  }

  async function upsertTelegramDraftDocument() {
    if (!issueId) throw new Error("Issue context is required");
    const [draftDocument, finalDocument] = await Promise.all([
      hostFetchJson<IssueDocument>(`/api/issues/${issueId}/documents/telegram-draft`, {
        method: "PUT",
        body: JSON.stringify({
          title: t("Telegram Draft"),
          format: "markdown",
          body: composerText,
          changeSummary: t("Updated from Telegram issue tab"),
        }),
      }),
      hostFetchJson<IssueDocument>(`/api/issues/${issueId}/documents/telegram-final-copy`, {
        method: "PUT",
        body: JSON.stringify({
          title: t("Telegram Final Copy"),
          format: "markdown",
          body: composerText,
          changeSummary: t("Synced final copy from Telegram issue tab"),
        }),
      }),
    ]);
    return { draftDocument, finalDocument };
  }

  async function saveDraftOutput() {
    if (!issueId) return;
    if (!composerText.trim()) {
      pushToast({
        title: t("Draft is empty"),
        body: t("Load a document or write the Telegram post before saving the draft output."),
        tone: "error",
      });
      return;
    }

    setBusyAction("save-draft");
    try {
      const { draftDocument, finalDocument } = await upsertTelegramDraftDocument();
      const basePayload = {
        type: "artifact",
        provider: "telegram",
        title: issue?.identifier
          ? translateTelegramTemplate(locale, `Telegram draft for ${issue.identifier}`, `Черновик Telegram для ${issue.identifier}`)
          : translateTelegramTemplate(locale, `Telegram draft for ${issue?.title ?? "issue"}`, `Черновик Telegram для ${issue?.title ?? "задачи"}`),
        status: "draft",
        reviewState: "needs_board_review",
        isPrimary: true,
        healthStatus: "unknown",
        summary: excerpt(composerText),
        metadata: {
          publication: {
            channel: "telegram",
            destinationId: destinationId || null,
            destinationLabel: destinationLabel || chatId || null,
            draftDocumentId: draftDocument.id,
            finalDocumentId: finalDocument.id,
            sourceDocumentId: getSelectedSourceDocumentId(),
            publishAt: trimToNull(publishAt),
          },
          chatId: trimToNull(chatId),
          publicHandle: sanitizeHandle(publicHandle),
        },
      };

      if (draftWorkProduct) {
        await hostFetchJson(`/api/work-products/${draftWorkProduct.id}`, {
          method: "PATCH",
          body: JSON.stringify(basePayload),
        });
      } else {
        await hostFetchJson(`/api/issues/${issueId}/work-products`, {
          method: "POST",
          body: JSON.stringify(basePayload),
        });
      }

      await refresh();
      pushToast({
        title: t("Telegram draft saved"),
        body: t("Draft document and work product are now attached to the issue."),
        tone: "success",
      });
    } catch (nextError) {
      pushToast({
        title: t("Failed to save Telegram draft"),
        body: nextError instanceof Error ? nextError.message : String(nextError),
        tone: "error",
      });
    } finally {
      setBusyAction(null);
    }
  }

  async function requestPublishApproval() {
    if (!companyId || !issueId) return;
    if (!composerText.trim()) {
      pushToast({
        title: t("Draft is empty"),
        body: t("Save or compose the Telegram draft before requesting approval."),
        tone: "error",
      });
      return;
    }

    setBusyAction("request-approval");
    try {
      const { draftDocument, finalDocument } = await upsertTelegramDraftDocument();
      const approval = await hostFetchJson<Approval>(`/api/companies/${companyId}/approvals`, {
        method: "POST",
        body: JSON.stringify({
          type: "publish_content",
          payload: {
            channel: "telegram",
            destinationId: destinationId || null,
            destinationLabel: destinationLabel || chatId || null,
            publishAt: trimToNull(publishAt),
            authorVoice: "telegram",
            sourceSummary: issue?.title ?? null,
            riskFlags: [],
            safetyChecks: [],
            sourceDocumentId: getSelectedSourceDocumentId(),
            draftDocumentId: draftDocument.id,
            finalDocumentId: finalDocument.id,
          },
          issueIds: [issueId],
        }),
      });
      await refresh();
      pushToast({
        title: t("Publish approval requested"),
        body: translateTelegramTemplate(locale, `Approval ${approval.id} is ready for board review.`, `Согласование ${approval.id} готово для review на board.`),
        tone: "success",
      });
    } catch (nextError) {
      pushToast({
        title: t("Failed to request publish approval"),
        body: nextError instanceof Error ? nextError.message : String(nextError),
        tone: "error",
      });
    } finally {
      setBusyAction(null);
    }
  }

  async function publishApprovedMessage() {
    if (!issueId || !companyId || !issue) return;
    if (!latestApprovedApproval) {
      pushToast({
        title: t("Publish approval required"),
        body: t("Approve the Telegram publish request before sending the message."),
        tone: "error",
      });
      return;
    }
    if (!composerText.trim()) {
      pushToast({
        title: t("Draft is empty"),
        body: t("Write the Telegram post before publishing it."),
        tone: "error",
      });
      return;
    }

    setBusyAction("publish-message");
    try {
      const publication = await publishMessage({
        companyId,
        issueId,
        issueIdentifier: issue.identifier,
        issueTitle: issue.title,
        approvalId: latestApprovedApproval.id,
        text: composerText,
        destinationId: destinationId || null,
        destinationLabel: destinationLabel || chatId || null,
        chatId: chatId || null,
        publicHandle: sanitizeHandle(publicHandle),
        parseMode: parseMode || null,
        disableLinkPreview,
        disableNotification,
      }) as TelegramPublication;

      const finalPayload = {
        type: "artifact",
        provider: "telegram",
        title: issue.identifier
          ? translateTelegramTemplate(locale, `Telegram post for ${issue.identifier}`, `Пост Telegram для ${issue.identifier}`)
          : translateTelegramTemplate(locale, `Telegram post for ${issue.title}`, `Пост Telegram для ${issue.title}`),
        status: "approved",
        reviewState: "approved",
        isPrimary: true,
        healthStatus: "healthy",
        summary: publication.summary,
        url: publication.url,
        externalId: publication.externalId,
        metadata: {
          publication: {
            channel: "telegram",
            destinationId: publication.destinationId,
            destinationLabel: publication.destinationLabel,
            approvalId: publication.approvalId,
            messageId: publication.messageId,
            chatId: publication.chatId,
            sentAt: publication.sentAt,
          },
          publicHandle: publication.publicHandle,
          parseMode: publication.parseMode,
          chatTitle: publication.chatTitle,
        },
      };

      if (draftWorkProduct) {
        await hostFetchJson(`/api/work-products/${draftWorkProduct.id}`, {
          method: "PATCH",
          body: JSON.stringify(finalPayload),
        });
      } else {
        await hostFetchJson(`/api/issues/${issueId}/work-products`, {
          method: "POST",
          body: JSON.stringify(finalPayload),
        });
      }

      await Promise.all([
        refresh(),
        issuePublications.refresh(),
        issuePublicationJobs.refresh(),
        overview.refresh(),
      ]);
      pushToast({
        title: t("Telegram post published"),
        body: publication.url
          ? t("The issue now has a visible Telegram work product with a clickable post URL.")
          : t("The issue now has a Telegram work product. Set a public handle to expose clickable post URLs."),
        tone: "success",
      });
    } catch (nextError) {
      pushToast({
        title: t("Failed to publish Telegram post"),
        body: nextError instanceof Error ? nextError.message : String(nextError),
        tone: "error",
      });
    } finally {
      setBusyAction(null);
    }
  }

  async function schedulePublication() {
    if (!companyId || !issueId) return;
    if (!latestApprovedApproval) {
      pushToast({
        title: t("Publish approval required"),
        body: t("Approve the Telegram publish request before scheduling the delivery queue."),
        tone: "error",
      });
      return;
    }
    setBusyAction(activePublicationJob ? "reschedule-publication" : "schedule-publication");
    try {
      const response = activePublicationJob
        ? await reschedulePublicationJob({
          companyId,
          jobId: activePublicationJob.id,
          publishAt: trimToNull(publishAt) ?? activePublicationJob.publishAt,
        })
        : await scheduleMessage({
          companyId,
          issueId,
          approvalId: latestApprovedApproval.id,
          destinationId: destinationId || null,
          publishAt: trimToNull(publishAt),
          createdByUserId: context.userId ?? null,
        });
      await Promise.all([
        issuePublicationJobs.refresh(),
        overview.refresh(),
      ]);
      pushToast({
        title: activePublicationJob ? t("Telegram publish rescheduled") : t("Telegram publish scheduled"),
        body: translateTelegramTemplate(
          locale,
          `Queue item ${String((response as { id?: string }).id ?? "updated")} is ready.`,
          `Элемент очереди ${String((response as { id?: string }).id ?? "обновлён")} готов.`,
        ),
        tone: "success",
      });
    } catch (nextError) {
      pushToast({
        title: activePublicationJob ? t("Failed to reschedule Telegram publish") : t("Failed to schedule Telegram publish"),
        body: nextError instanceof Error ? nextError.message : String(nextError),
        tone: "error",
      });
    } finally {
      setBusyAction(null);
    }
  }

  async function cancelScheduledPublication() {
    if (!companyId || !activePublicationJob?.id) return;
    setBusyAction("cancel-publication");
    try {
      await cancelPublicationJob({
        companyId,
        jobId: activePublicationJob.id,
      });
      await Promise.all([
        issuePublicationJobs.refresh(),
        overview.refresh(),
      ]);
      pushToast({
        title: t("Telegram publish cancelled"),
        body: t("The scheduled queue item was cancelled."),
        tone: "success",
      });
    } catch (nextError) {
      pushToast({
        title: t("Failed to cancel Telegram publish"),
        body: nextError instanceof Error ? nextError.message : String(nextError),
        tone: "error",
      });
    } finally {
      setBusyAction(null);
    }
  }

  if (!companyId || !issueId) {
    return <div style={mutedTextStyle}>{t("Issue context is required.")}</div>;
  }

  if (loading && !issue) {
    return <div style={mutedTextStyle}>{t("Loading Telegram issue workflow...")}</div>;
  }

  if (error) {
    return <div style={{ color: "var(--destructive, #c00)", fontSize: "12px" }}>{error}</div>;
  }

  return (
    <div style={layoutStack}>
      <div style={cardStyle}>
        <div style={{ ...rowStyle, justifyContent: "space-between" }}>
          <div style={{ display: "grid", gap: "8px" }}>
            <div style={sectionTitleStyle}>{t("Telegram publish handoff")}</div>
            <div style={mutedTextStyle}>
              {t("Keep the draft, approval, and final Telegram post attached to this issue instead of hiding the distribution workflow in comments.")}
            </div>
          </div>
          <div style={rowStyle}>
            {latestApprovedApproval ? <Pill label="Approved to publish" tone="success" locale={locale} /> : null}
            {latestPendingApproval ? <Pill label="Approval pending" tone="warn" locale={locale} /> : null}
            <a href={pluginPagePath(context.companyPrefix)} style={{ fontSize: "12px" }}>{t("Open Telegram dashboard")}</a>
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gap: "16px", gridTemplateColumns: "minmax(0, 1.2fr) minmax(280px, 0.8fr)" }}>
        <div style={{ ...cardStyle, ...layoutStack }}>
          <div style={sectionTitleStyle}>{t("Composer")}</div>
          <SettingsField
            label="Load issue document"
            hint="Use an existing issue document as the starting point, then adjust the final Telegram copy here."
            locale={locale}
          >
            <div style={rowStyle}>
              <select
                style={{ ...inputStyle, flex: 1 }}
                value={selectedDocumentKey}
                onChange={(event) => setSelectedDocumentKey(event.target.value)}
              >
                <option value="">{t("Select document...")}</option>
                {documentOptions.map((document) => (
                  <option key={document.key} value={document.key}>
                    {document.title ?? document.key}
                  </option>
                ))}
              </select>
              <button
                type="button"
                style={buttonStyle}
                disabled={!selectedDocumentKey || busyAction === "load-document"}
                onClick={() => void loadSelectedDocumentBody()}
              >
                  {busyAction === "load-document" ? t("Loading...") : t("Load")}
              </button>
            </div>
          </SettingsField>

          <SettingsField
            label="Telegram draft"
            hint="This is the exact text that will be saved for review and later sent to Telegram."
            locale={locale}
          >
            <textarea
              style={textareaStyle}
              value={composerText}
              onChange={(event) => setComposerText(event.target.value)}
              placeholder={t("Write the final Telegram post here...")}
            />
          </SettingsField>

          <div style={{ display: "grid", gap: "12px", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
            <SettingsField label="Configured destination" locale={locale}>
              <select
                style={inputStyle}
                value={destinationId}
                onChange={(event) => setDestinationId(event.target.value)}
              >
                <option value="">{t("Use default destination")}</option>
                {destinationOptions.map((destination) => (
                  <option key={destination.id} value={destination.id}>
                    {destination.label} {destination.enabled ? "" : t("(disabled)")}
                  </option>
                ))}
              </select>
            </SettingsField>
            <SettingsField label="Destination label" locale={locale}>
              <input
                style={inputStyle}
                value={destinationLabel}
                onChange={(event) => setDestinationLabel(event.target.value)}
                placeholder="@my_channel"
              />
            </SettingsField>
            <SettingsField label="Chat id / username" locale={locale}>
              <input
                style={inputStyle}
                value={chatId}
                onChange={(event) => setChatId(event.target.value)}
                placeholder="@my_channel"
              />
            </SettingsField>
            <SettingsField label="Public handle" locale={locale}>
              <input
                style={inputStyle}
                value={publicHandle}
                onChange={(event) => setPublicHandle(event.target.value)}
                placeholder="@my_channel"
              />
            </SettingsField>
            <SettingsField label="Parse mode" locale={locale}>
              <select
                style={inputStyle}
                value={parseMode}
                onChange={(event) => setParseMode(event.target.value as "" | "HTML" | "MarkdownV2")}
              >
                <option value="">{t("Plain text")}</option>
                <option value="HTML">HTML</option>
                <option value="MarkdownV2">MarkdownV2</option>
              </select>
            </SettingsField>
            <SettingsField label="Publish at" locale={locale}>
              <input
                style={inputStyle}
                type="datetime-local"
                value={publishAt}
                onChange={(event) => setPublishAt(event.target.value)}
              />
            </SettingsField>
          </div>

          <div style={rowStyle}>
            <label style={rowStyle}>
              <input
                type="checkbox"
                checked={disableLinkPreview}
                onChange={(event) => setDisableLinkPreview(event.target.checked)}
              />
              <span style={{ fontSize: "12px" }}>{t("Disable link preview")}</span>
            </label>
            <label style={rowStyle}>
              <input
                type="checkbox"
                checked={disableNotification}
                onChange={(event) => setDisableNotification(event.target.checked)}
              />
              <span style={{ fontSize: "12px" }}>{t("Send silently")}</span>
            </label>
          </div>

          <div style={rowStyle}>
            <button
              type="button"
              style={buttonStyle}
              disabled={busyAction === "save-draft"}
              onClick={() => void saveDraftOutput()}
            >
              {busyAction === "save-draft" ? t("Saving...") : t("Save draft output")}
            </button>
            {latestPendingApproval ? (
              <a href={`/approvals/${latestPendingApproval.id}`} style={{ ...buttonStyle, textDecoration: "none" }}>
                {t("Open pending approval")}
              </a>
            ) : (
              <button
                type="button"
                style={buttonStyle}
                disabled={busyAction === "request-approval"}
                onClick={() => void requestPublishApproval()}
              >
                {busyAction === "request-approval" ? t("Requesting...") : t("Request publish approval")}
              </button>
            )}
            <button
              type="button"
              style={buttonStyle}
              disabled={busyAction === "schedule-publication" || busyAction === "reschedule-publication" || !latestApprovedApproval}
              onClick={() => void schedulePublication()}
            >
              {busyAction === "schedule-publication"
                ? t("Scheduling...")
                : busyAction === "reschedule-publication"
                  ? t("Rescheduling...")
                  : activePublicationJob
                    ? t("Reschedule publish")
                    : t("Schedule publish")}
            </button>
            {activePublicationJob ? (
              <button
                type="button"
                style={buttonStyle}
                disabled={busyAction === "cancel-publication"}
                onClick={() => void cancelScheduledPublication()}
              >
                {busyAction === "cancel-publication" ? t("Cancelling...") : t("Cancel scheduled publish")}
              </button>
            ) : null}
            <button
              type="button"
              style={primaryButtonStyle}
              disabled={busyAction === "publish-message" || !latestApprovedApproval}
              onClick={() => void publishApprovedMessage()}
            >
              {busyAction === "publish-message" ? t("Publishing...") : t("Publish approved message")}
            </button>
          </div>
        </div>

        <div style={{ ...cardStyle, ...layoutStack }}>
          <div style={sectionTitleStyle}>{t("State")}</div>
          <div style={{ display: "grid", gap: "8px", fontSize: "12px" }}>
            <div>{t("Issue")}: {issue?.identifier ?? issue?.title ?? t("unknown")}</div>
            <div>{t("Telegram work products")}: {telegramWorkProducts.length}</div>
            <div>{t("Linked Telegram approvals")}: {telegramApprovals.length}</div>
            <div>{t("Recent issue publishes")}: {issuePublications.data?.length ?? 0}</div>
            <div>{t("Queued publish jobs")}: {(issuePublicationJobs.data ?? []).filter((job) => ["pending", "scheduled", "sending"].includes(job.status)).length}</div>
          </div>

          {latestApprovedApproval ? (
            <div style={{ border: "1px solid var(--border)", borderRadius: "10px", padding: "12px" }}>
              <div style={{ fontSize: "12px", fontWeight: 600 }}>{t("Latest approved publish")}</div>
              <div style={mutedTextStyle}>
                {translateTelegramTemplate(
                  locale,
                  `Approval ${latestApprovedApproval.id} approved for ${approvalDestinationLabel(latestApprovedApproval) ?? "Telegram"}.`,
                  `Согласование ${latestApprovedApproval.id} утверждено для ${approvalDestinationLabel(latestApprovedApproval) ?? "Telegram"}.`,
                )}
              </div>
              <a href={`/approvals/${latestApprovedApproval.id}`} style={{ fontSize: "12px" }}>
                {t("Open approval")}
              </a>
            </div>
          ) : (
            <div style={mutedTextStyle}>
              {t("No approved Telegram publish approval is linked to this issue yet.")}
            </div>
          )}

          {telegramWorkProducts.length > 0 ? (
            <div style={{ display: "grid", gap: "8px" }}>
              <div style={{ fontSize: "12px", fontWeight: 600 }}>{t("Existing Telegram outputs")}</div>
              {telegramWorkProducts.map((product) => (
                <div key={product.id} style={{ border: "1px solid var(--border)", borderRadius: "10px", padding: "10px" }}>
                  <div style={{ ...rowStyle, justifyContent: "space-between" }}>
                    <strong style={{ fontSize: "12px" }}>{product.title}</strong>
                    <Pill label={product.status} tone={product.status === "approved" ? "success" : product.status === "draft" ? "warn" : "neutral"} locale={locale} />
                  </div>
                  {product.summary ? <div style={mutedTextStyle}>{product.summary}</div> : null}
                  {product.url ? (
                    <a href={product.url} target="_blank" rel="noreferrer" style={{ fontSize: "12px" }}>
                      {t("Open Telegram link")}
                    </a>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}

          {activePublicationJob ? (
            <div style={{ border: "1px solid var(--border)", borderRadius: "10px", padding: "12px", display: "grid", gap: "6px" }}>
              <div style={{ fontSize: "12px", fontWeight: 600 }}>{t("Active queue item")}</div>
              <div style={mutedTextStyle}>
                {translateTelegramText(locale, activePublicationJob.status)} {t("for")} {activePublicationJob.destinationId} {t("at")} {formatTimestamp(activePublicationJob.publishAt, locale)}
              </div>
              {activePublicationJob.failureReason ? <div style={mutedTextStyle}>{activePublicationJob.failureReason}</div> : null}
            </div>
          ) : null}
        </div>
      </div>

      <div style={cardStyle}>
        <div style={sectionTitleStyle}>{t("Scheduled queue for this issue")}</div>
        <div style={{ marginTop: "12px" }}>
          <PublicationJobList jobs={issuePublicationJobs.data ?? []} locale={locale} />
        </div>
      </div>

      <div style={cardStyle}>
        <div style={sectionTitleStyle}>{t("Publication history for this issue")}</div>
        <div style={{ marginTop: "12px" }}>
          <PublicationList publications={issuePublications.data ?? []} locale={locale} />
        </div>
      </div>
    </div>
  );
}
