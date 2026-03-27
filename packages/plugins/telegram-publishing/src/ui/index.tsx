import { useEffect, useMemo, useState, type CSSProperties } from "react";
import type { PluginDetailTabProps, PluginPageProps, PluginSettingsPageProps, PluginSidebarProps, PluginWidgetProps } from "@paperclipai/plugin-sdk/ui";
import { usePluginToast } from "@paperclipai/plugin-sdk/ui";
import { PAGE_ROUTE } from "../constants.js";

type Locale = "en" | "ru";
type Reasoning = "low" | "medium" | "high";
type ModelOption = { id: string; label: string };
type Destination = { id: string; label: string; chatId: string; publicHandle: string; enabled: boolean; isDefault: boolean };
type Donor = { id: string; label: string; chatId: string; publicHandle: string; enabled: boolean };
type QueueItem = { approval: { id: string; updatedAt: string; status: string }; issue: { id: string; identifier: string; title: string } | null; destinationLabel: string | null; previewExcerpt: string | null; riskFlags: string[]; publishAt: string | null };
type Publication = { id?: string; destinationLabel?: string; summary?: string; sentAt?: string; failureReason?: string | null; status?: string; publishAt?: string };
type Overview = {
  configured: boolean;
  authorVoicePluginInstalled: boolean;
  settings: { publishing: { botTokenSecretRef: string; destinations: Destination[]; defaultDestinationId: string }; ai: { adapterType: "codex_local"; model: string; reasoningEffort: Reasoning }; ingestion: { sources: Donor[] } };
  publishChannels: Destination[];
  donorChannels: Donor[];
  profileCoverage?: { destinationId: string; destinationLabel: string; hasProfile: boolean }[];
  readyQueue: QueueItem[];
  scheduledJobs: Publication[];
  recentPublications: Publication[];
  recentIngestedStories: Array<{ sourceId?: string; excerpt?: string | null; linkedAt?: string | null }>;
  botHealth: { ok: boolean; checkedAt: string | null; error?: string | null; failedPublishCount?: number } | null;
};
type ComposeResult = { issue: { id: string; identifier: string; title: string }; approval: { id: string } };
type BundledPluginExample = { pluginKey: string; localPath: string };
type PageTab = "overview" | "channels" | "queue" | "compose";
type SettingsTab = "bot" | "channels" | "donors" | "ai";

const s: Record<string, CSSProperties> = {
  stack: { display: "grid", gap: 16 },
  row: { display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" },
  grid2: { display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" },
  card: { border: "1px solid var(--border)", borderRadius: 18, padding: 18, display: "grid", gap: 14, background: "var(--card, transparent)" },
  list: { border: "1px solid var(--border)", borderRadius: 14, padding: 14, display: "grid", gap: 10 },
  stat: { border: "1px solid var(--border)", borderRadius: 14, padding: 14, display: "grid", gap: 6 },
  label: { fontSize: 12, fontWeight: 600, opacity: 0.82 },
  muted: { fontSize: 12, opacity: 0.74, lineHeight: 1.5 },
  input: { width: "100%", border: "1px solid var(--border)", borderRadius: 12, background: "transparent", color: "inherit", padding: "10px 12px", fontSize: 13 },
  button: { appearance: "none", border: "1px solid var(--border)", borderRadius: 999, background: "transparent", color: "inherit", padding: "9px 15px", fontSize: 12, cursor: "pointer", textDecoration: "none", display: "inline-flex", alignItems: "center", justifyContent: "center" },
};
const textarea = { ...s.input, minHeight: 180, resize: "vertical", lineHeight: 1.5 } as CSSProperties;
const primary = { ...s.button, background: "var(--foreground)", borderColor: "var(--foreground)", color: "var(--background)" } as CSSProperties;
const tr = (l: Locale, en: string, ru: string) => (l === "ru" ? ru : en);
const loc = (v?: string | null): Locale => (v === "ru" ? "ru" : "en");
const publishingHref = (prefix?: string | null) => (prefix ? `/${prefix}/${PAGE_ROUTE}` : "#");
const authorVoiceHref = (prefix?: string | null) => (prefix ? `/${prefix}/author-voice` : "#");
const approvalHref = (prefix?: string | null, id?: string | null) => (prefix && id ? `/${prefix}/approvals/${id}` : "#");
const fmt = (l: Locale, v?: string | null) => !v ? "-" : new Intl.DateTimeFormat(l === "ru" ? "ru-RU" : "en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(v));
const dfltDest = (i: number): Destination => ({ id: `destination-${Date.now()}-${i}`, label: "", chatId: "", publicHandle: "", enabled: true, isDefault: i === 0 });
const dfltDonor = (i: number): Donor => ({ id: `donor-${Date.now()}-${i}`, label: "", chatId: "", publicHandle: "", enabled: true });
const AUTHOR_VOICE_PLUGIN_KEY = "paperclip.author-voice-profiles";

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  if (!r.ok) {
    let m = `${r.status} ${r.statusText}`;
    try { const p = await r.json() as { error?: string }; if (p.error) m = p.error; } catch {}
    throw new Error(m);
  }
  return r.json() as Promise<T>;
}

function Tab({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return <button type="button" style={{ ...s.button, background: active ? "var(--foreground)" : "transparent", borderColor: active ? "var(--foreground)" : "var(--border)", color: active ? "var(--background)" : "inherit" }} onClick={onClick}>{label}</button>;
}

function PublishingSurface({ mode, companyId, companyPrefix, locale }: { mode: "page" | "settings"; companyId: string | null; companyPrefix: string | null; locale: Locale }) {
  const toast = usePluginToast();
  const [data, setData] = useState<Overview | null>(null);
  const [models, setModels] = useState<ModelOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pageTab, setPageTab] = useState<PageTab>("overview");
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("bot");
  const [saving, setSaving] = useState<null | "bot" | "channels" | "ai" | "compose">(null);
  const [installingAuthorVoice, setInstallingAuthorVoice] = useState(false);
  const [botToken, setBotToken] = useState("");
  const [channels, setChannels] = useState<Destination[]>([]);
  const [donors, setDonors] = useState<Donor[]>([]);
  const [aiModel, setAiModel] = useState("");
  const [aiReasoning, setAiReasoning] = useState<Reasoning>("medium");
  const [compose, setCompose] = useState({ destinationId: "", publishAt: "", title: "", sourceUrl: "", sourceText: "" });
  const readyProfiles = useMemo(() => new Map((data?.profileCoverage ?? []).map((x) => [x.destinationId, x.hasProfile])), [data?.profileCoverage]);
  const publishChannels = data?.publishChannels.filter((x) => x.enabled) ?? [];
  const aiReady = !!aiModel.trim();

  async function load() {
    if (!companyId) { setLoading(false); return; }
    setLoading(true); setError(null);
    try {
      const [overview, ms] = await Promise.all([
        api<Overview>(`/api/companies/${companyId}/telegram-publishing/overview`),
        api<ModelOption[]>(`/api/companies/${companyId}/adapters/codex_local/models`).catch(() => []),
      ]);
      setData(overview); setModels(ms); setChannels(overview.publishChannels); setDonors(overview.donorChannels);
      setAiModel(overview.settings.ai.model ?? ""); setAiReasoning(overview.settings.ai.reasoningEffort ?? "medium");
      setCompose((c) => ({ ...c, destinationId: c.destinationId || overview.settings.publishing.defaultDestinationId || overview.publishChannels[0]?.id || "" }));
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setLoading(false); }
  }

  useEffect(() => { void load(); }, [companyId]);
  useEffect(() => { mode === "page" ? setPageTab("overview") : setSettingsTab("bot"); }, [mode]);

  async function saveToken() {
    if (!companyId || !botToken.trim()) return;
    setSaving("bot");
    try {
      await api(`/api/companies/${companyId}/plugins/paperclip.telegram-publishing/managed-secret`, { method: "POST", body: JSON.stringify({ settingsPath: "publishing.botTokenSecretRef", value: botToken.trim(), secretName: "telegram-publishing-bot-token", description: "Telegram Publishing bot token" }) });
      toast({ title: tr(locale, "Bot token saved", "Токен бота сохранен"), body: tr(locale, "Stored as a company secret.", "Сохранен как секрет компании."), tone: "success" });
      setBotToken(""); await load();
    } catch (e) { toast({ title: tr(locale, "Failed to save bot token", "Не удалось сохранить токен бота"), body: e instanceof Error ? e.message : String(e), tone: "error" }); } finally { setSaving(null); }
  }

  async function saveSettings(kind: "channels" | "ai") {
    if (!companyId || !data) return;
    setSaving(kind);
    try {
      const defaultDestinationId = channels.find((x) => x.isDefault)?.id || channels[0]?.id || "";
      await api(`/api/companies/${companyId}/plugins/paperclip.telegram-publishing/settings`, { method: "POST", body: JSON.stringify({ enabled: true, settingsJson: { ...data.settings, publishing: { ...data.settings.publishing, destinations: channels.map((x) => ({ ...x, isDefault: x.id === defaultDestinationId })), defaultDestinationId }, ingestion: { sources: donors }, ai: { adapterType: "codex_local", model: aiModel.trim(), reasoningEffort: aiReasoning } } }) });
      toast({ title: tr(locale, "Settings saved", "Настройки сохранены"), body: tr(locale, "Publishing settings have been updated.", "Настройки публикаций обновлены."), tone: "success" });
      await load();
    } catch (e) { toast({ title: tr(locale, "Failed to save settings", "Не удалось сохранить настройки"), body: e instanceof Error ? e.message : String(e), tone: "error" }); } finally { setSaving(null); }
  }

  async function prepare() {
    if (!companyId) return;
    setSaving("compose");
    try {
      const res = await api<ComposeResult>(`/api/companies/${companyId}/telegram-publishing/compose`, { method: "POST", body: JSON.stringify({ destinationId: compose.destinationId, publishAt: compose.publishAt || null, title: compose.title || null, sourceUrl: compose.sourceUrl || null, sourceText: compose.sourceText || null }) });
      toast({ title: tr(locale, "Post prepared", "Пост подготовлен"), body: tr(locale, `Created issue ${res.issue.identifier} and approval ${res.approval.id}.`, `Созданы задача ${res.issue.identifier} и одобрение ${res.approval.id}.`), tone: "success" });
      setCompose((c) => ({ ...c, title: "", sourceUrl: "", sourceText: "", publishAt: "" }));
      setPageTab("queue"); await load();
    } catch (e) { toast({ title: tr(locale, "Failed to prepare post", "Не удалось подготовить пост"), body: e instanceof Error ? e.message : String(e), tone: "error" }); } finally { setSaving(null); }
  }

  async function installAuthorVoicePlugin() {
    if (!companyPrefix) return;
    setInstallingAuthorVoice(true);
    try {
      const examples = await api<BundledPluginExample[]>("/api/plugins/examples");
      const authorVoiceExample = examples.find((entry) => entry.pluginKey === AUTHOR_VOICE_PLUGIN_KEY);
      if (!authorVoiceExample) {
        throw new Error(
          tr(
            locale,
            "The bundled voice profiles plugin was not found in the local catalog.",
            "Встроенный плагин профилей стиля не найден в локальном каталоге.",
          ),
        );
      }
      await api("/api/plugins/install", {
        method: "POST",
        body: JSON.stringify({
          packageName: authorVoiceExample.localPath,
          isLocalPath: true,
        }),
      });
      toast({
        title: tr(locale, "Voice profiles installed", "Профили стиля установлены"),
        body: tr(
          locale,
          "Opening the style profiles page.",
          "Открываю страницу профилей стиля.",
        ),
        tone: "success",
      });
      await load();
      window.location.assign(authorVoiceHref(companyPrefix));
    } catch (e) {
      toast({
        title: tr(locale, "Failed to install voice profiles", "Не удалось установить профили стиля"),
        body: e instanceof Error ? e.message : String(e),
        tone: "error",
      });
    } finally {
      setInstallingAuthorVoice(false);
    }
  }

  const updateChannel = (id: string, patch: Partial<Destination>) => setChannels((xs) => xs.map((x) => x.id === id ? { ...x, ...patch } : x));
  const updateDonor = (id: string, patch: Partial<Donor>) => setDonors((xs) => xs.map((x) => x.id === id ? { ...x, ...patch } : x));

  if (!companyId) return <div style={s.muted}>{tr(locale, "Company context is required.", "Нужен контекст компании.")}</div>;
  if (loading) return <div style={s.muted}>{tr(locale, "Loading publishing data...", "Загружаем данные публикаций...")}</div>;
  if (error || !data) return <div style={{ ...s.muted, color: "var(--destructive, #c00)" }}>{error ?? tr(locale, "Publishing data is unavailable.", "Данные публикаций недоступны.")}</div>;

  const channelsCard = (
    <div style={s.card}>
      <div style={{ ...s.row, justifyContent: "space-between" }}>
        <div>
          <strong>{tr(locale, "Destination channels", "Каналы назначения")}</strong>
          <div style={s.muted}>{tr(locale, "These are the Telegram channels where ready posts will be published.", "Это Telegram-каналы, куда будут отправляться готовые посты.")}</div>
        </div>
        <button type="button" style={s.button} onClick={() => setChannels((x) => [...x, dfltDest(x.length)])}>{tr(locale, "Add channel", "Добавить канал")}</button>
      </div>
      {channels.length === 0 ? <div style={s.muted}>{tr(locale, "No destination channels yet.", "Пока нет каналов назначения.")}</div> : channels.map((x) => <div key={x.id} style={s.list}><div style={s.grid2}><div><div style={s.label}>{tr(locale, "Name", "Название")}</div><input style={s.input} value={x.label} onChange={(e) => updateChannel(x.id, { label: e.target.value })} /></div><div><div style={s.label}>{tr(locale, "Chat ID or @handle", "Chat ID или @handle")}</div><input style={s.input} value={x.chatId} onChange={(e) => updateChannel(x.id, { chatId: e.target.value })} /></div></div><div style={s.row}><label style={s.row}><input type="radio" checked={x.isDefault} onChange={() => setChannels((xs) => xs.map((v) => ({ ...v, isDefault: v.id === x.id })))} />{tr(locale, "Default", "По умолчанию")}</label><label style={s.row}><input type="checkbox" checked={x.enabled} onChange={(e) => updateChannel(x.id, { enabled: e.target.checked })} />{tr(locale, "Enabled", "Включен")}</label><button type="button" style={s.button} onClick={() => setChannels((xs) => xs.filter((v) => v.id !== x.id))}>{tr(locale, "Remove", "Удалить")}</button><span style={s.muted}>{readyProfiles.get(x.id) ? tr(locale, "Style profile is configured", "Профиль стиля настроен") : tr(locale, "Style profile is missing", "Профиль стиля не настроен")}</span></div></div>)}
      <button type="button" style={primary} disabled={saving === "channels"} onClick={() => void saveSettings("channels")}>{saving === "channels" ? tr(locale, "Saving...", "Сохраняем...") : tr(locale, "Save channels", "Сохранить каналы")}</button>
    </div>
  );

  const donorsCard = (
    <div style={s.card}>
      <div style={{ ...s.row, justifyContent: "space-between" }}>
        <div>
          <strong>{tr(locale, "Donor channels", "Каналы-доноры")}</strong>
          <div style={s.muted}>{tr(locale, "These channels are sources from which you can borrow ideas or incoming material.", "Это каналы-источники, откуда можно брать идеи и исходный материал.")}</div>
        </div>
        <button type="button" style={s.button} onClick={() => setDonors((x) => [...x, dfltDonor(x.length)])}>{tr(locale, "Add donor", "Добавить донора")}</button>
      </div>
      {donors.length === 0 ? <div style={s.muted}>{tr(locale, "No donor channels yet.", "Пока нет каналов-доноров.")}</div> : donors.map((x) => <div key={x.id} style={s.list}><div style={s.grid2}><div><div style={s.label}>{tr(locale, "Name", "Название")}</div><input style={s.input} value={x.label} onChange={(e) => updateDonor(x.id, { label: e.target.value })} /></div><div><div style={s.label}>{tr(locale, "Chat ID or @handle", "Chat ID или @handle")}</div><input style={s.input} value={x.chatId} onChange={(e) => updateDonor(x.id, { chatId: e.target.value })} /></div></div><div style={s.row}><label style={s.row}><input type="checkbox" checked={x.enabled} onChange={(e) => updateDonor(x.id, { enabled: e.target.checked })} />{tr(locale, "Enabled", "Включен")}</label><button type="button" style={s.button} onClick={() => setDonors((xs) => xs.filter((v) => v.id !== x.id))}>{tr(locale, "Remove", "Удалить")}</button></div></div>)}
      {mode === "settings" ? <button type="button" style={primary} disabled={saving === "channels"} onClick={() => void saveSettings("channels")}>{saving === "channels" ? tr(locale, "Saving...", "Сохраняем...") : tr(locale, "Save donors", "Сохранить доноров")}</button> : null}
    </div>
  );

  return (
    <div style={s.stack}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {mode === "page" ? <>
          <Tab active={pageTab === "overview"} label={tr(locale, "Overview", "Обзор")} onClick={() => setPageTab("overview")} />
          <Tab active={pageTab === "channels"} label={tr(locale, "Channels", "Каналы")} onClick={() => setPageTab("channels")} />
          <Tab active={pageTab === "queue"} label={tr(locale, "Queue", "Очередь")} onClick={() => setPageTab("queue")} />
          <Tab active={pageTab === "compose"} label={tr(locale, "Prepare", "Подготовка")} onClick={() => setPageTab("compose")} />
        </> : <>
          <Tab active={settingsTab === "bot"} label={tr(locale, "Bot", "Бот")} onClick={() => setSettingsTab("bot")} />
          <Tab active={settingsTab === "channels"} label={tr(locale, "Channels", "Каналы")} onClick={() => setSettingsTab("channels")} />
          <Tab active={settingsTab === "donors"} label={tr(locale, "Donors", "Доноры")} onClick={() => setSettingsTab("donors")} />
          <Tab active={settingsTab === "ai"} label={tr(locale, "AI", "ИИ")} onClick={() => setSettingsTab("ai")} />
        </>}
      </div>

      {mode === "page" && pageTab === "overview" ? <div style={s.stack}>
        <div style={s.grid2}>{[
          [data.publishChannels.length, tr(locale, "Destination channels", "Каналы назначения")],
          [data.readyQueue.length, tr(locale, "Ready for approval", "Готово к одобрению")],
          [data.donorChannels.length, tr(locale, "Donor channels", "Каналы-доноры")],
          [data.botHealth?.failedPublishCount ?? 0, tr(locale, "Publication errors", "Ошибки публикации")],
        ].map(([v, l]) => <div key={String(l)} style={s.stat}><strong style={{ fontSize: 28 }}>{String(v)}</strong><div style={s.muted}>{String(l)}</div></div>)}</div>
        <div style={s.card}><div style={s.row}>
          <span style={s.button}>{data.settings.publishing.botTokenSecretRef ? tr(locale, "Bot token saved", "Токен бота сохранен") : tr(locale, "Bot token is missing", "Не задан токен бота")}</span>
          <span style={s.button}>{aiReady ? tr(locale, "AI is configured", "ИИ настроен") : tr(locale, "AI setup is required", "Требуется настройка ИИ")}</span>
          <span style={s.button}>{!data.authorVoicePluginInstalled ? tr(locale, "Voice profiles plugin is not installed", "Плагин профилей стиля не установлен") : data.profileCoverage?.every((x) => x.hasProfile) ? tr(locale, "Profiles are ready", "Профили стиля настроены") : tr(locale, "Some channels have no profile", "Не всем каналам назначен профиль стиля")}</span>
        </div><div style={s.muted}>{data.botHealth?.error || tr(locale, "Use the tabs below to manage channels, check the queue, and prepare new posts through AI.", "Используй вкладки ниже, чтобы управлять каналами, смотреть очередь и готовить новые посты через ИИ.")}</div><div style={s.row}><button type="button" style={s.button} onClick={() => setPageTab("channels")}>{tr(locale, "Open channels", "Открыть каналы")}</button><button type="button" style={s.button} onClick={() => setPageTab("queue")}>{tr(locale, "Open queue", "Открыть очередь")}</button><button type="button" style={primary} onClick={() => setPageTab("compose")}>{tr(locale, "Prepare a post", "Подготовить пост")}</button></div></div>
      </div> : null}

      {((mode === "page" && pageTab === "channels") || (mode === "settings" && settingsTab === "channels")) ? channelsCard : null}
      {((mode === "page" && pageTab === "channels") || (mode === "settings" && settingsTab === "donors")) ? donorsCard : null}

      {mode === "page" && pageTab === "queue" ? <div style={s.stack}>
        <div style={s.card}><strong>{tr(locale, "Ready for approval", "Готово к одобрению")}</strong>{data.readyQueue.length === 0 ? <div style={s.muted}>{tr(locale, "Nothing is waiting for approval.", "Сейчас нет постов в очереди на одобрение.")}</div> : data.readyQueue.map((x) => <div key={x.approval.id} style={s.list}><div style={{ ...s.row, justifyContent: "space-between" }}><strong>{x.issue ? `${x.issue.identifier} - ${x.issue.title}` : x.destinationLabel ?? tr(locale, "Telegram item", "Элемент Telegram")}</strong><a href={approvalHref(companyPrefix, x.approval.id)} style={s.button}>{tr(locale, "Open approval", "Открыть одобрение")}</a></div><div style={s.muted}>{x.previewExcerpt ?? tr(locale, "Preview is not available yet.", "Предпросмотр пока недоступен.")}</div><div style={s.row}><span style={s.button}>{x.destinationLabel ?? tr(locale, "Channel is not set", "Канал не указан")}</span><span style={s.button}>{fmt(locale, x.approval.updatedAt)}</span>{x.publishAt ? <span style={s.button}>{fmt(locale, x.publishAt)}</span> : null}</div></div>)}</div>
        <div style={s.grid2}><div style={s.card}><strong>{tr(locale, "Scheduled", "Запланировано")}</strong>{data.scheduledJobs.length === 0 ? <div style={s.muted}>{tr(locale, "No scheduled publications.", "Нет запланированных публикаций.")}</div> : data.scheduledJobs.slice(0, 6).map((x, i) => <div key={`${x.id ?? i}`} style={s.muted}>{x.destinationLabel ?? "-"} • {fmt(locale, x.publishAt)}</div>)}</div><div style={s.card}><strong>{tr(locale, "Recent publications", "Недавние публикации")}</strong>{data.recentPublications.length === 0 ? <div style={s.muted}>{tr(locale, "No publications yet.", "Публикаций пока не было.")}</div> : data.recentPublications.slice(0, 6).map((x, i) => <div key={`${x.id ?? i}`} style={s.muted}>{x.destinationLabel ?? "-"} • {x.summary ?? "-"} • {fmt(locale, x.sentAt)}</div>)}</div></div>
      </div> : null}

      {mode === "page" && pageTab === "compose" ? <div style={s.card}><div><div style={{ fontSize: 18, fontWeight: 700 }}>{tr(locale, "Prepare a post", "Подготовка поста")}</div><div style={s.muted}>{tr(locale, "Paste text or a source link. AI will rewrite it in the channel style and send it for approval.", "Вставь текст или ссылку. ИИ перепишет это под стиль канала и отправит на одобрение.")}</div></div>{!aiReady ? <div style={{ ...s.muted, color: "var(--destructive, #c00)" }}>{tr(locale, "AI settings are incomplete. Open the AI tab in settings first.", "Настройки ИИ не заполнены. Сначала открой вкладку «ИИ» в настройках.")}</div> : null}{!data.authorVoicePluginInstalled ? <div style={{ ...s.muted, color: "var(--destructive, #c00)" }}>{tr(locale, "Voice profiles plugin is not installed yet. Install it before preparing channel-style posts.", "Плагин профилей стиля еще не установлен. Установи его, прежде чем готовить посты под стиль канала.")}</div> : null}<div style={s.grid2}><div><div style={s.label}>{tr(locale, "Destination channel", "Канал назначения")}</div><div style={s.muted}>{tr(locale, "Choose where the prepared post will be published.", "Выбери канал, куда будет опубликован готовый пост.")}</div><select style={s.input} value={compose.destinationId} disabled={publishChannels.length === 0} onChange={(e) => setCompose((c) => ({ ...c, destinationId: e.target.value }))}><option value="">{publishChannels.length === 0 ? tr(locale, "First add a destination channel on the Channels tab", "Сначала добавь канал назначения на вкладке «Каналы»") : tr(locale, "Select a destination channel", "Выбери канал назначения")}</option>{publishChannels.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</select></div><div><div style={s.label}>{tr(locale, "Publish time (optional)", "Публикация по времени (необязательно)")}</div><input type="datetime-local" style={s.input} value={compose.publishAt} onChange={(e) => setCompose((c) => ({ ...c, publishAt: e.target.value }))} /></div></div>{publishChannels.length === 0 ? <div style={{ ...s.card, padding: 14, borderRadius: 14 }}><strong>{tr(locale, "Destination channels are not configured yet", "Каналы назначения еще не настроены")}</strong><div style={s.muted}>{tr(locale, "Add at least one destination channel first. That is the Telegram channel where the final post will be published.", "Сначала добавь хотя бы один канал назначения. Это тот Telegram-канал, куда в итоге будет опубликован готовый пост.")}</div><div style={s.row}><button type="button" style={primary} onClick={() => setPageTab("channels")}>{tr(locale, "Open channels tab", "Открыть вкладку «Каналы»")}</button></div></div> : null}<div><div style={s.label}>{tr(locale, "Internal title (optional)", "Внутренний заголовок (необязательно)")}</div><input style={s.input} value={compose.title} onChange={(e) => setCompose((c) => ({ ...c, title: e.target.value }))} placeholder={tr(locale, "Post topic", "Тема поста")} /></div><div><div style={s.label}>{tr(locale, "Source URL", "Ссылка на источник")}</div><input style={s.input} value={compose.sourceUrl} onChange={(e) => setCompose((c) => ({ ...c, sourceUrl: e.target.value }))} placeholder="https://example.com/article" /></div><div><div style={s.label}>{tr(locale, "Source text", "Исходный текст")}</div><textarea style={textarea} value={compose.sourceText} onChange={(e) => setCompose((c) => ({ ...c, sourceText: e.target.value }))} placeholder={tr(locale, "Paste a draft, source excerpt, or author note.", "Вставь черновик, фрагмент источника или заметку автора.")} /></div><div style={s.row}><button type="button" style={primary} disabled={saving === "compose" || !aiReady || !compose.destinationId || (!compose.sourceText.trim() && !compose.sourceUrl.trim())} onClick={() => void prepare()}>{saving === "compose" ? tr(locale, "Preparing...", "Подготавливаем...") : tr(locale, "Prepare with AI", "Подготовить через ИИ")}</button><button type="button" style={s.button} onClick={() => setPageTab("channels")}>{tr(locale, "Add destination channel", "Добавить канал назначения")}</button>{data.authorVoicePluginInstalled ? <a href={authorVoiceHref(companyPrefix)} style={s.button}>{tr(locale, "Open voice profiles", "Открыть профили стиля")}</a> : <button type="button" style={s.button} disabled={installingAuthorVoice} onClick={() => void installAuthorVoicePlugin()}>{installingAuthorVoice ? tr(locale, "Installing...", "Устанавливаем...") : tr(locale, "Install and open voice profiles", "Установить и открыть профили стиля")}</button>}</div></div> : null}

      {mode === "settings" && settingsTab === "bot" ? <div style={s.card}><strong>{tr(locale, "Bot token", "Токен бота")}</strong><div style={s.muted}>{data.settings.publishing.botTokenSecretRef ? tr(locale, "A company secret is already configured.", "Секрет компании уже настроен.") : tr(locale, "The token has not been saved yet.", "Токен еще не сохранен.")}</div><input style={s.input} value={botToken} onChange={(e) => setBotToken(e.target.value)} placeholder="123456:ABCDEF..." /><div style={s.row}><button type="button" style={primary} disabled={saving === "bot" || !botToken.trim()} onClick={() => void saveToken()}>{saving === "bot" ? tr(locale, "Saving...", "Сохраняем...") : tr(locale, "Save token", "Сохранить токен")}</button><a href={publishingHref(companyPrefix)} style={s.button}>{tr(locale, "Open publishing page", "Открыть страницу публикаций")}</a></div></div> : null}
      {mode === "settings" && settingsTab === "ai" ? <div style={s.card}><strong>{tr(locale, "AI settings", "Настройки ИИ")}</strong><div style={s.muted}>{tr(locale, "Telegram Publishing uses Codex CLI to prepare rewrites and approval-ready drafts.", "Публикации в Telegram используют Codex CLI, чтобы готовить рерайт и черновики для одобрения.")}</div><div><div style={s.label}>{tr(locale, "Model", "Модель")}</div><select style={s.input} value={aiModel} onChange={(e) => setAiModel(e.target.value)}><option value="">{tr(locale, "Select a model", "Выбери модель")}</option>{models.map((x) => <option key={x.id} value={x.id}>{x.label || x.id}</option>)}</select></div><div><div style={s.label}>{tr(locale, "Or set model ID manually", "Или укажи ID модели вручную")}</div><input style={s.input} value={aiModel} onChange={(e) => setAiModel(e.target.value)} placeholder="codex-latest" /></div><div><div style={s.label}>{tr(locale, "Reasoning", "Уровень reasoning")}</div><select style={s.input} value={aiReasoning} onChange={(e) => setAiReasoning(e.target.value as Reasoning)}><option value="low">low</option><option value="medium">medium</option><option value="high">high</option></select></div><button type="button" style={primary} disabled={saving === "ai" || !aiModel.trim()} onClick={() => void saveSettings("ai")}>{saving === "ai" ? tr(locale, "Saving...", "Сохраняем...") : tr(locale, "Save AI settings", "Сохранить настройки ИИ")}</button></div> : null}
    </div>
  );
}

export function TelegramPublishingSettingsPage(props: PluginSettingsPageProps) { return <PublishingSurface mode="settings" companyId={props.context.companyId ?? null} companyPrefix={props.context.companyPrefix ?? null} locale={loc(props.context.locale)} />; }
export function TelegramPublishingPage(props: PluginPageProps) { return <PublishingSurface mode="page" companyId={props.context.companyId ?? null} companyPrefix={props.context.companyPrefix ?? null} locale={loc(props.context.locale)} />; }
export function TelegramPublishingDashboardWidget(props: PluginWidgetProps) {
  const locale = loc(props.context.locale); const companyId = props.context.companyId ?? null; const [data, setData] = useState<Overview | null>(null);
  useEffect(() => { if (!companyId) return; void api<Overview>(`/api/companies/${companyId}/telegram-publishing/overview`).then(setData).catch(() => setData(null)); }, [companyId]);
  if (!companyId) return null;
  return <div style={s.card}><strong>{tr(locale, "Telegram Publishing", "Публикации в Telegram")}</strong><div style={s.grid2}><div style={s.stat}><strong>{data?.readyQueue.length ?? 0}</strong><div style={s.muted}>{tr(locale, "Ready for approval", "Готово к одобрению")}</div></div><div style={s.stat}><strong>{data?.publishChannels.length ?? 0}</strong><div style={s.muted}>{tr(locale, "Channels", "Каналы")}</div></div></div></div>;
}
export function TelegramPublishingIssueTab(props: PluginDetailTabProps) {
  const locale = loc(props.context.locale);
  return <div style={s.card}><strong>{tr(locale, "Publishing trace", "След публикации")}</strong><div style={s.muted}>{tr(locale, "Publishing is managed on the company plugin page. This issue keeps source documents, drafts, approvals, and publication history.", "Публикации управляются на странице плагина компании. В этой задаче сохраняются исходники, черновики, одобрения и история публикаций.")}</div>{props.context.companyPrefix ? <a href={publishingHref(props.context.companyPrefix)} style={s.button}>{tr(locale, "Open publishing page", "Открыть страницу публикаций")}</a> : null}</div>;
}
export function TelegramPublishingSidebarLink(_props: PluginSidebarProps) { return null; }
