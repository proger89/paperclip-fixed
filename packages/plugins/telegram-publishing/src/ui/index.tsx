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

type Publication = {
  externalId: string;
  destinationLabel: string;
  sentAt: string;
  summary: string;
  url: string | null;
};

type Job = {
  id?: string;
  issueId: string;
  publishAt: string;
  status: string;
  failureReason: string | null;
  publishedUrl: string | null;
};

type Overview = {
  settings: {
    publishing: { botTokenSecretRef: string; defaultDestinationId: string };
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

const surface: CSSProperties = { display: "grid", gap: 18 };
const section: CSSProperties = {
  border: "1px solid var(--border)",
  borderRadius: 18,
  padding: 18,
  background: "var(--card, transparent)",
  display: "grid",
  gap: 14,
};
const row: CSSProperties = { display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" };
const twoCol: CSSProperties = { display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" };
const statCard: CSSProperties = {
  border: "1px solid var(--border)",
  borderRadius: 14,
  padding: 14,
  minWidth: 140,
  display: "grid",
  gap: 6,
};
const panel: CSSProperties = {
  border: "1px solid var(--border)",
  borderRadius: 14,
  padding: 14,
  display: "grid",
  gap: 12,
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
const textarea: CSSProperties = { ...input, minHeight: 180, resize: "vertical", lineHeight: 1.5 };
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

function companyHref(prefix: string | null | undefined, route: string) {
  return prefix ? `/${prefix}/${route}` : "#";
}

function approvalHref(prefix: string | null | undefined, id: string) {
  return prefix ? `/${prefix}/approvals/${id}` : "#";
}

function issueHref(prefix: string | null | undefined, id: string) {
  return prefix ? `/${prefix}/issues/${id}` : "#";
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
      // ignore json parse failure
    }
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
    .map((entry) => ({
      ...entry,
      label: entry.label.trim(),
      chatId: entry.chatId.trim(),
      publicHandle: entry.publicHandle.trim().replace(/^@+/, ""),
    }))
    .filter((entry) => entry.label || entry.chatId || entry.publicHandle);
  const resolvedDefault = trimmed.find((entry) => entry.id === defaultId)?.id ?? trimmed[0]?.id ?? "";
  return {
    destinations: trimmed.map((entry) => ({ ...entry, isDefault: entry.id === resolvedDefault })),
    defaultDestinationId: resolvedDefault,
  };
}

function cleanDonors(list: Donor[]) {
  return list
    .map((entry) => ({
      ...entry,
      label: entry.label.trim(),
      chatId: entry.chatId.trim(),
      publicHandle: entry.publicHandle.trim().replace(/^@+/, ""),
      discussionChatId: entry.discussionChatId.trim(),
    }))
    .filter((entry) => entry.label || entry.chatId || entry.publicHandle);
}

function fromLocalDateTime(value: string) {
  if (!value.trim()) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function DestinationEditor({
  locale,
  items,
  defaultDestinationId,
  onChange,
  onDefaultChange,
}: {
  locale: Locale;
  items: Destination[];
  defaultDestinationId: string;
  onChange: (items: Destination[]) => void;
  onDefaultChange: (destinationId: string) => void;
}) {
  return (
    <div style={{ display: "grid", gap: 10 }}>
      {items.length === 0 ? <div style={muted}>{tr(locale, "No publish channels yet.", "Пока нет каналов публикации.")}</div> : null}
      {items.map((item, index) => (
        <div key={item.id} style={panel}>
          <div style={{ ...row, justifyContent: "space-between" }}>
            <strong>{item.label || `${tr(locale, "Channel", "Канал")} ${index + 1}`}</strong>
            <button type="button" style={button} onClick={() => onChange(items.filter((entry) => entry.id !== item.id))}>
              {tr(locale, "Remove", "Удалить")}
            </button>
          </div>
          <div style={twoCol}>
            <div style={{ display: "grid", gap: 6 }}>
              <div style={label}>{tr(locale, "Label", "Название")}</div>
              <input
                style={input}
                value={item.label}
                onChange={(event) => onChange(items.map((entry) => entry.id === item.id ? { ...entry, label: event.target.value } : entry))}
                placeholder={tr(locale, "Author channel", "Канал автора")}
              />
            </div>
            <div style={{ display: "grid", gap: 6 }}>
              <div style={label}>{tr(locale, "Chat ID or @channel", "Chat ID или @канал")}</div>
              <input
                style={input}
                value={item.chatId}
                onChange={(event) => onChange(items.map((entry) => entry.id === item.id ? { ...entry, chatId: event.target.value } : entry))}
                placeholder="@author_channel"
              />
            </div>
            <div style={{ display: "grid", gap: 6 }}>
              <div style={label}>{tr(locale, "Public handle", "Публичный handle")}</div>
              <input
                style={input}
                value={item.publicHandle}
                onChange={(event) => onChange(items.map((entry) => entry.id === item.id ? { ...entry, publicHandle: event.target.value } : entry))}
                placeholder="author_channel"
              />
            </div>
          </div>
          <label style={{ ...row, fontSize: 12 }}>
            <input type="radio" checked={defaultDestinationId === item.id} onChange={() => onDefaultChange(item.id)} />
            {tr(locale, "Use as default publishing channel", "Использовать как канал по умолчанию")}
          </label>
        </div>
      ))}
    </div>
  );
}

function DonorEditor({
  locale,
  items,
  onChange,
}: {
  locale: Locale;
  items: Donor[];
  onChange: (items: Donor[]) => void;
}) {
  return (
    <div style={{ display: "grid", gap: 10 }}>
      {items.length === 0 ? <div style={muted}>{tr(locale, "No donor channels yet.", "Пока нет каналов-доноров.")}</div> : null}
      {items.map((item, index) => (
        <div key={item.id} style={panel}>
          <div style={{ ...row, justifyContent: "space-between" }}>
            <strong>{item.label || `${tr(locale, "Donor", "Донор")} ${index + 1}`}</strong>
            <button type="button" style={button} onClick={() => onChange(items.filter((entry) => entry.id !== item.id))}>
              {tr(locale, "Remove", "Удалить")}
            </button>
          </div>
          <div style={twoCol}>
            <div style={{ display: "grid", gap: 6 }}>
              <div style={label}>{tr(locale, "Label", "Название")}</div>
              <input
                style={input}
                value={item.label}
                onChange={(event) => onChange(items.map((entry) => entry.id === item.id ? { ...entry, label: event.target.value } : entry))}
                placeholder={tr(locale, "Competitor channel", "Канал-источник")}
              />
            </div>
            <div style={{ display: "grid", gap: 6 }}>
              <div style={label}>{tr(locale, "Chat ID or @channel", "Chat ID или @канал")}</div>
              <input
                style={input}
                value={item.chatId}
                onChange={(event) => onChange(items.map((entry) => entry.id === item.id ? { ...entry, chatId: event.target.value } : entry))}
                placeholder="@source_channel"
              />
            </div>
            <div style={{ display: "grid", gap: 6 }}>
              <div style={label}>{tr(locale, "Public handle", "Публичный handle")}</div>
              <input
                style={input}
                value={item.publicHandle}
                onChange={(event) => onChange(items.map((entry) => entry.id === item.id ? { ...entry, publicHandle: event.target.value } : entry))}
                placeholder="source_channel"
              />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function QueueList({
  locale,
  companyPrefix,
  items,
}: {
  locale: Locale;
  companyPrefix: string | null;
  items: ReadyItem[];
}) {
  if (items.length === 0) {
    return <div style={muted}>{tr(locale, "No posts are waiting for approval.", "Нет постов, ожидающих одобрения.")}</div>;
  }

  return (
    <div style={{ display: "grid", gap: 10 }}>
      {items.map((item) => (
        <div key={item.approval.id} style={panel}>
          <div style={{ ...row, justifyContent: "space-between" }}>
            <div style={{ display: "grid", gap: 6 }}>
              <strong>{item.issue?.identifier ? `${item.issue.identifier}: ` : ""}{item.issue?.title ?? item.destinationLabel ?? "Telegram post"}</strong>
              <div style={muted}>
                {(item.destinationLabel ?? "-") + " · " + formatDate(locale, item.approval.updatedAt)}
              </div>
            </div>
            <div style={row}>
              <a href={approvalHref(companyPrefix, item.approval.id)} style={button}>
                {tr(locale, "Open approval", "Открыть approval")}
              </a>
              {item.issue?.id ? (
                <a href={issueHref(companyPrefix, item.issue.id)} style={button}>
                  {tr(locale, "Open issue", "Открыть задачу")}
                </a>
              ) : null}
            </div>
          </div>
          {item.previewExcerpt ? <div style={muted}>{item.previewExcerpt}</div> : null}
          {item.sourceSummary ? <div style={muted}>{item.sourceSummary}</div> : null}
          {item.publishAt ? (
            <div style={muted}>
              {tr(locale, "Scheduled for", "Запланировано на")} {formatDate(locale, item.publishAt)}
            </div>
          ) : null}
          {item.riskFlags.length > 0 ? <div style={danger}>{item.riskFlags.join(" · ")}</div> : null}
        </div>
      ))}
    </div>
  );
}

function SetupSection({
  locale,
  companyId,
  companyPrefix,
  overview,
  destinations,
  donors,
  defaultDestinationId,
  setDestinations,
  setDonors,
  setDefaultDestinationId,
  load,
}: {
  locale: Locale;
  companyId: string;
  companyPrefix: string | null;
  overview: Overview;
  destinations: Destination[];
  donors: Donor[];
  defaultDestinationId: string;
  setDestinations: (items: Destination[]) => void;
  setDonors: (items: Donor[]) => void;
  setDefaultDestinationId: (destinationId: string) => void;
  load: () => Promise<void>;
}) {
  const toast = usePluginToast();
  const [token, setToken] = useState("");
  const [savingToken, setSavingToken] = useState(false);
  const [savingChannels, setSavingChannels] = useState(false);

  async function saveToken() {
    if (!token.trim()) return;
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
      toast({
        title: tr(locale, "Telegram bot token saved", "Токен Telegram сохранен"),
        body: tr(locale, "Stored as a company secret.", "Сохранен как секрет компании."),
        tone: "success",
      });
      await load();
    } catch (error) {
      toast({
        title: tr(locale, "Failed to save token", "Не удалось сохранить токен"),
        body: error instanceof Error ? error.message : String(error),
        tone: "error",
      });
    } finally {
      setSavingToken(false);
    }
  }

  async function saveChannels() {
    setSavingChannels(true);
    try {
      const nextDestinations = cleanDestinations(destinations, defaultDestinationId);
      await api(`/api/companies/${companyId}/plugins/${PLUGIN_ID}/settings`, {
        method: "POST",
        body: JSON.stringify({
          enabled: true,
          settingsJson: {
            ...overview.settings,
            publishing: {
              ...overview.settings.publishing,
              destinations: nextDestinations.destinations,
              defaultDestinationId: nextDestinations.defaultDestinationId,
            },
            ingestion: {
              sources: cleanDonors(donors),
            },
          },
        }),
      });
      toast({
        title: tr(locale, "Channels saved", "Каналы сохранены"),
        body: tr(locale, "Publishing and donor channels were updated.", "Каналы публикации и доноры обновлены."),
        tone: "success",
      });
      await load();
    } catch (error) {
      toast({
        title: tr(locale, "Failed to save channels", "Не удалось сохранить каналы"),
        body: error instanceof Error ? error.message : String(error),
        tone: "error",
      });
    } finally {
      setSavingChannels(false);
    }
  }

  return (
    <section style={section}>
      <div style={{ ...row, justifyContent: "space-between" }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700 }}>{tr(locale, "Channels", "Каналы")}</div>
          <div style={muted}>
            {tr(
              locale,
              "One publishing bot token, your output channels, and your donor channels.",
              "Один токен publishing-бота, каналы публикации и каналы-доноры.",
            )}
          </div>
        </div>
        {companyPrefix ? (
          <a href={companyHref(companyPrefix, "author-voice")} style={button}>
            {tr(locale, "Open voice profiles", "Открыть voice profiles")}
          </a>
        ) : null}
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
        <div style={{ ...row, justifyContent: "space-between" }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>{tr(locale, "Publish channels", "Каналы публикации")}</div>
          <button type="button" style={button} onClick={() => setDestinations([...destinations, emptyDestination(destinations.length)])}>
            {tr(locale, "Add channel", "Добавить канал")}
          </button>
        </div>
        <DestinationEditor
          locale={locale}
          items={destinations}
          defaultDestinationId={defaultDestinationId}
          onChange={setDestinations}
          onDefaultChange={setDefaultDestinationId}
        />
      </div>

      <div style={panel}>
        <div style={{ ...row, justifyContent: "space-between" }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>{tr(locale, "Donor channels", "Каналы-доноры")}</div>
          <button type="button" style={button} onClick={() => setDonors([...donors, emptyDonor(donors.length)])}>
            {tr(locale, "Add donor", "Добавить донора")}
          </button>
        </div>
        <DonorEditor locale={locale} items={donors} onChange={setDonors} />
      </div>

      <div style={row}>
        <button type="button" style={primary} disabled={savingChannels} onClick={() => void saveChannels()}>
          {savingChannels ? "..." : tr(locale, "Save channels", "Сохранить каналы")}
        </button>
        {companyPrefix ? (
          <a href={companyHref(companyPrefix, PAGE_ROUTE)} style={button}>
            {tr(locale, "Open publishing page", "Открыть publishing page")}
          </a>
        ) : null}
      </div>
    </section>
  );
}

function ComposeSection({
  locale,
  companyId,
  companyPrefix,
  overview,
  load,
}: {
  locale: Locale;
  companyId: string;
  companyPrefix: string | null;
  overview: Overview;
  load: () => Promise<void>;
}) {
  const toast = usePluginToast();
  const [destinationId, setDestinationId] = useState(overview.settings.publishing.defaultDestinationId || overview.publishChannels[0]?.id || "");
  const [title, setTitle] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [sourceText, setSourceText] = useState("");
  const [publishAt, setPublishAt] = useState("");
  const [composing, setComposing] = useState(false);

  useEffect(() => {
    setDestinationId((current) => current || overview.settings.publishing.defaultDestinationId || overview.publishChannels[0]?.id || "");
  }, [overview.publishChannels, overview.settings.publishing.defaultDestinationId]);

  async function compose(event: FormEvent) {
    event.preventDefault();
    setComposing(true);
    try {
      const result = await api<{ approval: { id: string } }>(`/api/companies/${companyId}/telegram-publishing/compose`, {
        method: "POST",
        body: JSON.stringify({
          destinationId,
          sourceText: sourceText.trim() || undefined,
          sourceUrl: sourceUrl.trim() || undefined,
          title: title.trim() || undefined,
          publishAt: fromLocalDateTime(publishAt),
        }),
      });

      setTitle("");
      setSourceUrl("");
      setSourceText("");
      setPublishAt("");
      toast({
        title: tr(locale, "Post prepared", "Пост подготовлен"),
        body: tr(
          locale,
          "GPT-5.4 prepared a publication draft and opened a publish approval.",
          "GPT-5.4 подготовил draft и создал publish approval.",
        ),
        tone: "success",
        action: companyPrefix
          ? { label: tr(locale, "Open approval", "Открыть approval"), href: approvalHref(companyPrefix, result.approval.id) }
          : undefined,
      });
      await load();
    } catch (error) {
      toast({
        title: tr(locale, "Failed to prepare post", "Не удалось подготовить пост"),
        body: error instanceof Error ? error.message : String(error),
        tone: "error",
      });
    } finally {
      setComposing(false);
    }
  }

  const missingProfiles = overview.profileCoverage.filter((entry) => !entry.hasProfile);

  return (
    <section style={section}>
      <div>
        <div style={{ fontSize: 16, fontWeight: 700 }}>{tr(locale, "Compose", "Подготовка поста")}</div>
        <div style={muted}>
          {tr(
            locale,
            "Paste source text or a link. GPT-5.4 rewrites it into the channel style and sends it to approval.",
            "Вставь текст или ссылку. GPT-5.4 перепишет это под стиль канала и отправит в approval.",
          )}
        </div>
      </div>

      {missingProfiles.length > 0 ? (
        <div style={danger}>
          {tr(locale, "Blocked until voice profiles exist for:", "Заблокировано, пока не настроены voice profiles для:")}{" "}
          {missingProfiles.map((entry) => entry.destinationLabel).join(", ")}
        </div>
      ) : null}

      <form onSubmit={(event) => void compose(event)} style={{ display: "grid", gap: 12 }}>
        <div style={twoCol}>
          <div style={{ display: "grid", gap: 6 }}>
            <div style={label}>{tr(locale, "Publish channel", "Канал публикации")}</div>
            <select style={input} value={destinationId} onChange={(event) => setDestinationId(event.target.value)}>
              <option value="">{tr(locale, "Select channel", "Выбери канал")}</option>
              {overview.publishChannels.filter((entry) => entry.enabled).map((entry) => (
                <option key={entry.id} value={entry.id}>{entry.label}</option>
              ))}
            </select>
          </div>
          <div style={{ display: "grid", gap: 6 }}>
            <div style={label}>{tr(locale, "Schedule (optional)", "Публикация по времени (необязательно)")}</div>
            <input type="datetime-local" style={input} value={publishAt} onChange={(event) => setPublishAt(event.target.value)} />
          </div>
        </div>

        <div style={{ display: "grid", gap: 6 }}>
          <div style={label}>{tr(locale, "Internal title (optional)", "Внутренний заголовок (необязательно)")}</div>
          <input style={input} value={title} onChange={(event) => setTitle(event.target.value)} placeholder={tr(locale, "Post topic", "Тема поста")} />
        </div>

        <div style={{ display: "grid", gap: 6 }}>
          <div style={label}>{tr(locale, "Source URL", "Ссылка на источник")}</div>
          <input style={input} value={sourceUrl} onChange={(event) => setSourceUrl(event.target.value)} placeholder="https://example.com/article" />
        </div>

        <div style={{ display: "grid", gap: 6 }}>
          <div style={label}>{tr(locale, "Source text", "Исходный текст")}</div>
          <textarea
            style={textarea}
            value={sourceText}
            onChange={(event) => setSourceText(event.target.value)}
            placeholder={tr(
              locale,
              "Paste a rough draft, source excerpt, or author note here.",
              "Вставь черновик, фрагмент источника или заметку автора.",
            )}
          />
        </div>

        <div style={row}>
          <button
            type="submit"
            style={primary}
            disabled={composing || !destinationId || (!sourceText.trim() && !sourceUrl.trim()) || missingProfiles.length > 0}
          >
            {composing ? "..." : tr(locale, "Prepare with GPT-5.4", "Подготовить через GPT-5.4")}
          </button>
          {companyPrefix ? (
            <a href={companyHref(companyPrefix, "web-import")} style={button}>
              {tr(locale, "Open URL import", "Открыть URL import")}
            </a>
          ) : null}
        </div>
      </form>
    </section>
  );
}

function PublishingSurface({
  companyId,
  companyPrefix,
  locale,
  mode,
}: {
  companyId: string | null;
  companyPrefix: string | null;
  locale: Locale;
  mode: "page" | "settings";
}) {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [destinations, setDestinations] = useState<Destination[]>([]);
  const [donors, setDonors] = useState<Donor[]>([]);
  const [defaultDestinationId, setDefaultDestinationId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    if (!companyId) {
      setOverview(null);
      setLoading(false);
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
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [companyId]);

  const missingProfiles = useMemo(
    () => (overview?.profileCoverage ?? []).filter((entry) => !entry.hasProfile),
    [overview],
  );

  if (!companyId) return <div style={muted}>{tr(locale, "Company context is required.", "Нужен контекст компании.")}</div>;
  if (loading) return <div style={muted}>{tr(locale, "Loading Telegram Publishing...", "Загрузка Telegram Publishing...")}</div>;
  if (error) return <div style={danger}>{error}</div>;
  if (!overview) return null;

  return (
    <div style={surface}>
      <section style={section}>
        <div style={{ ...row, justifyContent: "space-between" }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700 }}>{tr(locale, "Telegram Publishing", "Telegram Publishing")}</div>
            <div style={muted}>
              {tr(
                locale,
                "Minimal workflow: channels, posts waiting for approval, and one GPT-5.4 compose surface.",
                "Минимальный workflow: каналы, посты в очереди на approval и одна compose-поверхность на GPT-5.4.",
              )}
            </div>
          </div>
          <div style={row}>
            {companyPrefix ? (
              <a href={companyHref(companyPrefix, "author-voice")} style={button}>
                {tr(locale, "Voice profiles", "Voice profiles")}
              </a>
            ) : null}
          </div>
        </div>

        <div style={row}>
          <div style={statCard}>
            <strong>{overview.publishChannels.length}</strong>
            <div style={muted}>{tr(locale, "Publish channels", "Каналы публикации")}</div>
          </div>
          <div style={statCard}>
            <strong>{overview.readyQueue.length}</strong>
            <div style={muted}>{tr(locale, "Ready for approval", "Готово к approval")}</div>
          </div>
          <div style={statCard}>
            <strong>{overview.donorChannels.length}</strong>
            <div style={muted}>{tr(locale, "Donor channels", "Каналы-доноры")}</div>
          </div>
          <div style={statCard}>
            <strong>{overview.botHealth?.failedPublishCount ?? 0}</strong>
            <div style={muted}>{tr(locale, "Failed publishes", "Ошибки публикации")}</div>
          </div>
        </div>

        <div style={row}>
          <span style={pill}>{tr(locale, "GPT-5.4 required", "Требуется GPT-5.4")}</span>
          <span style={pill}>
            {overview.settings.publishing.botTokenSecretRef
              ? tr(locale, "Bot token connected", "Токен бота подключен")
              : tr(locale, "Bot token missing", "Нет токена бота")}
          </span>
          {missingProfiles.length === 0 ? (
            <span style={pill}>{tr(locale, "Author voice ready", "Author voice настроен")}</span>
          ) : (
            <span style={pill}>{tr(locale, "Voice profiles missing", "Не хватает voice profiles")}</span>
          )}
        </div>

        {overview.lastPublication ? (
          <div style={muted}>
            {tr(locale, "Last publication", "Последняя публикация")}: {overview.lastPublication.destinationLabel} · {formatDate(locale, overview.lastPublication.sentAt)}
          </div>
        ) : null}
        {overview.botHealth?.error ? <div style={danger}>{overview.botHealth.error}</div> : null}
      </section>

      <SetupSection
        locale={locale}
        companyId={companyId}
        companyPrefix={companyPrefix}
        overview={overview}
        destinations={destinations}
        donors={donors}
        defaultDestinationId={defaultDestinationId}
        setDestinations={setDestinations}
        setDonors={setDonors}
        setDefaultDestinationId={setDefaultDestinationId}
        load={load}
      />

      {mode === "page" ? (
        <>
          <section style={section}>
            <div>
              <div style={{ fontSize: 16, fontWeight: 700 }}>{tr(locale, "Ready for approval", "Готово к approval")}</div>
              <div style={muted}>
                {tr(
                  locale,
                  "Only publication-ready posts waiting for publish approval are shown here.",
                  "Здесь показываются только готовые посты, ожидающие publish approval.",
                )}
              </div>
            </div>
            <QueueList locale={locale} companyPrefix={companyPrefix} items={overview.readyQueue} />
          </section>

          <ComposeSection locale={locale} companyId={companyId} companyPrefix={companyPrefix} overview={overview} load={load} />
        </>
      ) : (
        <section style={section}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700 }}>{tr(locale, "Publishing status", "Состояние публикаций")}</div>
            <div style={muted}>
              {tr(
                locale,
                "The full editorial queue lives on the company Telegram Publishing page.",
                "Полная editorial-очередь находится на company page Telegram Publishing.",
              )}
            </div>
          </div>
          <div style={row}>
            <div style={statCard}>
              <strong>{overview.readyQueue.length}</strong>
              <div style={muted}>{tr(locale, "Waiting approvals", "Ожидают approval")}</div>
            </div>
            <div style={statCard}>
              <strong>{overview.scheduledJobs.length}</strong>
              <div style={muted}>{tr(locale, "Scheduled jobs", "Запланированные jobs")}</div>
            </div>
            <div style={statCard}>
              <strong>{missingProfiles.length}</strong>
              <div style={muted}>{tr(locale, "Profile blockers", "Блокеры по профилям")}</div>
            </div>
          </div>
          {companyPrefix ? (
            <a href={companyHref(companyPrefix, PAGE_ROUTE)} style={primary}>
              {tr(locale, "Open Telegram Publishing", "Открыть Telegram Publishing")}
            </a>
          ) : null}
        </section>
      )}
    </div>
  );
}

function IssueTab({ context }: PluginDetailTabProps) {
  const locale = context.locale as Locale;
  const publications = usePluginData<Publication[]>(DATA_KEYS.issuePublications, {
    companyId: context.companyId,
    issueId: context.entityId,
  });
  const jobs = usePluginData<Job[]>(DATA_KEYS.issuePublicationJobs, {
    companyId: context.companyId,
    issueId: context.entityId,
  });

  if (!context.companyId || !context.entityId) {
    return <div style={muted}>{tr(locale, "Company context is required.", "Нужен контекст компании.")}</div>;
  }
  if (publications.loading || jobs.loading) {
    return <div style={muted}>{tr(locale, "Loading Telegram trace...", "Загрузка Telegram trace...")}</div>;
  }
  if (publications.error) return <div style={danger}>{publications.error.message}</div>;
  if (jobs.error) return <div style={danger}>{jobs.error.message}</div>;

  return (
    <div style={surface}>
      <section style={section}>
        <div style={{ fontSize: 16, fontWeight: 700 }}>{tr(locale, "Telegram trace", "Telegram trace")}</div>
        <div style={muted}>
          {tr(
            locale,
            "Issues keep only the trace. Compose and approval queue live on the company Telegram Publishing page.",
            "В задаче остается только trace. Compose и очередь approval находятся на company page Telegram Publishing.",
          )}
        </div>
        <a href={companyHref(context.companyPrefix, PAGE_ROUTE)} style={button}>
          {tr(locale, "Open Telegram Publishing", "Открыть Telegram Publishing")}
        </a>
      </section>

      <section style={section}>
        <div style={{ fontSize: 16, fontWeight: 700 }}>{tr(locale, "Publications", "Публикации")}</div>
        {(publications.data ?? []).length === 0 ? (
          <div style={muted}>{tr(locale, "No Telegram publications for this issue yet.", "По задаче еще нет публикаций в Telegram.")}</div>
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            {(publications.data ?? []).map((entry) => (
              <div key={entry.externalId} style={panel}>
                <strong>{entry.destinationLabel}</strong>
                <div style={muted}>{formatDate(locale, entry.sentAt)}</div>
                <div style={muted}>{entry.summary}</div>
                {entry.url ? <a href={entry.url} style={button}>Open Telegram link</a> : null}
              </div>
            ))}
          </div>
        )}
      </section>

      <section style={section}>
        <div style={{ fontSize: 16, fontWeight: 700 }}>{tr(locale, "Queue jobs", "Очередь")}</div>
        {(jobs.data ?? []).length === 0 ? (
          <div style={muted}>{tr(locale, "No Telegram queue jobs for this issue yet.", "По задаче еще нет элементов очереди Telegram.")}</div>
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            {(jobs.data ?? []).map((entry, index) => (
              <div key={entry.id ?? `${entry.issueId}-${index}`} style={panel}>
                <strong>{entry.status}</strong>
                <div style={muted}>{formatDate(locale, entry.publishAt)}</div>
                {entry.failureReason ? <div style={danger}>{entry.failureReason}</div> : null}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

export function TelegramPublishingSidebarLink({ context }: PluginSidebarProps) {
  return (
    <a href={companyHref(context.companyPrefix, PAGE_ROUTE)} style={button}>
      {tr(context.locale as Locale, "Telegram Publishing", "Telegram Publishing")}
    </a>
  );
}

export function TelegramPublishingDashboardWidget({ context }: PluginWidgetProps) {
  const locale = context.locale as Locale;
  const { data, loading, error } = usePluginData<Overview>(DATA_KEYS.overview, { companyId: context.companyId });
  if (!context.companyId) return <div style={muted}>{tr(locale, "Company context is required.", "Нужен контекст компании.")}</div>;
  if (loading) return <div style={muted}>{tr(locale, "Loading Telegram Publishing...", "Загрузка Telegram Publishing...")}</div>;
  if (error) return <div style={danger}>{error.message}</div>;
  if (!data) return null;

  return (
    <div style={section}>
      <div style={{ ...row, justifyContent: "space-between" }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700 }}>{tr(locale, "Telegram Publishing", "Telegram Publishing")}</div>
          <div style={muted}>
            {data.readyQueue.length} {tr(locale, "items are ready for approval", "элементов готовы к approval")}
          </div>
        </div>
        <a href={companyHref(context.companyPrefix, PAGE_ROUTE)} style={button}>
          {tr(locale, "Open", "Открыть")}
        </a>
      </div>
    </div>
  );
}

export function TelegramPublishingSettingsPage({ context }: PluginSettingsPageProps) {
  return (
    <PublishingSurface
      companyId={context.companyId}
      companyPrefix={context.companyPrefix}
      locale={context.locale as Locale}
      mode="settings"
    />
  );
}

export function TelegramPublishingPage({ context }: PluginPageProps) {
  return (
    <PublishingSurface
      companyId={context.companyId}
      companyPrefix={context.companyPrefix}
      locale={context.locale as Locale}
      mode="page"
    />
  );
}

export function TelegramPublishingIssueTab(props: PluginDetailTabProps) {
  return <IssueTab {...props} />;
}
