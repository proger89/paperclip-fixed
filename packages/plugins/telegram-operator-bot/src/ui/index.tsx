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

const stack: CSSProperties = { display: "grid", gap: 16 };
const row: CSSProperties = { display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" };
const card: CSSProperties = { border: "1px solid var(--border)", borderRadius: 14, padding: 16, background: "var(--card, transparent)" };
const input: CSSProperties = { width: "100%", border: "1px solid var(--border)", borderRadius: 10, background: "transparent", color: "inherit", padding: "9px 11px", fontSize: 12 };
const button: CSSProperties = { appearance: "none", border: "1px solid var(--border)", borderRadius: 999, background: "transparent", color: "inherit", padding: "8px 14px", fontSize: 12, cursor: "pointer" };
const primary: CSSProperties = { ...button, background: "var(--foreground)", borderColor: "var(--foreground)", color: "var(--background)" };
const muted: CSSProperties = { fontSize: 12, opacity: 0.72, lineHeight: 1.45 };
const danger: CSSProperties = { ...muted, color: "var(--destructive, #c00)", opacity: 1 };

const t = (locale: Locale, en: string, ru: string) => (locale === "ru" ? ru : en);
const fmt = (locale: Locale, value: string | null | undefined) => {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat(locale === "ru" ? "ru-RU" : "en-US", { dateStyle: "medium", timeStyle: "short" }).format(parsed);
};
const href = (prefix: string | null) => (prefix ? `/${prefix}/${PAGE_ROUTE}` : "#");

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
    } catch {}
    throw new Error(message);
  }
  return response.json() as Promise<T>;
}

function Surface({ companyId, companyPrefix, locale }: { companyId: string | null; companyPrefix: string | null; locale: Locale }) {
  const toast = usePluginToast();
  const generateLinkCode = usePluginAction(ACTION_KEYS.generateLinkCode);
  const revokeLinkedChat = usePluginAction(ACTION_KEYS.revokeLinkedChat);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [token, setToken] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingToken, setSavingToken] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [lastLinkCode, setLastLinkCode] = useState<LinkCodeResult | null>(null);
  const [settingsDraft, setSettingsDraft] = useState({
    enabled: false,
    pollingEnabled: true,
    notificationMode: "fallback_all_linked" as "linked_only" | "fallback_all_linked",
  });

  const load = async () => {
    if (!companyId) {
      setLoading(false);
      setOverview(null);
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

  async function saveManagedToken() {
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
      toast({ title: t(locale, "Bot token saved", "Токен сохранен"), body: t(locale, "Stored as a company-managed secret.", "Сохранен как company-managed secret."), tone: "success" });
      await load();
    } catch (nextError) {
      toast({ title: t(locale, "Failed to save token", "Не удалось сохранить токен"), body: nextError instanceof Error ? nextError.message : String(nextError), tone: "error" });
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
      toast({ title: t(locale, "Operator settings saved", "Настройки operator bot сохранены"), tone: "success" });
      await load();
    } catch (nextError) {
      toast({ title: t(locale, "Failed to save settings", "Не удалось сохранить настройки"), body: nextError instanceof Error ? nextError.message : String(nextError), tone: "error" });
    } finally {
      setSavingSettings(false);
    }
  }

  async function createLinkCode() {
    if (!companyId) return;
    try {
      const result = await generateLinkCode({ companyId }) as LinkCodeResult;
      setLastLinkCode(result);
      toast({ title: t(locale, "Link code created", "Link code создан"), body: result.startCommand, tone: "success" });
      await load();
    } catch (nextError) {
      toast({ title: t(locale, "Failed to create link code", "Не удалось создать link code"), body: nextError instanceof Error ? nextError.message : String(nextError), tone: "error" });
    }
  }

  async function revoke(chatId: string) {
    if (!companyId) return;
    try {
      await revokeLinkedChat({ companyId, chatId });
      toast({ title: t(locale, "Chat revoked", "Чат отвязан"), tone: "success" });
      await load();
    } catch (nextError) {
      toast({ title: t(locale, "Failed to revoke chat", "Не удалось отвязать чат"), body: nextError instanceof Error ? nextError.message : String(nextError), tone: "error" });
    }
  }

  if (!companyId) return <div style={muted}>{t(locale, "Company context is required.", "Нужен контекст компании.")}</div>;
  if (loading) return <div style={muted}>{t(locale, "Loading Telegram Operator Bot...", "Загрузка Telegram Operator Bot...")}</div>;
  if (error) return <div style={danger}>{error}</div>;
  if (!overview) return null;

  return (
    <div style={stack}>
      <div style={card}>
        <div style={{ ...row, justifyContent: "space-between" }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600 }}>{t(locale, "Telegram Operator Bot", "Telegram Operator Bot")}</div>
            <div style={{ ...muted, marginTop: 8 }}>{t(locale, "Private-chat control plane only: tasks, approvals, joins, budgets, replies, and wakeups.", "Только private-chat control plane: задачи, approvals, joins, budgets, replies и wakeups.")}</div>
          </div>
          <a href={href(companyPrefix)} style={{ ...button, textDecoration: "none" }}>{t(locale, "Open page", "Открыть страницу")}</a>
        </div>
        <div style={{ ...row, marginTop: 14 }}>
          <div style={card}><strong>{overview.blockedTaskCount}</strong><div style={muted}>{t(locale, "Blocked tasks", "Блокеры")}</div></div>
          <div style={card}><strong>{overview.reviewTaskCount}</strong><div style={muted}>{t(locale, "In review", "На ревью")}</div></div>
          <div style={card}><strong>{overview.actionableApprovalCount}</strong><div style={muted}>{t(locale, "Approvals", "Approvals")}</div></div>
        </div>
      </div>

      <div style={card}>
        <div style={{ fontSize: 14, fontWeight: 600 }}>{t(locale, "Bot token", "Токен бота")}</div>
        <div style={{ ...row, marginTop: 12 }}>
          <input type="password" style={{ ...input, flex: 1 }} value={token} onChange={(event) => setToken(event.target.value)} placeholder="123456:ABCDEF..." />
          <button type="button" style={primary} disabled={savingToken || !token.trim()} onClick={() => void saveManagedToken()}>{savingToken ? "..." : t(locale, "Save token", "Сохранить токен")}</button>
        </div>
        <div style={{ ...muted, marginTop: 8 }}>
          {overview.settings.publishing.botTokenSecretRef ? t(locale, "Stored in company secrets.", "Сохранен в company secrets.") : t(locale, "No token stored yet.", "Токен пока не сохранен.")}
        </div>
      </div>

      <div style={card}>
        <div style={{ fontSize: 14, fontWeight: 600 }}>{t(locale, "Operator controls", "Управление ботом")}</div>
        <div style={{ ...stack, marginTop: 12 }}>
          <label style={{ ...row, fontSize: 12 }}>
            <input type="checkbox" checked={settingsDraft.enabled} onChange={(event) => setSettingsDraft((current) => ({ ...current, enabled: event.target.checked }))} />
            {t(locale, "Enable operator bot", "Включить operator bot")}
          </label>
          <label style={{ ...row, fontSize: 12 }}>
            <input type="checkbox" checked={settingsDraft.pollingEnabled} onChange={(event) => setSettingsDraft((current) => ({ ...current, pollingEnabled: event.target.checked }))} />
            {t(locale, "Enable polling", "Включить polling")}
          </label>
          <label style={stack}>
            <span style={{ fontSize: 12 }}>{t(locale, "Notification mode", "Режим уведомлений")}</span>
            <select style={input} value={settingsDraft.notificationMode} onChange={(event) => setSettingsDraft((current) => ({ ...current, notificationMode: event.target.value as Overview["settings"]["taskBot"]["notificationMode"] }))}>
              <option value="fallback_all_linked">fallback_all_linked</option>
              <option value="linked_only">linked_only</option>
            </select>
          </label>
          <button type="button" style={primary} disabled={savingSettings} onClick={() => void saveSettings()}>{savingSettings ? "..." : t(locale, "Save settings", "Сохранить настройки")}</button>
        </div>
      </div>

      <div style={card}>
        <div style={{ ...row, justifyContent: "space-between" }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600 }}>{t(locale, "Linked chats", "Связанные чаты")}</div>
            <div style={{ ...muted, marginTop: 8 }}>{t(locale, "Generate a one-time /start code for a private Telegram chat, then revoke chats if needed.", "Сгенерируй одноразовый /start code для private Telegram chat и при необходимости отвяжи чат.")}</div>
          </div>
          <button type="button" style={button} onClick={() => void createLinkCode()}>{t(locale, "Generate link code", "Сгенерировать link code")}</button>
        </div>
        {lastLinkCode ? (
          <div style={{ ...card, marginTop: 12, padding: 14 }}>
            <div><strong>{lastLinkCode.code}</strong></div>
            <div style={{ ...muted, marginTop: 6 }}>{lastLinkCode.startCommand}</div>
            <div style={{ ...muted, marginTop: 6 }}>{fmt(locale, lastLinkCode.expiresAt)}</div>
          </div>
        ) : null}
        <div style={{ ...stack, marginTop: 12 }}>
          {overview.linkedChats.length === 0 ? (
            <div style={muted}>{t(locale, "No linked Telegram chats yet.", "Связанных Telegram-чатов пока нет.")}</div>
          ) : overview.linkedChats.map((chat) => (
            <div key={chat.chatId} style={{ ...card, padding: 14 }}>
              <div style={{ ...row, justifyContent: "space-between" }}>
                <div>
                  <strong>{chat.displayName}</strong>
                  <div style={{ ...muted, marginTop: 6 }}>
                    {chat.username ? `@${chat.username} · ` : ""}{chat.chatId} · {fmt(locale, chat.linkedAt)}
                  </div>
                </div>
                <button type="button" style={button} onClick={() => void revoke(chat.chatId)}>{t(locale, "Revoke", "Отвязать")}</button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div style={card}>
        <div style={{ fontSize: 14, fontWeight: 600 }}>{t(locale, "Bot health", "Состояние бота")}</div>
        <div style={{ ...stack, marginTop: 12 }}>
          <div style={muted}>{t(locale, "Last update id", "Последний update id")}: {overview.botHealth?.lastUpdateId ?? "-"}</div>
          <div style={muted}>{t(locale, "Last notification", "Последнее уведомление")}: {fmt(locale, overview.botHealth?.lastNotificationAt ?? null)}</div>
          <div style={muted}>{t(locale, "Last control-plane notification", "Последнее control-plane уведомление")}: {fmt(locale, overview.botHealth?.lastControlPlaneNotificationAt ?? null)}</div>
          <div style={muted}>{t(locale, "Revision approvals", "Revision approvals")}: {overview.myRevisionApprovalCount}</div>
          {overview.botHealth?.error ? <div style={danger}>{overview.botHealth.error}</div> : null}
        </div>
      </div>
    </div>
  );
}

export function TelegramOperatorSettingsPage({ context }: PluginSettingsPageProps) {
  return <Surface companyId={context.companyId} companyPrefix={context.companyPrefix} locale={context.locale as Locale} />;
}

export function TelegramOperatorPage({ context }: PluginPageProps) {
  return <Surface companyId={context.companyId} companyPrefix={context.companyPrefix} locale={context.locale as Locale} />;
}
