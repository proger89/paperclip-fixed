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
  TelegramLinkedChat,
  TelegramOverview,
  TelegramPublication,
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

function hostPath(companyPrefix: string | null | undefined, suffix: string): string {
  return companyPrefix ? `/${companyPrefix}${suffix}` : suffix;
}

function pluginPagePath(companyPrefix: string | null | undefined): string {
  return hostPath(companyPrefix, `/${PAGE_ROUTE}`);
}

function formatTimestamp(value: string | null | undefined): string {
  if (!value) return "never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
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
  return {
    publishing: {
      botTokenSecretRef: settings?.publishing.botTokenSecretRef ?? DEFAULT_COMPANY_SETTINGS.publishing.botTokenSecretRef,
      defaultChatId: settings?.publishing.defaultChatId ?? DEFAULT_COMPANY_SETTINGS.publishing.defaultChatId,
      defaultPublicHandle: settings?.publishing.defaultPublicHandle ?? DEFAULT_COMPANY_SETTINGS.publishing.defaultPublicHandle,
      defaultParseMode: settings?.publishing.defaultParseMode ?? DEFAULT_COMPANY_SETTINGS.publishing.defaultParseMode,
      defaultDisableLinkPreview: settings?.publishing.defaultDisableLinkPreview ?? DEFAULT_COMPANY_SETTINGS.publishing.defaultDisableLinkPreview,
      defaultDisableNotification: settings?.publishing.defaultDisableNotification ?? DEFAULT_COMPANY_SETTINGS.publishing.defaultDisableNotification,
    },
    taskBot: {
      enabled: settings?.taskBot.enabled ?? DEFAULT_COMPANY_SETTINGS.taskBot.enabled,
      pollingEnabled: settings?.taskBot.pollingEnabled ?? DEFAULT_COMPANY_SETTINGS.taskBot.pollingEnabled,
      notificationMode: settings?.taskBot.notificationMode ?? DEFAULT_COMPANY_SETTINGS.taskBot.notificationMode,
      claimCodeTtlMinutes: settings?.taskBot.claimCodeTtlMinutes ?? DEFAULT_COMPANY_SETTINGS.taskBot.claimCodeTtlMinutes,
    },
  };
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

function Pill({ label, tone = "neutral" }: { label: string; tone?: "neutral" | "success" | "warn" }) {
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
      {label}
    </span>
  );
}

function PublicationList({ publications }: { publications: TelegramPublication[] }) {
  if (publications.length === 0) {
    return <div style={mutedTextStyle}>No Telegram publications recorded yet.</div>;
  }

  return (
    <div style={{ display: "grid", gap: "10px" }}>
      {publications.map((publication) => (
        <div key={publication.externalId} style={{ ...cardStyle, padding: "12px" }}>
          <div style={{ ...rowStyle, justifyContent: "space-between" }}>
            <strong>{publication.destinationLabel}</strong>
            <span style={mutedTextStyle}>{formatTimestamp(publication.sentAt)}</span>
          </div>
          <div style={{ fontSize: "12px", lineHeight: 1.45 }}>{publication.summary}</div>
          <div style={rowStyle}>
            {publication.issueIdentifier ? <Pill label={publication.issueIdentifier} /> : null}
            {publication.publicHandle ? <Pill label={`@${publication.publicHandle}`} /> : null}
            {publication.approvalId ? <Pill label="Approved" tone="success" /> : null}
            {publication.parseMode ? <Pill label={publication.parseMode} /> : null}
          </div>
          {publication.url ? (
            <a href={publication.url} target="_blank" rel="noreferrer" style={{ fontSize: "12px" }}>
              Open Telegram post
            </a>
          ) : (
            <div style={mutedTextStyle}>No public post URL available. Set a public handle to surface clickable links.</div>
          )}
        </div>
      ))}
    </div>
  );
}

function SettingsField({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label style={{ display: "grid", gap: "6px" }}>
      <span style={{ fontSize: "12px", fontWeight: 600 }}>{label}</span>
      {children}
      {hint ? <span style={mutedTextStyle}>{hint}</span> : null}
    </label>
  );
}

export function TelegramSettingsPage({ context }: PluginSettingsPageProps) {
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

  function setPublishingField<K extends keyof TelegramCompanySettings["publishing"]>(
    key: K,
    value: TelegramCompanySettings["publishing"][K],
  ) {
    setSettingsJson((current) => ({
      ...current,
      publishing: {
        ...current.publishing,
        [key]: value,
      },
    }));
  }

  function setTaskBotField<K extends keyof TelegramCompanySettings["taskBot"]>(
    key: K,
    value: TelegramCompanySettings["taskBot"][K],
  ) {
    setSettingsJson((current) => ({
      ...current,
      taskBot: {
        ...current.taskBot,
        [key]: value,
      },
    }));
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    await save(settingsJson, enabled);
    pushToast({
      title: "Telegram settings saved",
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
        title: "Bot token secret created",
        body: `Stored as ${created.name}.`,
        tone: "success",
      });
    } catch (nextError) {
      pushToast({
        title: "Failed to create secret",
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
        title: "Legacy Telegram config imported",
        body: "Company-scoped Telegram settings now mirror the previous global connector config.",
        tone: "success",
      });
      overview.refresh();
    } catch (nextError) {
      pushToast({
        title: "Failed to import legacy config",
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
        : (result.defaultChat?.title ?? result.defaultChat?.id ?? "configured chat");
      const message = `Connected as ${botName}${result.defaultChat ? ` to ${chatLabel}` : ""}.`;
      setTestResult(message);
      pushToast({
        title: "Telegram connection OK",
        body: message,
        tone: "success",
      });
    } catch (nextError) {
      const message = nextError instanceof Error ? nextError.message : String(nextError);
      setTestResult(message);
      pushToast({
        title: "Telegram connection failed",
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
        title: "Telegram link code created",
        body: `Use ${result.startCommand} in a private chat with the bot.`,
        tone: "success",
      });
    } catch (nextError) {
      pushToast({
        title: "Failed to generate link code",
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
        title: "Telegram chat revoked",
        body: `Chat ${chatId} will stop receiving task updates.`,
        tone: "success",
      });
      overview.refresh();
    } catch (nextError) {
      pushToast({
        title: "Failed to revoke Telegram chat",
        body: nextError instanceof Error ? nextError.message : String(nextError),
        tone: "error",
      });
    }
  }

  if (loading) {
    return <div style={mutedTextStyle}>Loading Telegram settings...</div>;
  }

  return (
    <form onSubmit={onSubmit} style={layoutStack}>
      <div style={cardStyle}>
        <div style={{ ...layoutStack, gap: "10px" }}>
          <div style={sectionTitleStyle}>Telegram Connector</div>
          <div style={mutedTextStyle}>
            Configure company-scoped Telegram publishing and the Paperclip task bot. Publishing stays governed through approvals; task bot access is linked chat by chat with one-time codes.
          </div>
          <div style={rowStyle}>
            <a href={pluginPagePath(context.companyPrefix)} style={{ fontSize: "12px" }}>Open Telegram dashboard</a>
            {context.companyId ? <Pill label={context.companyId} /> : <Pill label="No company selected" tone="warn" />}
            {enabled ? <Pill label="enabled" tone="success" /> : <Pill label="disabled" tone="warn" />}
            {overview.data?.botHealth?.ok ? <Pill label="bot healthy" tone="success" /> : null}
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gap: "16px", gridTemplateColumns: "minmax(0, 1.2fr) minmax(280px, 0.8fr)" }}>
        <div style={{ ...cardStyle, ...layoutStack }}>
          <div style={sectionTitleStyle}>Publishing</div>
          <label style={rowStyle}>
            <input
              type="checkbox"
              checked={enabled}
              onChange={(event) => setEnabled(event.target.checked)}
            />
            <span style={{ fontSize: "12px" }}>Enable this Telegram connector for the selected company</span>
          </label>
          <SettingsField
            label="Bot token secret"
            hint="Stored as a Paperclip company secret. The worker resolves it at publish time."
          >
            <select
              style={inputStyle}
              value={settingsJson.publishing.botTokenSecretRef}
              onChange={(event) => setPublishingField("botTokenSecretRef", event.target.value)}
            >
              <option value="">Select a secret...</option>
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
          >
            <select
              style={inputStyle}
              value={settingsJson.publishing.defaultParseMode}
              onChange={(event) => setPublishingField("defaultParseMode", event.target.value as TelegramCompanySettings["publishing"]["defaultParseMode"])}
            >
              <option value="">Plain text</option>
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
            <span style={{ fontSize: "12px" }}>Disable link preview by default</span>
          </label>
          <label style={rowStyle}>
            <input
              type="checkbox"
              checked={settingsJson.publishing.defaultDisableNotification === true}
              onChange={(event) => setPublishingField("defaultDisableNotification", event.target.checked)}
            />
            <span style={{ fontSize: "12px" }}>Send posts silently by default</span>
          </label>

          <div style={{ ...sectionTitleStyle, marginTop: "6px" }}>Task Bot</div>
          <label style={rowStyle}>
            <input
              type="checkbox"
              checked={settingsJson.taskBot.enabled === true}
              onChange={(event) => setTaskBotField("enabled", event.target.checked)}
            />
            <span style={{ fontSize: "12px" }}>Enable Paperclip task bot over Telegram getUpdates polling</span>
          </label>
          <label style={rowStyle}>
            <input
              type="checkbox"
              checked={settingsJson.taskBot.pollingEnabled !== false}
              onChange={(event) => setTaskBotField("pollingEnabled", event.target.checked)}
            />
            <span style={{ fontSize: "12px" }}>Allow minute polling for inbound Telegram commands and replies</span>
          </label>
          <SettingsField label="Notification mode">
            <select
              style={inputStyle}
              value={settingsJson.taskBot.notificationMode}
              onChange={(event) => setTaskBotField("notificationMode", event.target.value as TelegramCompanySettings["taskBot"]["notificationMode"])}
            >
              <option value="fallback_all_linked">Fallback to all linked chats</option>
              <option value="linked_only">Linked watchers only</option>
            </select>
          </SettingsField>
          <SettingsField label="Link code TTL (minutes)">
            <input
              style={inputStyle}
              type="number"
              min={5}
              max={1440}
              value={settingsJson.taskBot.claimCodeTtlMinutes}
              onChange={(event) => setTaskBotField("claimCodeTtlMinutes", Math.max(5, Math.min(1440, Number(event.target.value) || DEFAULT_COMPANY_SETTINGS.taskBot.claimCodeTtlMinutes)))}
            />
          </SettingsField>

          {error ? <div style={{ color: "var(--destructive, #c00)", fontSize: "12px" }}>{error}</div> : null}
          {testResult ? <div style={mutedTextStyle}>{testResult}</div> : null}
          {legacyConfig.error ? <div style={{ color: "var(--destructive, #c00)", fontSize: "12px" }}>{legacyConfig.error}</div> : null}

          <div style={rowStyle}>
            <button type="submit" style={primaryButtonStyle} disabled={saving}>
              {saving ? "Saving..." : "Save settings"}
            </button>
            <button
              type="button"
              style={buttonStyle}
              disabled={!context.companyId}
              onClick={() => void onTestConnection()}
            >
              Test connection
            </button>
            {legacyDetected ? (
              <button
                type="button"
                style={buttonStyle}
                disabled={importingLegacy || legacyConfig.loading}
                onClick={() => void onImportLegacy()}
              >
                {importingLegacy ? "Importing..." : "Import legacy config"}
              </button>
            ) : null}
          </div>
        </div>

        <div style={{ ...cardStyle, ...layoutStack }}>
          <div style={sectionTitleStyle}>Secret bootstrap</div>
          <div style={mutedTextStyle}>
            There is no dedicated secrets page yet. Create the Telegram bot token secret here and the connector will immediately start using it.
          </div>
          <SettingsField label="Secret name">
            <input style={inputStyle} value={secretName} onChange={(event) => setSecretName(event.target.value)} />
          </SettingsField>
          <SettingsField label="Bot token">
            <input
              style={inputStyle}
              type="password"
              value={secretValue}
              onChange={(event) => setSecretValue(event.target.value)}
              placeholder="123456:ABCDEF..."
            />
          </SettingsField>
          <SettingsField label="Description">
            <input style={inputStyle} value={secretDescription} onChange={(event) => setSecretDescription(event.target.value)} />
          </SettingsField>
          <div style={rowStyle}>
            <button
              type="button"
              style={buttonStyle}
              disabled={!context.companyId || creatingSecret || secretValue.trim().length === 0 || secretName.trim().length === 0}
              onClick={() => void onCreateSecret()}
            >
              {creatingSecret ? "Creating..." : "Create bot token secret"}
            </button>
          </div>
          {secretsLoading ? <div style={mutedTextStyle}>Loading company secrets...</div> : null}
          {secretsError ? <div style={{ color: "var(--destructive, #c00)", fontSize: "12px" }}>{secretsError}</div> : null}
          {secrets.length > 0 ? (
            <div style={{ display: "grid", gap: "8px" }}>
              <div style={{ fontSize: "12px", fontWeight: 600 }}>Available secrets</div>
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
          <div style={sectionTitleStyle}>Task Bot Linking</div>
          <div style={mutedTextStyle}>
            Generate one-time link codes for private Telegram chats. Linked users can browse tasks, create new ones, and reply directly from Telegram.
          </div>
          <div style={rowStyle}>
            <button
              type="button"
              style={buttonStyle}
              disabled={!context.companyId || settingsJson.taskBot.enabled !== true}
              onClick={() => void onGenerateLinkCode()}
            >
              Generate link code
            </button>
            <span style={mutedTextStyle}>TTL: {settingsJson.taskBot.claimCodeTtlMinutes} min</span>
          </div>
          {linkCode ? (
            <div style={{ border: "1px solid var(--border)", borderRadius: "12px", padding: "12px", display: "grid", gap: "6px" }}>
              <div style={{ fontSize: "12px", fontWeight: 600 }}>Latest link code</div>
              <div style={{ fontFamily: "monospace", fontSize: "13px" }}>{linkCode.startCommand}</div>
              <div style={mutedTextStyle}>Expires {formatTimestamp(linkCode.expiresAt)}</div>
            </div>
          ) : null}
          {overview.data?.linkedChats?.length ? (
            <div style={{ display: "grid", gap: "8px" }}>
              <div style={{ fontSize: "12px", fontWeight: 600 }}>Linked chats</div>
              {overview.data.linkedChats.map((chat) => (
                <div key={`${chat.companyId}:${chat.chatId}`} style={{ border: "1px solid var(--border)", borderRadius: "10px", padding: "10px", display: "grid", gap: "8px" }}>
                  <div style={{ ...rowStyle, justifyContent: "space-between" }}>
                    <strong style={{ fontSize: "12px" }}>{chat.username ? `@${chat.username}` : chat.displayName}</strong>
                    {chat.revokedAt ? <Pill label="revoked" tone="warn" /> : <Pill label="linked" tone="success" />}
                  </div>
                  <div style={mutedTextStyle}>
                    chatId: {chat.chatId} | linked {formatTimestamp(chat.linkedAt)}
                  </div>
                  <div style={mutedTextStyle}>
                    board user: {chat.boardUserId ?? "unscoped"} | telegram user: {chat.telegramUserId}
                  </div>
                  {!chat.revokedAt ? (
                    <div style={rowStyle}>
                      <button type="button" style={buttonStyle} onClick={() => void onRevokeLinkedChat(chat.chatId)}>
                        Revoke
                      </button>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          ) : (
            <div style={mutedTextStyle}>No Telegram chats linked yet.</div>
          )}
        </div>

        <div style={{ ...cardStyle, ...layoutStack }}>
          <div style={sectionTitleStyle}>Bot Health</div>
          <div style={{ display: "grid", gap: "6px", fontSize: "12px" }}>
            <div>Last poll: {formatTimestamp(overview.data?.botHealth?.checkedAt)}</div>
            <div>Last update offset: {overview.data?.botHealth?.lastUpdateId ?? "none"}</div>
            <div>Last activity cursor: {overview.data?.botHealth?.lastActivityCursor ?? "none"}</div>
            <div>Last notification: {formatTimestamp(overview.data?.botHealth?.lastNotificationAt)}</div>
            <div>Last approval notification: {formatTimestamp(overview.data?.botHealth?.lastApprovalNotificationAt)}</div>
            <div>Last control-plane notification: {formatTimestamp(overview.data?.botHealth?.lastControlPlaneNotificationAt)}</div>
            <div>Blocked tasks: {overview.data?.blockedTaskCount ?? 0}</div>
            <div>Open tasks: {overview.data?.openTaskCount ?? 0}</div>
            <div>Open approvals: {overview.data?.botHealth?.openApprovalCount ?? 0}</div>
            <div>Revision approvals: {overview.data?.botHealth?.revisionApprovalCount ?? 0}</div>
            <div>Pending join requests: {overview.data?.botHealth?.openJoinRequestCount ?? 0}</div>
            <div>Open budget incidents: {overview.data?.botHealth?.openBudgetIncidentCount ?? 0}</div>
          </div>
          {overview.data?.botHealth?.error ? (
            <div style={{ color: "var(--destructive, #c00)", fontSize: "12px" }}>
              {overview.data.botHealth.error}
            </div>
          ) : (
            <div style={mutedTextStyle}>Telegram bot health looks stable.</div>
          )}
          {legacyDetected ? (
            <div style={mutedTextStyle}>
              Legacy global Telegram config was detected. Import it once to move this company fully onto scoped settings.
            </div>
          ) : null}
        </div>
      </div>
    </form>
  );
}

export function TelegramDashboardWidget({ context }: PluginWidgetProps) {
  const overview = usePluginData<TelegramOverview>(DATA_KEYS.overview, context.companyId ? { companyId: context.companyId } : {});

  return (
    <div style={layoutStack}>
      <div style={rowStyle}>
        <strong>Telegram</strong>
        <Pill label="connector" />
        {overview.data?.configured ? <Pill label="configured" tone="success" /> : <Pill label="needs setup" tone="warn" />}
      </div>
      <div style={mutedTextStyle}>
        Governed Telegram publishing plus Telegram operator coverage for tasks, approvals, joins, and budgets.
      </div>
      <div style={{ display: "grid", gap: "4px", fontSize: "12px" }}>
        <div>Default channel: {overview.data?.config?.defaultChatId ?? "not configured"}</div>
        <div>Linked chats: {overview.data?.linkedChats.filter((chat) => !chat.revokedAt).length ?? 0}</div>
        <div>Blocked tasks: {overview.data?.blockedTaskCount ?? 0}</div>
        <div>Board approvals: {overview.data?.actionableApprovalCount ?? 0}</div>
        <div>Pending joins: {overview.data?.pendingJoinRequestCount ?? 0}</div>
        <div>Open budget incidents: {overview.data?.openBudgetIncidentCount ?? 0}</div>
        <div>Recent publishes: {overview.data?.recentPublications.length ?? 0}</div>
        <div>Last publish: {formatTimestamp(overview.data?.lastPublication?.sentAt)}</div>
      </div>
      <div style={rowStyle}>
        <a href={pluginPagePath(context.companyPrefix)} style={{ fontSize: "12px" }}>Open Telegram dashboard</a>
      </div>
    </div>
  );
}

export function TelegramSidebarLink({ context }: PluginSidebarProps) {
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
      <span className="flex-1 truncate">Telegram</span>
    </a>
  );
}

export function TelegramPage({ context }: PluginPageProps) {
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
            <div style={sectionTitleStyle}>Telegram Operations</div>
            <div style={mutedTextStyle}>
              Company-level view of Telegram capability readiness, pending publish approvals, and recent outbound posts.
            </div>
          </div>
          <div style={rowStyle}>
            {overview.data?.configured ? <Pill label="Ready" tone="success" /> : <Pill label="Needs setup" tone="warn" />}
            <a href={`/instance/settings/plugins/${PLUGIN_ID}`} style={{ fontSize: "12px" }}>Open settings</a>
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gap: "14px", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
        <div style={cardStyle}>
          <div style={sectionTitleStyle}>Connection</div>
          <div style={{ ...layoutStack, gap: "8px", marginTop: "10px" }}>
            <div style={{ fontSize: "12px" }}>Default channel: {overview.data?.config?.defaultChatId ?? "not configured"}</div>
            <div style={{ fontSize: "12px" }}>Public handle: {overview.data?.config?.defaultPublicHandle ? `@${overview.data.config.defaultPublicHandle}` : "not set"}</div>
            <div style={{ fontSize: "12px" }}>Last validation: {formatTimestamp(overview.data?.lastValidation?.checkedAt)}</div>
            <div style={{ fontSize: "12px" }}>Bot: {overview.data?.lastValidation?.bot?.username ? `@${overview.data.lastValidation.bot.username}` : (overview.data?.lastValidation?.bot?.firstName ?? "unknown")}</div>
          </div>
        </div>
        <div style={cardStyle}>
          <div style={sectionTitleStyle}>Task Bot</div>
          <div style={{ ...layoutStack, gap: "8px", marginTop: "10px" }}>
            <div style={{ fontSize: "12px" }}>Enabled: {overview.data?.companySettings.taskBot.enabled ? "yes" : "no"}</div>
            <div style={{ fontSize: "12px" }}>Approvals inbox enabled: {overview.data?.approvalsInboxEnabled ? "yes" : "no"}</div>
            <div style={{ fontSize: "12px" }}>Linked chats: {overview.data?.linkedChats.filter((chat) => !chat.revokedAt).length ?? 0}</div>
            <div style={{ fontSize: "12px" }}>Blocked tasks: {overview.data?.blockedTaskCount ?? 0}</div>
            <div style={{ fontSize: "12px" }}>Open tasks: {overview.data?.openTaskCount ?? 0}</div>
            <div style={{ fontSize: "12px" }}>Tasks in review: {overview.data?.reviewTaskCount ?? 0}</div>
            <div style={{ fontSize: "12px" }}>Last poll: {formatTimestamp(overview.data?.botHealth?.checkedAt)}</div>
          </div>
        </div>
        <div style={cardStyle}>
          <div style={sectionTitleStyle}>Approvals Inbox</div>
          <div style={{ ...layoutStack, gap: "8px", marginTop: "10px" }}>
            <div style={{ fontSize: "12px" }}>Board queue: {overview.data?.actionableApprovalCount ?? 0}</div>
            <div style={{ fontSize: "12px" }}>My pending approvals: {overview.data?.myPendingApprovalCount ?? 0}</div>
            <div style={{ fontSize: "12px" }}>My revision requests: {overview.data?.myRevisionApprovalCount ?? 0}</div>
            <div style={{ fontSize: "12px" }}>Last approval notification: {formatTimestamp(overview.data?.botHealth?.lastApprovalNotificationAt)}</div>
            <div style={{ fontSize: "12px" }}>Pending join requests: {overview.data?.pendingJoinRequestCount ?? 0}</div>
            <div style={{ fontSize: "12px" }}>Open budget incidents: {overview.data?.openBudgetIncidentCount ?? 0}</div>
            <div style={{ fontSize: "12px" }}>Last control-plane notification: {formatTimestamp(overview.data?.botHealth?.lastControlPlaneNotificationAt)}</div>
            <div style={{ fontSize: "12px" }}>Total Telegram publish approvals: {telegramApprovals.length}</div>
            {pendingApprovals[0] ? (
              <a href={`/approvals/${pendingApprovals[0].id}`} style={{ fontSize: "12px" }}>
                Open latest pending approval
              </a>
            ) : (
              <div style={mutedTextStyle}>No pending Telegram publish approvals.</div>
            )}
          </div>
        </div>
        <div style={cardStyle}>
          <div style={sectionTitleStyle}>Recent publishing</div>
          <div style={{ ...layoutStack, gap: "8px", marginTop: "10px" }}>
            <div style={{ fontSize: "12px" }}>Recent posts tracked: {overview.data?.recentPublications.length ?? 0}</div>
            <div style={{ fontSize: "12px" }}>Last post: {formatTimestamp(overview.data?.lastPublication?.sentAt)}</div>
            {overview.data?.lastPublication?.url ? (
              <a href={overview.data.lastPublication.url} target="_blank" rel="noreferrer" style={{ fontSize: "12px" }}>
                Open latest Telegram post
              </a>
            ) : (
              <div style={mutedTextStyle}>No public Telegram post URL recorded yet.</div>
            )}
          </div>
        </div>
      </div>

      <div style={cardStyle}>
        <div style={sectionTitleStyle}>Recent publications</div>
        <div style={{ marginTop: "12px" }}>
          <PublicationList publications={overview.data?.recentPublications ?? []} />
        </div>
      </div>
    </div>
  );
}

export function TelegramIssueTab({ context }: PluginDetailTabProps) {
  const companyId = context.companyId;
  const issueId = context.entityId;
  const pushToast = usePluginToast();
  const publishMessage = usePluginAction(ACTION_KEYS.publishMessage);
  const { issue, approvals, loading, error, refresh } = useIssueTelegramResources(issueId);
  const issuePublications = usePluginData<TelegramPublication[]>(
    DATA_KEYS.issuePublications,
    companyId && issueId ? { companyId, issueId } : {},
  );
  const [selectedDocumentKey, setSelectedDocumentKey] = useState("");
  const [composerText, setComposerText] = useState("");
  const [destinationLabel, setDestinationLabel] = useState("");
  const [chatId, setChatId] = useState("");
  const [publicHandle, setPublicHandle] = useState("");
  const [parseMode, setParseMode] = useState<"" | "HTML" | "MarkdownV2">("");
  const [disableLinkPreview, setDisableLinkPreview] = useState(false);
  const [disableNotification, setDisableNotification] = useState(false);
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
    const preferred = documentOptions.find((entry) => ["telegram-draft", "final", "draft", "plan"].includes(entry.key))
      ?? documentOptions[0]
      ?? null;
    if (preferred) {
      setSelectedDocumentKey(preferred.key);
    }
  }, [documentOptions, selectedDocumentKey]);

  useEffect(() => {
    if (destinationLabel) return;
    const candidate = approvalDestinationLabel(latestApprovedApproval ?? latestPendingApproval)
      ?? overview.data?.config?.defaultChatId
      ?? "";
    if (candidate) setDestinationLabel(candidate);
  }, [destinationLabel, latestApprovedApproval, latestPendingApproval, overview.data?.config?.defaultChatId]);

  useEffect(() => {
    if (chatId) return;
    const candidate = overview.data?.config?.defaultChatId ?? "";
    if (candidate) setChatId(candidate);
  }, [chatId, overview.data?.config?.defaultChatId]);

  useEffect(() => {
    if (publicHandle) return;
    const candidate = overview.data?.config?.defaultPublicHandle ?? "";
    if (candidate) setPublicHandle(candidate);
  }, [publicHandle, overview.data?.config?.defaultPublicHandle]);

  useEffect(() => {
    if (parseMode) return;
    const candidate = overview.data?.config?.defaultParseMode;
    if (candidate === "HTML" || candidate === "MarkdownV2") setParseMode(candidate);
  }, [parseMode, overview.data?.config?.defaultParseMode]);

  useEffect(() => {
    if (!disableLinkPreview && overview.data?.config?.defaultDisableLinkPreview === true) {
      setDisableLinkPreview(true);
    }
  }, [disableLinkPreview, overview.data?.config?.defaultDisableLinkPreview]);

  useEffect(() => {
    if (!disableNotification && overview.data?.config?.defaultDisableNotification === true) {
      setDisableNotification(true);
    }
  }, [disableNotification, overview.data?.config?.defaultDisableNotification]);

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
        title: "Draft loaded",
        body: `Loaded ${document.key} into the Telegram composer.`,
        tone: "success",
      });
    } catch (nextError) {
      pushToast({
        title: "Failed to load document",
        body: nextError instanceof Error ? nextError.message : String(nextError),
        tone: "error",
      });
    } finally {
      setBusyAction(null);
    }
  }

  async function upsertTelegramDraftDocument() {
    if (!issueId) throw new Error("Issue context is required");
    return await hostFetchJson<IssueDocument>(`/api/issues/${issueId}/documents/telegram-draft`, {
      method: "PUT",
      body: JSON.stringify({
        title: "Telegram Draft",
        format: "markdown",
        body: composerText,
        changeSummary: "Updated from Telegram issue tab",
      }),
    });
  }

  async function saveDraftOutput() {
    if (!issueId) return;
    if (!composerText.trim()) {
      pushToast({
        title: "Draft is empty",
        body: "Load a document or write the Telegram post before saving the draft output.",
        tone: "error",
      });
      return;
    }

    setBusyAction("save-draft");
    try {
      const draftDocument = await upsertTelegramDraftDocument();
      const basePayload = {
        type: "artifact",
        provider: "telegram",
        title: issue?.identifier
          ? `Telegram draft for ${issue.identifier}`
          : `Telegram draft for ${issue?.title ?? "issue"}`,
        status: "draft",
        reviewState: "needs_board_review",
        isPrimary: true,
        healthStatus: "unknown",
        summary: excerpt(composerText),
        metadata: {
          publication: {
            channel: "telegram",
            destinationLabel: destinationLabel || chatId || null,
            draftDocumentId: draftDocument.id,
            sourceDocumentKey: selectedDocumentKey || null,
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
        title: "Telegram draft saved",
        body: "Draft document and work product are now attached to the issue.",
        tone: "success",
      });
    } catch (nextError) {
      pushToast({
        title: "Failed to save Telegram draft",
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
        title: "Draft is empty",
        body: "Save or compose the Telegram draft before requesting approval.",
        tone: "error",
      });
      return;
    }

    setBusyAction("request-approval");
    try {
      const draftDocument = await upsertTelegramDraftDocument();
      const approval = await hostFetchJson<Approval>(`/api/companies/${companyId}/approvals`, {
        method: "POST",
        body: JSON.stringify({
          type: "publish_content",
          payload: {
            channel: "telegram",
            destinationLabel: destinationLabel || chatId || null,
            authorVoice: "telegram",
            sourceSummary: issue?.title ?? null,
            draftExcerpt: excerpt(composerText, 600),
            draftDocumentId: draftDocument.id,
          },
          issueIds: [issueId],
        }),
      });
      await refresh();
      pushToast({
        title: "Publish approval requested",
        body: `Approval ${approval.id} is ready for board review.`,
        tone: "success",
      });
    } catch (nextError) {
      pushToast({
        title: "Failed to request publish approval",
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
        title: "Publish approval required",
        body: "Approve the Telegram publish request before sending the message.",
        tone: "error",
      });
      return;
    }
    if (!composerText.trim()) {
      pushToast({
        title: "Draft is empty",
        body: "Write the Telegram post before publishing it.",
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
          ? `Telegram post for ${issue.identifier}`
          : `Telegram post for ${issue.title}`,
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

      await refresh();
      pushToast({
        title: "Telegram post published",
        body: publication.url
          ? "The issue now has a visible Telegram work product with a clickable post URL."
          : "The issue now has a Telegram work product. Set a public handle to expose clickable post URLs.",
        tone: "success",
      });
    } catch (nextError) {
      pushToast({
        title: "Failed to publish Telegram post",
        body: nextError instanceof Error ? nextError.message : String(nextError),
        tone: "error",
      });
    } finally {
      setBusyAction(null);
    }
  }

  if (!companyId || !issueId) {
    return <div style={mutedTextStyle}>Issue context is required.</div>;
  }

  if (loading && !issue) {
    return <div style={mutedTextStyle}>Loading Telegram issue workflow...</div>;
  }

  if (error) {
    return <div style={{ color: "var(--destructive, #c00)", fontSize: "12px" }}>{error}</div>;
  }

  return (
    <div style={layoutStack}>
      <div style={cardStyle}>
        <div style={{ ...rowStyle, justifyContent: "space-between" }}>
          <div style={{ display: "grid", gap: "8px" }}>
            <div style={sectionTitleStyle}>Telegram publish handoff</div>
            <div style={mutedTextStyle}>
              Keep the draft, approval, and final Telegram post attached to this issue instead of hiding the distribution workflow in comments.
            </div>
          </div>
          <div style={rowStyle}>
            {latestApprovedApproval ? <Pill label="Approved to publish" tone="success" /> : null}
            {latestPendingApproval ? <Pill label="Approval pending" tone="warn" /> : null}
            <a href={pluginPagePath(context.companyPrefix)} style={{ fontSize: "12px" }}>Open Telegram dashboard</a>
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gap: "16px", gridTemplateColumns: "minmax(0, 1.2fr) minmax(280px, 0.8fr)" }}>
        <div style={{ ...cardStyle, ...layoutStack }}>
          <div style={sectionTitleStyle}>Composer</div>
          <SettingsField
            label="Load issue document"
            hint="Use an existing issue document as the starting point, then adjust the final Telegram copy here."
          >
            <div style={rowStyle}>
              <select
                style={{ ...inputStyle, flex: 1 }}
                value={selectedDocumentKey}
                onChange={(event) => setSelectedDocumentKey(event.target.value)}
              >
                <option value="">Select document...</option>
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
                  {busyAction === "load-document" ? "Loading..." : "Load"}
              </button>
            </div>
          </SettingsField>

          <SettingsField
            label="Telegram draft"
            hint="This is the exact text that will be saved for review and later sent to Telegram."
          >
            <textarea
              style={textareaStyle}
              value={composerText}
              onChange={(event) => setComposerText(event.target.value)}
              placeholder="Write the final Telegram post here..."
            />
          </SettingsField>

          <div style={{ display: "grid", gap: "12px", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
            <SettingsField label="Destination label">
              <input
                style={inputStyle}
                value={destinationLabel}
                onChange={(event) => setDestinationLabel(event.target.value)}
                placeholder="@my_channel"
              />
            </SettingsField>
            <SettingsField label="Chat id / username">
              <input
                style={inputStyle}
                value={chatId}
                onChange={(event) => setChatId(event.target.value)}
                placeholder="@my_channel"
              />
            </SettingsField>
            <SettingsField label="Public handle">
              <input
                style={inputStyle}
                value={publicHandle}
                onChange={(event) => setPublicHandle(event.target.value)}
                placeholder="@my_channel"
              />
            </SettingsField>
            <SettingsField label="Parse mode">
              <select
                style={inputStyle}
                value={parseMode}
                onChange={(event) => setParseMode(event.target.value as "" | "HTML" | "MarkdownV2")}
              >
                <option value="">Plain text</option>
                <option value="HTML">HTML</option>
                <option value="MarkdownV2">MarkdownV2</option>
              </select>
            </SettingsField>
          </div>

          <div style={rowStyle}>
            <label style={rowStyle}>
              <input
                type="checkbox"
                checked={disableLinkPreview}
                onChange={(event) => setDisableLinkPreview(event.target.checked)}
              />
              <span style={{ fontSize: "12px" }}>Disable link preview</span>
            </label>
            <label style={rowStyle}>
              <input
                type="checkbox"
                checked={disableNotification}
                onChange={(event) => setDisableNotification(event.target.checked)}
              />
              <span style={{ fontSize: "12px" }}>Send silently</span>
            </label>
          </div>

          <div style={rowStyle}>
            <button
              type="button"
              style={buttonStyle}
              disabled={busyAction === "save-draft"}
              onClick={() => void saveDraftOutput()}
            >
              {busyAction === "save-draft" ? "Saving..." : "Save draft output"}
            </button>
            {latestPendingApproval ? (
              <a href={`/approvals/${latestPendingApproval.id}`} style={{ ...buttonStyle, textDecoration: "none" }}>
                Open pending approval
              </a>
            ) : (
              <button
                type="button"
                style={buttonStyle}
                disabled={busyAction === "request-approval"}
                onClick={() => void requestPublishApproval()}
              >
                {busyAction === "request-approval" ? "Requesting..." : "Request publish approval"}
              </button>
            )}
            <button
              type="button"
              style={primaryButtonStyle}
              disabled={busyAction === "publish-message" || !latestApprovedApproval}
              onClick={() => void publishApprovedMessage()}
            >
              {busyAction === "publish-message" ? "Publishing..." : "Publish approved message"}
            </button>
          </div>
        </div>

        <div style={{ ...cardStyle, ...layoutStack }}>
          <div style={sectionTitleStyle}>State</div>
          <div style={{ display: "grid", gap: "8px", fontSize: "12px" }}>
            <div>Issue: {issue?.identifier ?? issue?.title ?? "unknown"}</div>
            <div>Telegram work products: {telegramWorkProducts.length}</div>
            <div>Linked Telegram approvals: {telegramApprovals.length}</div>
            <div>Recent issue publishes: {issuePublications.data?.length ?? 0}</div>
          </div>

          {latestApprovedApproval ? (
            <div style={{ border: "1px solid var(--border)", borderRadius: "10px", padding: "12px" }}>
              <div style={{ fontSize: "12px", fontWeight: 600 }}>Latest approved publish</div>
              <div style={mutedTextStyle}>
                Approval {latestApprovedApproval.id} approved for {approvalDestinationLabel(latestApprovedApproval) ?? "Telegram"}.
              </div>
              <a href={`/approvals/${latestApprovedApproval.id}`} style={{ fontSize: "12px" }}>
                Open approval
              </a>
            </div>
          ) : (
            <div style={mutedTextStyle}>
              No approved Telegram publish approval is linked to this issue yet.
            </div>
          )}

          {telegramWorkProducts.length > 0 ? (
            <div style={{ display: "grid", gap: "8px" }}>
              <div style={{ fontSize: "12px", fontWeight: 600 }}>Existing Telegram outputs</div>
              {telegramWorkProducts.map((product) => (
                <div key={product.id} style={{ border: "1px solid var(--border)", borderRadius: "10px", padding: "10px" }}>
                  <div style={{ ...rowStyle, justifyContent: "space-between" }}>
                    <strong style={{ fontSize: "12px" }}>{product.title}</strong>
                    <Pill label={product.status} tone={product.status === "approved" ? "success" : product.status === "draft" ? "warn" : "neutral"} />
                  </div>
                  {product.summary ? <div style={mutedTextStyle}>{product.summary}</div> : null}
                  {product.url ? (
                    <a href={product.url} target="_blank" rel="noreferrer" style={{ fontSize: "12px" }}>
                      Open Telegram link
                    </a>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      <div style={cardStyle}>
        <div style={sectionTitleStyle}>Publication history for this issue</div>
        <div style={{ marginTop: "12px" }}>
          <PublicationList publications={issuePublications.data ?? []} />
        </div>
      </div>
    </div>
  );
}
