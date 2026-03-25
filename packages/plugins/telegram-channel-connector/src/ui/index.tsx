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

function PublicationJobList({ jobs }: { jobs: TelegramPublicationJob[] }) {
  if (jobs.length === 0) {
    return <div style={mutedTextStyle}>No scheduled Telegram publications queued.</div>;
  }

  return (
    <div style={{ display: "grid", gap: "10px" }}>
      {jobs.map((job) => (
        <div key={job.id ?? `${job.issueId}:${job.destinationId}:${job.publishAt}`} style={{ ...cardStyle, padding: "12px" }}>
          <div style={{ ...rowStyle, justifyContent: "space-between" }}>
            <strong>{job.destinationId}</strong>
            <span style={mutedTextStyle}>{formatTimestamp(job.publishAt)}</span>
          </div>
          <div style={rowStyle}>
            <Pill label={job.status} tone={job.status === "failed" ? "warn" : job.status === "published" ? "success" : "neutral"} />
            <Pill label={job.issueId} />
            {job.approvalId ? <Pill label="approved" tone="success" /> : <Pill label="approval missing" tone="warn" />}
          </div>
          {job.failureReason ? <div style={mutedTextStyle}>{job.failureReason}</div> : null}
          {job.publishedUrl ? (
            <a href={job.publishedUrl} target="_blank" rel="noreferrer" style={{ fontSize: "12px" }}>
              Open Telegram post
            </a>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function SourceMessageList({ stories }: { stories: TelegramSourceMessageRecord[] }) {
  if (stories.length === 0) {
    return <div style={mutedTextStyle}>No Telegram source stories ingested yet.</div>;
  }

  return (
    <div style={{ display: "grid", gap: "10px" }}>
      {stories.map((story) => (
        <div key={`${story.sourceId}:${story.chatId}:${story.messageId}`} style={{ ...cardStyle, padding: "12px" }}>
          <div style={{ ...rowStyle, justifyContent: "space-between" }}>
            <strong>{story.sourceId}</strong>
            <span style={mutedTextStyle}>{formatTimestamp(story.messageDate ?? story.linkedAt)}</span>
          </div>
          <div style={mutedTextStyle}>{story.excerpt ?? "No excerpt captured."}</div>
          <div style={rowStyle}>
            <Pill label={`chat ${story.chatId}`} />
            <Pill label={`message ${story.messageId}`} />
            {story.issueId ? <Pill label={story.issueId} tone="success" /> : null}
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

          <div style={{ ...sectionTitleStyle, marginTop: "6px" }}>Destinations</div>
          <div style={mutedTextStyle}>
            Manage multiple Telegram publishing targets. The selected default destination also drives the legacy default fields above for backward compatibility.
          </div>
          <div style={rowStyle}>
            <button type="button" style={buttonStyle} onClick={addDestination}>
              Add destination
            </button>
            <span style={mutedTextStyle}>Configured: {settingsJson.publishing.destinations.length}</span>
          </div>
          {settingsJson.publishing.destinations.length > 0 ? (
            <div style={{ display: "grid", gap: "10px" }}>
              {settingsJson.publishing.destinations.map((destination, index) => (
                <div key={destination.id} style={{ border: "1px solid var(--border)", borderRadius: "12px", padding: "12px", display: "grid", gap: "10px" }}>
                  <div style={{ ...rowStyle, justifyContent: "space-between" }}>
                    <strong style={{ fontSize: "12px" }}>{destination.label || `Destination ${index + 1}`}</strong>
                    <div style={rowStyle}>
                      {destination.enabled ? <Pill label="enabled" tone="success" /> : <Pill label="disabled" tone="warn" />}
                      {settingsJson.publishing.defaultDestinationId === destination.id ? <Pill label="default" /> : null}
                    </div>
                  </div>
                  <div style={{ display: "grid", gap: "10px", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" }}>
                    <SettingsField label="Label">
                      <input
                        style={inputStyle}
                        value={destination.label}
                        onChange={(event) => updateDestination(destination.id, { label: event.target.value })}
                      />
                    </SettingsField>
                    <SettingsField label="Chat id / username">
                      <input
                        style={inputStyle}
                        value={destination.chatId}
                        onChange={(event) => updateDestination(destination.id, { chatId: event.target.value })}
                        placeholder="@my_channel"
                      />
                    </SettingsField>
                    <SettingsField label="Public handle">
                      <input
                        style={inputStyle}
                        value={destination.publicHandle}
                        onChange={(event) => updateDestination(destination.id, { publicHandle: event.target.value })}
                        placeholder="@my_channel"
                      />
                    </SettingsField>
                    <SettingsField label="Parse mode">
                      <select
                        style={inputStyle}
                        value={destination.parseMode}
                        onChange={(event) => updateDestination(destination.id, { parseMode: event.target.value as TelegramDestination["parseMode"] })}
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
                        checked={destination.enabled}
                        onChange={(event) => updateDestination(destination.id, { enabled: event.target.checked })}
                      />
                      <span style={{ fontSize: "12px" }}>Enabled</span>
                    </label>
                    <label style={rowStyle}>
                      <input
                        type="checkbox"
                        checked={settingsJson.publishing.defaultDestinationId === destination.id}
                        onChange={(event) => {
                          if (event.target.checked) updateDestination(destination.id, { isDefault: true });
                        }}
                      />
                      <span style={{ fontSize: "12px" }}>Default destination</span>
                    </label>
                    <label style={rowStyle}>
                      <input
                        type="checkbox"
                        checked={destination.disableLinkPreview}
                        onChange={(event) => updateDestination(destination.id, { disableLinkPreview: event.target.checked })}
                      />
                      <span style={{ fontSize: "12px" }}>Disable link preview</span>
                    </label>
                    <label style={rowStyle}>
                      <input
                        type="checkbox"
                        checked={destination.disableNotification}
                        onChange={(event) => updateDestination(destination.id, { disableNotification: event.target.checked })}
                      />
                      <span style={{ fontSize: "12px" }}>Send silently</span>
                    </label>
                    <button type="button" style={buttonStyle} onClick={() => removeDestination(destination.id)}>
                      Remove
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div style={mutedTextStyle}>No multi-channel destinations configured yet. The connector will fall back to the default fields above.</div>
          )}

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

          <div style={{ ...sectionTitleStyle, marginTop: "6px" }}>Ingestion Sources</div>
          <div style={mutedTextStyle}>
            Sources create editorial issues through routines when Telegram sends channel posts or discussion replies to this bot.
          </div>
          <div style={rowStyle}>
            <button type="button" style={buttonStyle} onClick={addSource}>
              Add source
            </button>
            <span style={mutedTextStyle}>Configured: {settingsJson.ingestion.sources.length}</span>
          </div>
          {settingsJson.ingestion.sources.length > 0 ? (
            <div style={{ display: "grid", gap: "10px" }}>
              {settingsJson.ingestion.sources.map((source, index) => (
                <div key={source.id} style={{ border: "1px solid var(--border)", borderRadius: "12px", padding: "12px", display: "grid", gap: "10px" }}>
                  <div style={{ ...rowStyle, justifyContent: "space-between" }}>
                    <strong style={{ fontSize: "12px" }}>{source.label || `Source ${index + 1}`}</strong>
                    {source.enabled ? <Pill label="enabled" tone="success" /> : <Pill label="disabled" tone="warn" />}
                  </div>
                  <div style={{ display: "grid", gap: "10px", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" }}>
                    <SettingsField label="Label">
                      <input style={inputStyle} value={source.label} onChange={(event) => updateSource(source.id, { label: event.target.value })} />
                    </SettingsField>
                    <SettingsField label="Channel / chat id">
                      <input style={inputStyle} value={source.chatId} onChange={(event) => updateSource(source.id, { chatId: event.target.value })} placeholder="-100123..." />
                    </SettingsField>
                    <SettingsField label="Public handle">
                      <input style={inputStyle} value={source.publicHandle} onChange={(event) => updateSource(source.id, { publicHandle: event.target.value })} placeholder="@my_channel" />
                    </SettingsField>
                    <SettingsField label="Discussion chat id">
                      <input style={inputStyle} value={source.discussionChatId} onChange={(event) => updateSource(source.id, { discussionChatId: event.target.value })} placeholder="-100discussion..." />
                    </SettingsField>
                    <SettingsField label="Mode">
                      <select style={inputStyle} value={source.mode} onChange={(event) => updateSource(source.id, { mode: event.target.value as TelegramIngestionSource["mode"] })}>
                        <option value="channel_posts">Channel posts</option>
                        <option value="discussion_replies">Discussion replies</option>
                        <option value="both">Both</option>
                      </select>
                    </SettingsField>
                    <SettingsField label="Project id">
                      <input style={inputStyle} value={source.projectId} onChange={(event) => updateSource(source.id, { projectId: event.target.value })} />
                    </SettingsField>
                    <SettingsField label="Assignee agent id">
                      <input style={inputStyle} value={source.assigneeAgentId} onChange={(event) => updateSource(source.id, { assigneeAgentId: event.target.value })} />
                    </SettingsField>
                    <SettingsField label="Routine id">
                      <input style={inputStyle} value={source.routineId} onChange={(event) => updateSource(source.id, { routineId: event.target.value })} placeholder="Optional existing routine" />
                    </SettingsField>
                    <SettingsField label="Issue template key">
                      <input style={inputStyle} value={source.issueTemplateKey} onChange={(event) => updateSource(source.id, { issueTemplateKey: event.target.value })} placeholder="Optional template key" />
                    </SettingsField>
                  </div>
                  <div style={rowStyle}>
                    <label style={rowStyle}>
                      <input type="checkbox" checked={source.enabled} onChange={(event) => updateSource(source.id, { enabled: event.target.checked })} />
                      <span style={{ fontSize: "12px" }}>Enabled</span>
                    </label>
                    <button type="button" style={buttonStyle} onClick={() => removeSource(source.id)}>
                      Remove
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div style={mutedTextStyle}>No Telegram ingestion sources configured yet.</div>
          )}

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
            <div>Last ingestion: {formatTimestamp(overview.data?.botHealth?.lastIngestionAt)}</div>
            <div>Last publish dispatch: {formatTimestamp(overview.data?.botHealth?.lastPublishDispatchAt)}</div>
            <div>Blocked tasks: {overview.data?.blockedTaskCount ?? 0}</div>
            <div>Open tasks: {overview.data?.openTaskCount ?? 0}</div>
            <div>Open approvals: {overview.data?.botHealth?.openApprovalCount ?? 0}</div>
            <div>Revision approvals: {overview.data?.botHealth?.revisionApprovalCount ?? 0}</div>
            <div>Pending join requests: {overview.data?.botHealth?.openJoinRequestCount ?? 0}</div>
            <div>Open budget incidents: {overview.data?.botHealth?.openBudgetIncidentCount ?? 0}</div>
            <div>Scheduled publishes: {overview.data?.scheduledPublishCount ?? 0}</div>
            <div>Failed publishes: {overview.data?.failedPublishCount ?? 0}</div>
            <div>Ingested stories: {overview.data?.ingestedStoryCount ?? 0}</div>
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
        <div>Destinations: {overview.data?.destinations.length ?? 0}</div>
        <div>Sources: {overview.data?.sources.length ?? 0}</div>
        <div>Linked chats: {overview.data?.linkedChats.filter((chat) => !chat.revokedAt).length ?? 0}</div>
        <div>Blocked tasks: {overview.data?.blockedTaskCount ?? 0}</div>
        <div>Board approvals: {overview.data?.actionableApprovalCount ?? 0}</div>
        <div>Pending joins: {overview.data?.pendingJoinRequestCount ?? 0}</div>
        <div>Open budget incidents: {overview.data?.openBudgetIncidentCount ?? 0}</div>
        <div>Recent publishes: {overview.data?.recentPublications.length ?? 0}</div>
        <div>Scheduled queue: {overview.data?.scheduledPublishCount ?? 0}</div>
        <div>Ingested stories: {overview.data?.ingestedStoryCount ?? 0}</div>
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
            <div style={{ fontSize: "12px" }}>Destinations: {overview.data?.destinations.length ?? 0}</div>
            <div style={{ fontSize: "12px" }}>Sources: {overview.data?.sources.length ?? 0}</div>
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
            <div style={{ fontSize: "12px" }}>Last ingestion: {formatTimestamp(overview.data?.botHealth?.lastIngestionAt)}</div>
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
            <div style={{ fontSize: "12px" }}>Scheduled publishes: {overview.data?.scheduledPublishCount ?? 0}</div>
            <div style={{ fontSize: "12px" }}>Failed publishes: {overview.data?.failedPublishCount ?? 0}</div>
            <div style={{ fontSize: "12px" }}>Ingested stories: {overview.data?.ingestedStoryCount ?? 0}</div>
            <div style={{ fontSize: "12px" }}>Last publish dispatch: {formatTimestamp(overview.data?.botHealth?.lastPublishDispatchAt)}</div>
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

      <div style={cardStyle}>
        <div style={sectionTitleStyle}>Scheduled queue</div>
        <div style={{ marginTop: "12px" }}>
          <PublicationJobList jobs={overview.data?.scheduledPublications ?? []} />
        </div>
      </div>

      <div style={cardStyle}>
        <div style={sectionTitleStyle}>Recent ingested stories</div>
        <div style={{ marginTop: "12px" }}>
          <SourceMessageList stories={overview.data?.recentIngestedStories ?? []} />
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

  function getSelectedSourceDocumentId() {
    return documentOptions.find((entry) => entry.key === selectedDocumentKey)?.id ?? null;
  }

  async function upsertTelegramDraftDocument() {
    if (!issueId) throw new Error("Issue context is required");
    const [draftDocument, finalDocument] = await Promise.all([
      hostFetchJson<IssueDocument>(`/api/issues/${issueId}/documents/telegram-draft`, {
        method: "PUT",
        body: JSON.stringify({
          title: "Telegram Draft",
          format: "markdown",
          body: composerText,
          changeSummary: "Updated from Telegram issue tab",
        }),
      }),
      hostFetchJson<IssueDocument>(`/api/issues/${issueId}/documents/telegram-final-copy`, {
        method: "PUT",
        body: JSON.stringify({
          title: "Telegram Final Copy",
          format: "markdown",
          body: composerText,
          changeSummary: "Synced final copy from Telegram issue tab",
        }),
      }),
    ]);
    return { draftDocument, finalDocument };
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
      const { draftDocument, finalDocument } = await upsertTelegramDraftDocument();
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

  async function schedulePublication() {
    if (!companyId || !issueId) return;
    if (!latestApprovedApproval) {
      pushToast({
        title: "Publish approval required",
        body: "Approve the Telegram publish request before scheduling the delivery queue.",
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
        title: activePublicationJob ? "Telegram publish rescheduled" : "Telegram publish scheduled",
        body: `Queue item ${String((response as { id?: string }).id ?? "updated")} is ready.`,
        tone: "success",
      });
    } catch (nextError) {
      pushToast({
        title: activePublicationJob ? "Failed to reschedule Telegram publish" : "Failed to schedule Telegram publish",
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
        title: "Telegram publish cancelled",
        body: "The scheduled queue item was cancelled.",
        tone: "success",
      });
    } catch (nextError) {
      pushToast({
        title: "Failed to cancel Telegram publish",
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
            <SettingsField label="Configured destination">
              <select
                style={inputStyle}
                value={destinationId}
                onChange={(event) => setDestinationId(event.target.value)}
              >
                <option value="">Use default destination</option>
                {destinationOptions.map((destination) => (
                  <option key={destination.id} value={destination.id}>
                    {destination.label} {destination.enabled ? "" : "(disabled)"}
                  </option>
                ))}
              </select>
            </SettingsField>
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
            <SettingsField label="Publish at">
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
              style={buttonStyle}
              disabled={busyAction === "schedule-publication" || busyAction === "reschedule-publication" || !latestApprovedApproval}
              onClick={() => void schedulePublication()}
            >
              {busyAction === "schedule-publication"
                ? "Scheduling..."
                : busyAction === "reschedule-publication"
                  ? "Rescheduling..."
                  : activePublicationJob
                    ? "Reschedule publish"
                    : "Schedule publish"}
            </button>
            {activePublicationJob ? (
              <button
                type="button"
                style={buttonStyle}
                disabled={busyAction === "cancel-publication"}
                onClick={() => void cancelScheduledPublication()}
              >
                {busyAction === "cancel-publication" ? "Cancelling..." : "Cancel scheduled publish"}
              </button>
            ) : null}
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
            <div>Queued publish jobs: {(issuePublicationJobs.data ?? []).filter((job) => ["pending", "scheduled", "sending"].includes(job.status)).length}</div>
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

          {activePublicationJob ? (
            <div style={{ border: "1px solid var(--border)", borderRadius: "10px", padding: "12px", display: "grid", gap: "6px" }}>
              <div style={{ fontSize: "12px", fontWeight: 600 }}>Active queue item</div>
              <div style={mutedTextStyle}>
                {activePublicationJob.status} for {activePublicationJob.destinationId} at {formatTimestamp(activePublicationJob.publishAt)}
              </div>
              {activePublicationJob.failureReason ? <div style={mutedTextStyle}>{activePublicationJob.failureReason}</div> : null}
            </div>
          ) : null}
        </div>
      </div>

      <div style={cardStyle}>
        <div style={sectionTitleStyle}>Scheduled queue for this issue</div>
        <div style={{ marginTop: "12px" }}>
          <PublicationJobList jobs={issuePublicationJobs.data ?? []} />
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
