import { useEffect, useMemo, useState, type CSSProperties, type FormEvent } from "react";
import {
  usePluginData,
  usePluginToast,
  type PluginDetailTabProps,
  type PluginPageProps,
  type PluginSettingsPageProps,
  type PluginSidebarProps,
  type PluginWidgetProps,
} from "@paperclipai/plugin-sdk/ui";
import { DATA_KEYS, PAGE_ROUTE, PLUGIN_ID } from "../constants.js";

type Locale = "en" | "ru";
type Destination = {
  id: string;
  label: string;
  chatId: string;
  publicHandle: string;
  parseMode: "" | "HTML" | "MarkdownV2";
  disableLinkPreview: boolean;
  disableNotification: boolean;
  enabled: boolean;
  isDefault: boolean;
};
type Donor = {
  id: string;
  label: string;
  chatId: string;
  publicHandle: string;
  discussionChatId: string;
  mode: "channel_posts" | "discussion_replies" | "both";
  enabled: boolean;
};
type ReadyItem = {
  approval: { id: string; updatedAt: string };
  issue: { id: string; identifier: string | null; title: string } | null;
  destinationLabel: string | null;
  previewExcerpt: string | null;
  sourceSummary: string | null;
  riskFlags: string[];
  safetyChecks: string[];
  publishAt: string | null;
};
type Publication = { externalId: string; destinationLabel: string; sentAt: string; summary: string; url: string | null };
type Job = { id?: string; issueId: string; publishAt: string; status: string; failureReason: string | null; publishedUrl: string | null };
type Overview = {
  settings: {
    publishing: { botTokenSecretRef: string; defaultDestinationId: string };
    taskBot: Record<string, unknown>;
  };
  publishChannels: Destination[];
  donorChannels: Donor[];
  profileCoverage: Array<{ destinationLabel: string; hasProfile: boolean }>;
  readyQueue: ReadyItem[];
  botHealth: { lastPublishDispatchAt: string | null; failedPublishCount: number; error: string | null } | null;
  lastPublication?: Publication | null;
  recentPublications: Publication[];
  scheduledJobs: Job[];
};

const stack: CSSProperties = { display: "grid", gap: 16 };
const row: CSSProperties = { display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" };
const card: CSSProperties = { border: "1px solid var(--border)", borderRadius: 14, padding: 16, background: "var(--card, transparent)" };
const input: CSSProperties = { width: "100%", border: "1px solid var(--border)", borderRadius: 10, background: "transparent", color: "inherit", padding: "9px 11px", fontSize: 12 };
const textarea: CSSProperties = { ...input, minHeight: 160, resize: "vertical", lineHeight: 1.5 };
const button: CSSProperties = { appearance: "none", border: "1px solid var(--border)", borderRadius: 999, background: "transparent", color: "inherit", padding: "8px 14px", fontSize: 12, cursor: "pointer", textDecoration: "none" };
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
const href = (prefix: string | null, route: string) => (prefix ? `/${prefix}/${route}` : "#");
const approvalHref = (prefix: string | null, id: string) => (prefix ? `/${prefix}/approvals/${id}` : "#");
const issueHref = (prefix: string | null, id: string) => (prefix ? `/${prefix}/issues/${id}` : "#");

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

function emptyDestination(index: number): Destination {
  return {
    id: `destination-${Date.now()}-${index}`,
    label: "",
    chatId: "",
    publicHandle: "",
    parseMode: "",
    disableLinkPreview: false,
    disableNotification: false,
    enabled: true,
    isDefault: index === 0,
  };
}

function emptyDonor(index: number): Donor {
  return {
    id: `donor-${Date.now()}-${index}`,
    label: "",
    chatId: "",
    publicHandle: "",
    discussionChatId: "",
    mode: "channel_posts",
    enabled: true,
  };
}

function cleanDestinations(list: Destination[], defaultId: string) {
  const trimmed = list
    .map((entry) => ({ ...entry, label: entry.label.trim(), chatId: entry.chatId.trim(), publicHandle: entry.publicHandle.trim().replace(/^@+/, "") }))
    .filter((entry) => entry.label || entry.chatId || entry.publicHandle);
  const resolvedDefault = trimmed.find((entry) => entry.id === defaultId)?.id ?? trimmed[0]?.id ?? "";
  return {
    destinations: trimmed.map((entry) => ({ ...entry, isDefault: entry.id === resolvedDefault })),
    defaultDestinationId: resolvedDefault,
  };
}

function cleanDonors(list: Donor[]) {
  return list
    .map((entry) => ({ ...entry, label: entry.label.trim(), chatId: entry.chatId.trim(), publicHandle: entry.publicHandle.trim().replace(/^@+/, ""), discussionChatId: entry.discussionChatId.trim() }))
    .filter((entry) => entry.label || entry.chatId || entry.publicHandle);
}

function toLocalDateTime(value: string | null | undefined) {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  const offset = parsed.getTimezoneOffset();
  return new Date(parsed.getTime() - offset * 60_000).toISOString().slice(0, 16);
}

function fromLocalDateTime(value: string) {
  if (!value.trim()) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function Surface({ companyId, companyPrefix, locale }: { companyId: string | null; companyPrefix: string | null; locale: Locale }) {
  const toast = usePluginToast();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [destinations, setDestinations] = useState<Destination[]>([]);
  const [donors, setDonors] = useState<Donor[]>([]);
  const [defaultDestinationId, setDefaultDestinationId] = useState("");
  const [token, setToken] = useState("");
  const [composeDestinationId, setComposeDestinationId] = useState("");
  const [composeText, setComposeText] = useState("");
  const [composeUrl, setComposeUrl] = useState("");
  const [composeTitle, setComposeTitle] = useState("");
  const [composeProjectId, setComposeProjectId] = useState("");
  const [composePublishAt, setComposePublishAt] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingToken, setSavingToken] = useState(false);
  const [savingChannels, setSavingChannels] = useState(false);
  const [composing, setComposing] = useState(false);

  const load = async () => {
    if (!companyId) {
      setLoading(false);
      setOverview(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const next = await api<Overview>(`/api/companies/${companyId}/telegram-publishing/overview`);
      setOverview(next);
      setDestinations(next.publishChannels);
      setDonors(next.donorChannels);
      setDefaultDestinationId(next.settings.publishing.defaultDestinationId);
      setComposeDestinationId((current) => current || next.settings.publishing.defaultDestinationId || next.publishChannels[0]?.id || "");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [companyId]);

  const missingProfiles = useMemo(() => (overview?.profileCoverage ?? []).filter((entry) => !entry.hasProfile), [overview]);

  async function saveManagedToken() {
    if (!companyId || !token.trim()) return;
    setSavingToken(true);
    try {
      await api(`/api/companies/${companyId}/plugins/${PLUGIN_ID}/managed-secret`, {
        method: "POST",
        body: JSON.stringify({
          settingsPath: "publishing.botTokenSecretRef",
          value: token.trim(),
          secretName: "telegram-publishing-bot-token",
          description: "Telegram Publishing bot token",
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

  async function saveChannels() {
    if (!companyId || !overview) return;
    setSavingChannels(true);
    try {
      const nextDestinations = cleanDestinations(destinations, defaultDestinationId);
      await api(`/api/companies/${companyId}/plugins/${PLUGIN_ID}/settings`, {
        method: "POST",
        body: JSON.stringify({
          enabled: true,
          settingsJson: {
            ...overview.settings,
            publishing: { ...overview.settings.publishing, destinations: nextDestinations.destinations, defaultDestinationId: nextDestinations.defaultDestinationId },
            ingestion: { sources: cleanDonors(donors) },
          },
        }),
      });
      toast({ title: t(locale, "Publishing settings saved", "Настройки публикаций сохранены"), tone: "success" });
      await load();
    } catch (nextError) {
      toast({ title: t(locale, "Failed to save settings", "Не удалось сохранить настройки"), body: nextError instanceof Error ? nextError.message : String(nextError), tone: "error" });
    } finally {
      setSavingChannels(false);
    }
  }

  async function compose(event: FormEvent) {
    event.preventDefault();
    if (!companyId) return;
    setComposing(true);
    try {
      const result = await api<{ approval: { id: string } }>(`/api/companies/${companyId}/telegram-publishing/compose`, {
        method: "POST",
        body: JSON.stringify({
          destinationId: composeDestinationId,
          sourceText: composeText.trim() || undefined,
          sourceUrl: composeUrl.trim() || undefined,
          title: composeTitle.trim() || undefined,
          projectId: composeProjectId.trim() || undefined,
          publishAt: fromLocalDateTime(composePublishAt),
        }),
      });
      setComposeText("");
      setComposeUrl("");
      setComposeTitle("");
      setComposeProjectId("");
      setComposePublishAt("");
      toast({
        title: t(locale, "Post prepared", "Пост подготовлен"),
        body: t(locale, "GPT-5.4 rewrite completed and a publish approval was created.", "GPT-5.4 завершил рерайт и создал publish approval."),
        tone: "success",
        action: companyPrefix ? { label: t(locale, "Open approval", "Открыть approval"), href: approvalHref(companyPrefix, result.approval.id) } : undefined,
      });
      await load();
    } catch (nextError) {
      toast({ title: t(locale, "Failed to prepare post", "Не удалось подготовить пост"), body: nextError instanceof Error ? nextError.message : String(nextError), tone: "error" });
    } finally {
      setComposing(false);
    }
  }

  if (!companyId) return <div style={muted}>{t(locale, "Company context is required.", "Нужен контекст компании.")}</div>;
  if (loading) return <div style={muted}>{t(locale, "Loading Telegram Publishing...", "Загрузка Telegram Publishing...")}</div>;
  if (error) return <div style={danger}>{error}</div>;
  if (!overview) return null;

  return (
    <div style={stack}>
      <div style={card}>
        <div style={{ ...row, justifyContent: "space-between" }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600 }}>{t(locale, "Telegram publishing", "Публикации Telegram")}</div>
            <div style={{ ...muted, marginTop: 8 }}>{t(locale, "Minimal company surface: token, channels, donor intake, ready queue, and GPT-5.4 compose.", "Минимальная company surface: токен, каналы, доноры, очередь и GPT-5.4 compose.")}</div>
          </div>
          <div style={row}>
            <a href={href(companyPrefix, "author-voice")} style={button}>{t(locale, "Voice profiles", "Профили автора")}</a>
            <a href={href(companyPrefix, "web-import")} style={button}>{t(locale, "URL import", "Импорт по ссылке")}</a>
          </div>
        </div>
        <div style={{ ...row, marginTop: 14 }}>
          <div style={card}><strong>{overview.readyQueue.length}</strong><div style={muted}>{t(locale, "Ready for approval", "Готово к согласованию")}</div></div>
          <div style={card}><strong>{overview.scheduledJobs.length}</strong><div style={muted}>{t(locale, "Dispatch queue", "Очередь отправки")}</div></div>
          <div style={card}><strong>{missingProfiles.length}</strong><div style={muted}>{t(locale, "Missing voice profiles", "Не хватает voice profiles")}</div></div>
        </div>
      </div>

      <div style={card}>
        <div style={{ fontSize: 14, fontWeight: 600 }}>{t(locale, "Channels", "Каналы")}</div>
        <div style={{ ...stack, marginTop: 14 }}>
          <div style={{ ...card, padding: 14 }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>{t(locale, "Bot token", "Токен бота")}</div>
            <div style={{ ...row, marginTop: 12 }}>
              <input type="password" style={{ ...input, flex: 1 }} value={token} onChange={(event) => setToken(event.target.value)} placeholder="123456:ABCDEF..." />
              <button type="button" style={primary} disabled={savingToken || !token.trim()} onClick={() => void saveManagedToken()}>{savingToken ? "..." : t(locale, "Save token", "Сохранить токен")}</button>
            </div>
            <div style={{ ...muted, marginTop: 8 }}>
              {overview.settings.publishing.botTokenSecretRef ? t(locale, "Stored in company secrets.", "Сохранен в company secrets.") : t(locale, "No token stored yet.", "Токен пока не сохранен.")}
            </div>
          </div>

          <div style={{ ...card, padding: 14 }}>
            <div style={{ ...row, justifyContent: "space-between" }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{t(locale, "Publish channels", "Каналы публикации")}</div>
              <button type="button" style={button} onClick={() => setDestinations((current) => [...current, emptyDestination(current.length)])}>{t(locale, "Add channel", "Добавить канал")}</button>
            </div>
            <div style={{ ...stack, marginTop: 12 }}>
              {destinations.map((item, index) => (
                <div key={item.id} style={{ ...card, padding: 14 }}>
                  <div style={{ ...row, justifyContent: "space-between" }}>
                    <strong>{item.label || `Channel ${index + 1}`}</strong>
                    <button type="button" style={button} onClick={() => setDestinations((current) => current.filter((entry) => entry.id !== item.id))}>{t(locale, "Remove", "Удалить")}</button>
                  </div>
                  <div style={{ ...stack, marginTop: 12 }}>
                    <input style={input} value={item.label} onChange={(event) => setDestinations((current) => current.map((entry) => entry.id === item.id ? { ...entry, label: event.target.value } : entry))} placeholder={t(locale, "Label", "Название")} />
                    <input style={input} value={item.chatId} onChange={(event) => setDestinations((current) => current.map((entry) => entry.id === item.id ? { ...entry, chatId: event.target.value } : entry))} placeholder={t(locale, "Chat ID or @channel", "Chat ID или @канал")} />
                    <input style={input} value={item.publicHandle} onChange={(event) => setDestinations((current) => current.map((entry) => entry.id === item.id ? { ...entry, publicHandle: event.target.value } : entry))} placeholder={t(locale, "Public handle", "Публичный handle")} />
                    <label style={{ ...row, fontSize: 12 }}>
                      <input type="radio" checked={defaultDestinationId === item.id} onChange={() => setDefaultDestinationId(item.id)} />
                      {t(locale, "Default channel", "Канал по умолчанию")}
                    </label>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div style={{ ...card, padding: 14 }}>
            <div style={{ ...row, justifyContent: "space-between" }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{t(locale, "Donor channels", "Каналы-доноры")}</div>
              <button type="button" style={button} onClick={() => setDonors((current) => [...current, emptyDonor(current.length)])}>{t(locale, "Add donor", "Добавить донора")}</button>
            </div>
            <div style={{ ...stack, marginTop: 12 }}>
              {donors.map((item, index) => (
                <div key={item.id} style={{ ...card, padding: 14 }}>
                  <div style={{ ...row, justifyContent: "space-between" }}>
                    <strong>{item.label || `Donor ${index + 1}`}</strong>
                    <button type="button" style={button} onClick={() => setDonors((current) => current.filter((entry) => entry.id !== item.id))}>{t(locale, "Remove", "Удалить")}</button>
                  </div>
                  <div style={{ ...stack, marginTop: 12 }}>
                    <input style={input} value={item.label} onChange={(event) => setDonors((current) => current.map((entry) => entry.id === item.id ? { ...entry, label: event.target.value } : entry))} placeholder={t(locale, "Label", "Название")} />
                    <input style={input} value={item.chatId} onChange={(event) => setDonors((current) => current.map((entry) => entry.id === item.id ? { ...entry, chatId: event.target.value } : entry))} placeholder={t(locale, "Chat ID or @channel", "Chat ID или @канал")} />
                    <input style={input} value={item.publicHandle} onChange={(event) => setDonors((current) => current.map((entry) => entry.id === item.id ? { ...entry, publicHandle: event.target.value } : entry))} placeholder={t(locale, "Public handle", "Публичный handle")} />
                    <input style={input} value={item.discussionChatId} onChange={(event) => setDonors((current) => current.map((entry) => entry.id === item.id ? { ...entry, discussionChatId: event.target.value } : entry))} placeholder={t(locale, "Discussion chat ID", "Discussion chat ID")} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <button type="button" style={primary} disabled={savingChannels} onClick={() => void saveChannels()}>{savingChannels ? "..." : t(locale, "Save channels", "Сохранить каналы")}</button>
        </div>
      </div>

      <div style={card}>
        <div style={{ fontSize: 14, fontWeight: 600 }}>{t(locale, "Ready for approval", "Готово к согласованию")}</div>
        {missingProfiles.length > 0 ? <div style={{ ...danger, marginTop: 10 }}>{t(locale, "Missing profiles:", "Не хватает профилей:")} {missingProfiles.map((entry) => entry.destinationLabel).join(", ")}</div> : null}
        <div style={{ ...stack, marginTop: 12 }}>
          {overview.readyQueue.length === 0 ? <div style={muted}>{t(locale, "No Telegram posts are waiting for approval.", "Готовых постов пока нет.")}</div> : overview.readyQueue.map((item) => (
            <div key={item.approval.id} style={{ ...card, padding: 14 }}>
              <div style={{ ...row, justifyContent: "space-between" }}>
                <div>
                  <strong>{item.issue?.identifier ? `${item.issue.identifier}: ` : ""}{item.issue?.title ?? item.destinationLabel ?? "Telegram post"}</strong>
                  <div style={{ ...muted, marginTop: 6 }}>{item.destinationLabel ?? "-"} · {fmt(locale, item.approval.updatedAt)}</div>
                </div>
                <div style={row}>
                  <a href={approvalHref(companyPrefix, item.approval.id)} style={button}>{t(locale, "Open approval", "Открыть approval")}</a>
                  {item.issue?.id ? <a href={issueHref(companyPrefix, item.issue.id)} style={button}>{t(locale, "Open issue", "Открыть задачу")}</a> : null}
                </div>
              </div>
              {item.previewExcerpt ? <div style={{ ...muted, marginTop: 10 }}>{item.previewExcerpt}</div> : null}
              {item.sourceSummary ? <div style={{ ...muted, marginTop: 10 }}>{item.sourceSummary}</div> : null}
              {item.publishAt ? <div style={{ ...muted, marginTop: 10 }}>{t(locale, "Publish at", "Время публикации")}: {fmt(locale, item.publishAt)}</div> : null}
            </div>
          ))}
        </div>
      </div>

      <div style={card}>
        <div style={{ fontSize: 14, fontWeight: 600 }}>{t(locale, "Compose", "Подготовка поста")}</div>
        <div style={{ ...muted, marginTop: 8 }}>{t(locale, "Text or URL goes in, GPT-5.4 rewrite plus publish approval comes out.", "На вход текст или ссылка, на выход GPT-5.4 рерайт и publish approval.")}</div>
        <form onSubmit={(event) => void compose(event)} style={{ ...stack, marginTop: 12 }}>
          <select style={input} value={composeDestinationId} onChange={(event) => setComposeDestinationId(event.target.value)}>
            <option value="">{t(locale, "Select channel", "Выбери канал")}</option>
            {overview.publishChannels.filter((entry) => entry.enabled).map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
          </select>
          <input style={input} value={composeTitle} onChange={(event) => setComposeTitle(event.target.value)} placeholder={t(locale, "Title (optional)", "Заголовок (необязательно)")} />
          <input style={input} value={composeUrl} onChange={(event) => setComposeUrl(event.target.value)} placeholder="https://example.com/article" />
          <textarea style={textarea} value={composeText} onChange={(event) => setComposeText(event.target.value)} placeholder={t(locale, "Source text", "Исходный текст")} />
          <div style={row}>
            <input style={{ ...input, flex: 1 }} value={composeProjectId} onChange={(event) => setComposeProjectId(event.target.value)} placeholder={t(locale, "Project ID (optional)", "Project ID (необязательно)")} />
            <input type="datetime-local" style={{ ...input, flex: 1 }} value={composePublishAt} onChange={(event) => setComposePublishAt(event.target.value)} />
          </div>
          <button type="submit" style={primary} disabled={composing || !composeDestinationId || (!composeText.trim() && !composeUrl.trim())}>{composing ? "..." : t(locale, "Prepare with GPT-5.4", "Подготовить через GPT-5.4")}</button>
        </form>
      </div>

      <div style={card}>
        <div style={{ fontSize: 14, fontWeight: 600 }}>{t(locale, "Publishing health", "Состояние публикаций")}</div>
        <div style={{ ...stack, marginTop: 12 }}>
          <div style={muted}>{t(locale, "Last dispatch", "Последний dispatch")}: {fmt(locale, overview.botHealth?.lastPublishDispatchAt ?? null)}</div>
          <div style={muted}>{t(locale, "Failed jobs", "Ошибки отправки")}: {overview.botHealth?.failedPublishCount ?? 0}</div>
          <div style={muted}>{t(locale, "Last publication", "Последняя публикация")}: {overview.lastPublication ? `${overview.lastPublication.destinationLabel} · ${fmt(locale, overview.lastPublication.sentAt)}` : t(locale, "No Telegram publications yet.", "Публикаций пока нет.")}</div>
          {overview.botHealth?.error ? <div style={danger}>{overview.botHealth.error}</div> : null}
        </div>
      </div>
    </div>
  );
}

function IssueTab({ context }: PluginDetailTabProps) {
  const locale = context.locale as Locale;
  const publications = usePluginData<Publication[]>(DATA_KEYS.issuePublications, { companyId: context.companyId, issueId: context.entityId });
  const jobs = usePluginData<Job[]>(DATA_KEYS.issuePublicationJobs, { companyId: context.companyId, issueId: context.entityId });
  if (!context.companyId || !context.entityId) return <div style={muted}>{t(locale, "Company context is required.", "Нужен контекст компании.")}</div>;
  if (publications.loading || jobs.loading) return <div style={muted}>{t(locale, "Loading Telegram trace...", "Загрузка Telegram trace...")}</div>;
  if (publications.error) return <div style={danger}>{publications.error.message}</div>;
  if (jobs.error) return <div style={danger}>{jobs.error.message}</div>;

  return (
    <div style={stack}>
      <div style={card}>
        <div style={{ fontSize: 14, fontWeight: 600 }}>{t(locale, "Telegram trace", "Telegram trace")}</div>
        <div style={{ ...muted, marginTop: 8 }}>{t(locale, "Issue tabs stay read-only. Use the company Telegram page to compose and manage queue items.", "Таб задачи остается read-only. Основная работа идет на company Telegram page.")}</div>
        <a href={href(context.companyPrefix, PAGE_ROUTE)} style={{ ...button, marginTop: 12 }}>{t(locale, "Open Telegram dashboard", "Открыть Telegram dashboard")}</a>
      </div>
      <div style={card}>
        <div style={{ fontSize: 14, fontWeight: 600 }}>{t(locale, "Issue publications", "Публикации задачи")}</div>
        <div style={{ ...stack, marginTop: 12 }}>
          {(publications.data ?? []).length === 0 ? <div style={muted}>{t(locale, "No Telegram publications for this issue yet.", "По задаче пока нет публикаций Telegram.")}</div> : (publications.data ?? []).map((entry) => (
            <div key={entry.externalId} style={{ ...card, padding: 14 }}>
              <strong>{entry.destinationLabel}</strong>
              <div style={{ ...muted, marginTop: 6 }}>{fmt(locale, entry.sentAt)}</div>
              <div style={{ ...muted, marginTop: 8 }}>{entry.summary}</div>
            </div>
          ))}
        </div>
      </div>
      <div style={card}>
        <div style={{ fontSize: 14, fontWeight: 600 }}>{t(locale, "Issue queue jobs", "Очередь задачи")}</div>
        <div style={{ ...stack, marginTop: 12 }}>
          {(jobs.data ?? []).length === 0 ? <div style={muted}>{t(locale, "No Telegram queue jobs for this issue yet.", "По задаче пока нет очереди Telegram.")}</div> : (jobs.data ?? []).map((entry, index) => (
            <div key={entry.id ?? `${entry.issueId}-${index}`} style={{ ...card, padding: 14 }}>
              <strong>{entry.status}</strong>
              <div style={{ ...muted, marginTop: 6 }}>{fmt(locale, entry.publishAt)}</div>
              {entry.failureReason ? <div style={{ ...danger, marginTop: 8 }}>{entry.failureReason}</div> : null}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function TelegramPublishingSidebarLink({ context }: PluginSidebarProps) {
  return <a href={href(context.companyPrefix, PAGE_ROUTE)} style={button}>{t(context.locale as Locale, "Telegram", "Telegram")}</a>;
}

export function TelegramPublishingDashboardWidget({ context }: PluginWidgetProps) {
  const locale = context.locale as Locale;
  const { data, loading, error } = usePluginData<Overview>(DATA_KEYS.overview, { companyId: context.companyId });
  if (!context.companyId) return <div style={muted}>{t(locale, "Company context is required.", "Нужен контекст компании.")}</div>;
  if (loading) return <div style={muted}>{t(locale, "Loading Telegram Publishing...", "Загрузка Telegram Publishing...")}</div>;
  if (error) return <div style={danger}>{error.message}</div>;
  if (!data) return null;
  return (
    <div style={card}>
      <div style={{ ...row, justifyContent: "space-between" }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 600 }}>{t(locale, "Telegram publishing", "Публикации Telegram")}</div>
          <div style={{ ...muted, marginTop: 8 }}>{data.readyQueue.length} {t(locale, "items ready for approval", "элементов ждут согласования")}</div>
        </div>
        <a href={href(context.companyPrefix, PAGE_ROUTE)} style={button}>{t(locale, "Open", "Открыть")}</a>
      </div>
    </div>
  );
}

export function TelegramPublishingSettingsPage({ context }: PluginSettingsPageProps) {
  return <Surface companyId={context.companyId} companyPrefix={context.companyPrefix} locale={context.locale as Locale} />;
}

export function TelegramPublishingPage({ context }: PluginPageProps) {
  return <Surface companyId={context.companyId} companyPrefix={context.companyPrefix} locale={context.locale as Locale} />;
}

export function TelegramPublishingIssueTab(props: PluginDetailTabProps) {
  return <IssueTab {...props} />;
}
