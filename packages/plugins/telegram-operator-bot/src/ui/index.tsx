import { useEffect, useState, type CSSProperties } from "react";
import {
  usePluginAction,
  usePluginToast,
  type PluginPageProps,
  type PluginSettingsPageProps,
} from "@paperclipai/plugin-sdk/ui";
import { ACTION_KEYS, PAGE_ROUTE, PLUGIN_ID } from "../constants.js";

type Locale = "en" | "ru";

type LinkedChat = {
  chatId: string;
  username: string | null;
  displayName: string;
  boardUserId: string | null;
  linkedAt: string;
  revokedAt: string | null;
};

type Overview = {
  settings: {
    publishing: { botTokenSecretRef: string };
    taskBot: {
      enabled: boolean;
      pollingEnabled: boolean;
      notificationMode: "linked_only" | "fallback_all_linked";
      claimCodeTtlMinutes: number;
    };
  };
  linkedChats: LinkedChat[];
  botHealth: {
    checkedAt: string;
    ok: boolean;
    lastUpdateId: number | null;
    lastNotificationAt: string | null;
    lastApprovalNotificationAt?: string | null;
    lastControlPlaneNotificationAt?: string | null;
    error: string | null;
  } | null;
  blockedTaskCount: number;
  reviewTaskCount: number;
  actionableApprovalCount: number;
  myRevisionApprovalCount: number;
};

type LinkCodeResult = { code: string; expiresAt: string; startCommand: string };

const surface: CSSProperties = { display: "grid", gap: 18 };
const section: CSSProperties = {
  border: "1px solid var(--border)",
  borderRadius: 18,
  padding: 18,
  background: "var(--card, transparent)",
  display: "grid",
  gap: 14,
};
const panel: CSSProperties = {
  border: "1px solid var(--border)",
  borderRadius: 14,
  padding: 14,
  display: "grid",
  gap: 12,
};
const row: CSSProperties = { display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" };
const statCard: CSSProperties = {
  border: "1px solid var(--border)",
  borderRadius: 14,
  padding: 14,
  minWidth: 140,
  display: "grid",
  gap: 6,
};
const input: CSSProperties = {
  width: "100%",
  border: "1px solid var(--border)",
  borderRadius: 12,
  background: "transparent",
  color: "inherit",
  padding: "10px 12px",
  fontSize: 13,
};
const button: CSSProperties = {
  appearance: "none",
  border: "1px solid var(--border)",
  borderRadius: 999,
  background: "transparent",
  color: "inherit",
  padding: "9px 15px",
  fontSize: 12,
  cursor: "pointer",
  textDecoration: "none",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
};
const primary: CSSProperties = {
  ...button,
  background: "var(--foreground)",
  borderColor: "var(--foreground)",
  color: "var(--background)",
};
const muted: CSSProperties = { fontSize: 12, opacity: 0.72, lineHeight: 1.5 };
const label: CSSProperties = { fontSize: 12, fontWeight: 600, opacity: 0.8 };
const danger: CSSProperties = { fontSize: 12, color: "var(--destructive, #d22)", lineHeight: 1.5 };
const pill: CSSProperties = {
  border: "1px solid var(--border)",
  borderRadius: 999,
  padding: "5px 10px",
  fontSize: 11,
  opacity: 0.9,
};

function tr(locale: Locale, en: string, ru: string) {
  return locale === "ru" ? ru : en;
}

function formatDate(locale: Locale, value: string | null | undefined) {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat(locale === "ru" ? "ru-RU" : "en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(parsed);
}

function pageHref(prefix: string | null | undefined) {
  return prefix ? `/${prefix}/${PAGE_ROUTE}` : "#";
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`;
    try {
      const payload = await response.json() as { error?: string };
      if (payload.error) message = payload.error;
    } catch {
      // ignore
    }
    throw new Error(message);
  }
  return response.json() as Promise<T>;
}

function LinkedChatsSection({
  locale,
  chats,
  onRevoke,
}: {
  locale: Locale;
  chats: LinkedChat[];
  onRevoke: (chatId: string) => Promise<void>;
}) {
  if (chats.length === 0) {
    return <div style={muted}>{tr(locale, "No linked private chats yet.", "Пока нет привязанных приватных чатов.")}</div>;
  }

  return (
    <div style={{ display: "grid", gap: 10 }}>
      {chats.map((chat) => (
        <div key={chat.chatId} style={panel}>
          <div style={{ ...row, justifyContent: "space-between" }}>
            <div style={{ display: "grid", gap: 6 }}>
              <strong>{chat.displayName}</strong>
              <div style={muted}>
                {chat.username ? `@${chat.username} · ` : ""}{chat.chatId} · {formatDate(locale, chat.linkedAt)}
              </div>
            </div>
            <button type="button" style={button} onClick={() => void onRevoke(chat.chatId)}>
              {tr(locale, "Revoke", "Отвязать")}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

function OperatorSurface({
  companyId,
  companyPrefix,
  locale,
}: {
  companyId: string | null;
  companyPrefix: string | null;
  locale: Locale;
}) {
  const toast = usePluginToast();
  const generateLinkCode = usePluginAction(ACTION_KEYS.generateLinkCode);
  const revokeLinkedChat = usePluginAction(ACTION_KEYS.revokeLinkedChat);

  const [overview, setOverview] = useState<Overview | null>(null);
  const [token, setToken] = useState("");
  const [lastLinkCode, setLastLinkCode] = useState<LinkCodeResult | null>(null);
  const [settingsDraft, setSettingsDraft] = useState({
    enabled: false,
    pollingEnabled: true,
    notificationMode: "fallback_all_linked" as "linked_only" | "fallback_all_linked",
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingToken, setSavingToken] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);

  const load = async () => {
    if (!companyId) {
      setOverview(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const next = await api<Overview>(`/api/companies/${companyId}/telegram-operator-bot/overview`);
      setOverview(next);
      setSettingsDraft({
        enabled: next.settings.taskBot.enabled,
        pollingEnabled: next.settings.taskBot.pollingEnabled,
        notificationMode: next.settings.taskBot.notificationMode,
      });
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [companyId]);

  async function saveToken() {
    if (!companyId || !token.trim()) return;
    setSavingToken(true);
    try {
      await api(`/api/companies/${companyId}/plugins/${PLUGIN_ID}/managed-secret`, {
        method: "POST",
        body: JSON.stringify({
          settingsPath: "publishing.botTokenSecretRef",
          value: token.trim(),
          secretName: "telegram-operator-bot-token",
          description: "Telegram Operator Bot token",
        }),
      });
      setToken("");
      toast({
        title: tr(locale, "Operator bot token saved", "Токен operator bot сохранен"),
        body: tr(locale, "Stored as a company secret.", "Сохранен как секрет компании."),
        tone: "success",
      });
      await load();
    } catch (nextError) {
      toast({
        title: tr(locale, "Failed to save token", "Не удалось сохранить токен"),
        body: nextError instanceof Error ? nextError.message : String(nextError),
        tone: "error",
      });
    } finally {
      setSavingToken(false);
    }
  }

  async function saveSettings() {
    if (!companyId || !overview) return;
    setSavingSettings(true);
    try {
      await api(`/api/companies/${companyId}/plugins/${PLUGIN_ID}/settings`, {
        method: "POST",
        body: JSON.stringify({
          enabled: true,
          settingsJson: {
            ...overview.settings,
            taskBot: {
              ...overview.settings.taskBot,
              enabled: settingsDraft.enabled,
              pollingEnabled: settingsDraft.pollingEnabled,
              notificationMode: settingsDraft.notificationMode,
            },
          },
        }),
      });
      toast({
        title: tr(locale, "Operator bot settings saved", "Настройки operator bot сохранены"),
        tone: "success",
      });
      await load();
    } catch (nextError) {
      toast({
        title: tr(locale, "Failed to save settings", "Не удалось сохранить настройки"),
        body: nextError instanceof Error ? nextError.message : String(nextError),
        tone: "error",
      });
    } finally {
      setSavingSettings(false);
    }
  }

  async function createLinkCode() {
    if (!companyId) return;
    try {
      const result = await generateLinkCode({ companyId }) as LinkCodeResult;
      setLastLinkCode(result);
      toast({
        title: tr(locale, "Link code created", "Link code создан"),
        body: result.startCommand,
        tone: "success",
      });
      await load();
    } catch (nextError) {
      toast({
        title: tr(locale, "Failed to create link code", "Не удалось создать link code"),
        body: nextError instanceof Error ? nextError.message : String(nextError),
        tone: "error",
      });
    }
  }

  async function revoke(chatId: string) {
    if (!companyId) return;
    try {
      await revokeLinkedChat({ companyId, chatId });
      toast({
        title: tr(locale, "Chat revoked", "Чат отвязан"),
        tone: "success",
      });
      await load();
    } catch (nextError) {
      toast({
        title: tr(locale, "Failed to revoke chat", "Не удалось отвязать чат"),
        body: nextError instanceof Error ? nextError.message : String(nextError),
        tone: "error",
      });
    }
  }

  if (!companyId) return <div style={muted}>{tr(locale, "Company context is required.", "Нужен контекст компании.")}</div>;
  if (loading) return <div style={muted}>{tr(locale, "Loading Telegram Operator Bot...", "Загрузка Telegram Operator Bot...")}</div>;
  if (error) return <div style={danger}>{error}</div>;
  if (!overview) return null;

  return (
    <div style={surface}>
      <section style={section}>
        <div style={{ ...row, justifyContent: "space-between" }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700 }}>{tr(locale, "Telegram Operator Bot", "Telegram Operator Bot")}</div>
            <div style={muted}>
              {tr(
                locale,
                "Private-chat bot for tasks, approvals, joins, budgets, and replies through getUpdates polling.",
                "Приватный бот для задач, approvals, joins, budgets и replies через getUpdates polling.",
              )}
            </div>
          </div>
          {companyPrefix ? (
            <a href={pageHref(companyPrefix)} style={button}>
              {tr(locale, "Open bot page", "Открыть страницу бота")}
            </a>
          ) : null}
        </div>

        <div style={row}>
          <div style={statCard}>
            <strong>{overview.linkedChats.length}</strong>
            <div style={muted}>{tr(locale, "Linked chats", "Связанные чаты")}</div>
          </div>
          <div style={statCard}>
            <strong>{overview.actionableApprovalCount}</strong>
            <div style={muted}>{tr(locale, "Approvals", "Approvals")}</div>
          </div>
          <div style={statCard}>
            <strong>{overview.blockedTaskCount}</strong>
            <div style={muted}>{tr(locale, "Blocked tasks", "Блокеры")}</div>
          </div>
          <div style={statCard}>
            <strong>{overview.reviewTaskCount}</strong>
            <div style={muted}>{tr(locale, "In review", "На ревью")}</div>
          </div>
        </div>

        <div style={row}>
          <span style={pill}>
            {overview.settings.taskBot.enabled
              ? tr(locale, "Bot enabled", "Бот включен")
              : tr(locale, "Bot disabled", "Бот выключен")}
          </span>
          <span style={pill}>
            {overview.settings.publishing.botTokenSecretRef
              ? tr(locale, "Token connected", "Токен подключен")
              : tr(locale, "Token missing", "Нет токена")}
          </span>
          <span style={pill}>
            {overview.settings.taskBot.pollingEnabled
              ? tr(locale, "Polling on", "Polling включен")
              : tr(locale, "Polling off", "Polling выключен")}
          </span>
        </div>

        {overview.botHealth?.error ? <div style={danger}>{overview.botHealth.error}</div> : null}
      </section>

      <section style={section}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700 }}>{tr(locale, "Bot setup", "Настройка бота")}</div>
          <div style={muted}>
            {tr(
              locale,
              "Save the operator bot token, then enable polling and notifications.",
              "Сохрани токен operator bot, затем включи polling и уведомления.",
            )}
          </div>
        </div>

        <div style={panel}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>{tr(locale, "Bot token", "Токен бота")}</div>
          <div style={muted}>
            {overview.settings.publishing.botTokenSecretRef
              ? tr(locale, "Token is already stored in company secrets.", "Токен уже сохранен в секретах компании.")
              : tr(locale, "No token stored yet.", "Токен еще не сохранен.")}
          </div>
          <div style={row}>
            <input
              type="password"
              style={{ ...input, flex: 1, minWidth: 220 }}
              value={token}
              onChange={(event) => setToken(event.target.value)}
              placeholder="123456:ABCDEF..."
            />
            <button type="button" style={primary} disabled={!token.trim() || savingToken} onClick={() => void saveToken()}>
              {savingToken ? "..." : tr(locale, "Save token", "Сохранить токен")}
            </button>
          </div>
        </div>

        <div style={panel}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>{tr(locale, "Operator controls", "Управление ботом")}</div>
          <label style={{ ...row, fontSize: 12 }}>
            <input
              type="checkbox"
              checked={settingsDraft.enabled}
              onChange={(event) => setSettingsDraft((current) => ({ ...current, enabled: event.target.checked }))}
            />
            {tr(locale, "Enable operator bot", "Включить operator bot")}
          </label>
          <label style={{ ...row, fontSize: 12 }}>
            <input
              type="checkbox"
              checked={settingsDraft.pollingEnabled}
              onChange={(event) => setSettingsDraft((current) => ({ ...current, pollingEnabled: event.target.checked }))}
            />
            {tr(locale, "Enable polling", "Включить polling")}
          </label>
          <div style={{ display: "grid", gap: 6 }}>
            <div style={label}>{tr(locale, "Notification mode", "Режим уведомлений")}</div>
            <select
              style={input}
              value={settingsDraft.notificationMode}
              onChange={(event) =>
                setSettingsDraft((current) => ({
                  ...current,
                  notificationMode: event.target.value as "linked_only" | "fallback_all_linked",
                }))}
            >
              <option value="fallback_all_linked">fallback_all_linked</option>
              <option value="linked_only">linked_only</option>
            </select>
          </div>
          <button type="button" style={primary} disabled={savingSettings} onClick={() => void saveSettings()}>
            {savingSettings ? "..." : tr(locale, "Save settings", "Сохранить настройки")}
          </button>
        </div>
      </section>

      <section style={section}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700 }}>{tr(locale, "Linked chats", "Связанные чаты")}</div>
          <div style={muted}>
            {tr(
              locale,
              "Generate a one-time /start code for your private Telegram chat, then revoke chats if needed.",
              "Сгенерируй одноразовый /start code для приватного Telegram-чата и при необходимости отвяжи чат.",
            )}
          </div>
        </div>

        <div style={row}>
          <button type="button" style={primary} onClick={() => void createLinkCode()}>
            {tr(locale, "Generate link code", "Сгенерировать link code")}
          </button>
        </div>

        {lastLinkCode ? (
          <div style={panel}>
            <strong>{lastLinkCode.code}</strong>
            <div style={muted}>{lastLinkCode.startCommand}</div>
            <div style={muted}>{tr(locale, "Expires", "Истекает")}: {formatDate(locale, lastLinkCode.expiresAt)}</div>
          </div>
        ) : null}

        <LinkedChatsSection locale={locale} chats={overview.linkedChats} onRevoke={revoke} />
      </section>

      <section style={section}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700 }}>{tr(locale, "Bot health", "Состояние бота")}</div>
          <div style={muted}>
            {tr(
              locale,
              "This is the operator bot runtime health, not the publishing pipeline.",
              "Это runtime health operator bot, а не publishing pipeline.",
            )}
          </div>
        </div>

        <div style={row}>
          <div style={statCard}>
            <strong>{overview.botHealth?.lastUpdateId ?? "-"}</strong>
            <div style={muted}>{tr(locale, "Last update id", "Последний update id")}</div>
          </div>
          <div style={statCard}>
            <strong>{formatDate(locale, overview.botHealth?.lastNotificationAt ?? null)}</strong>
            <div style={muted}>{tr(locale, "Last notification", "Последнее уведомление")}</div>
          </div>
          <div style={statCard}>
            <strong>{overview.myRevisionApprovalCount}</strong>
            <div style={muted}>{tr(locale, "Revision approvals", "Revision approvals")}</div>
          </div>
        </div>
      </section>
    </div>
  );
}

export function TelegramOperatorSettingsPage({ context }: PluginSettingsPageProps) {
  return (
    <OperatorSurface
      companyId={context.companyId}
      companyPrefix={context.companyPrefix}
      locale={context.locale as Locale}
    />
  );
}

export function TelegramOperatorPage({ context }: PluginPageProps) {
  return (
    <OperatorSurface
      companyId={context.companyId}
      companyPrefix={context.companyPrefix}
      locale={context.locale as Locale}
    />
  );
}
