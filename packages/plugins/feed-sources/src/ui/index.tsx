import { useEffect, useState, type CSSProperties } from "react";
import type { PluginPageProps, PluginSettingsPageProps } from "@paperclipai/plugin-sdk/ui";
import { usePluginToast } from "@paperclipai/plugin-sdk/ui";

type Locale = "en" | "ru";

type FeedSource = {
  id: string;
  label: string;
  url: string;
  projectId: string;
  enabled: boolean;
};

type SettingsRecord = {
  settingsJson?: {
    sources?: FeedSource[];
  } | null;
};

const stack: CSSProperties = { display: "grid", gap: 16 };
const card: CSSProperties = {
  border: "1px solid var(--border)",
  borderRadius: 14,
  padding: 16,
  background: "var(--card, transparent)",
};
const row: CSSProperties = { display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" };
const input: CSSProperties = {
  width: "100%",
  border: "1px solid var(--border)",
  borderRadius: 10,
  background: "transparent",
  color: "inherit",
  padding: "9px 11px",
  fontSize: 12,
};
const button: CSSProperties = {
  appearance: "none",
  border: "1px solid var(--border)",
  borderRadius: 999,
  background: "transparent",
  color: "inherit",
  padding: "8px 14px",
  fontSize: 12,
  cursor: "pointer",
};
const primaryButton: CSSProperties = {
  ...button,
  background: "var(--foreground)",
  borderColor: "var(--foreground)",
  color: "var(--background)",
};
const muted: CSSProperties = { fontSize: 12, opacity: 0.72, lineHeight: 1.45 };

function tr(locale: Locale, en: string, ru: string) {
  return locale === "ru" ? ru : en;
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`;
    try {
      const payload = await response.json() as { error?: string };
      if (typeof payload.error === "string" && payload.error.trim()) {
        message = payload.error;
      }
    } catch {}
    throw new Error(message);
  }
  return response.json() as Promise<T>;
}

function normalizeSources(input: unknown): FeedSource[] {
  if (!Array.isArray(input)) return [];
  return input.flatMap((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const record = entry as Record<string, unknown>;
    return [{
      id: typeof record.id === "string" && record.id.trim() ? record.id.trim() : `feed-${index + 1}`,
      label: typeof record.label === "string" ? record.label : "",
      url: typeof record.url === "string" ? record.url : "",
      projectId: typeof record.projectId === "string" ? record.projectId : "",
      enabled: record.enabled !== false,
    }];
  });
}

function emptySource(index: number): FeedSource {
  return {
    id: `feed-${Date.now()}-${index}`,
    label: "",
    url: "",
    projectId: "",
    enabled: true,
  };
}

function FeedSourcesSurface({ companyId, locale }: { companyId: string | null; locale: Locale }) {
  const pushToast = usePluginToast();
  const [sources, setSources] = useState<FeedSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!companyId) {
      setLoading(false);
      setSources([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    api<SettingsRecord | null>(`/api/companies/${companyId}/plugins/paperclip.feed-sources/settings`)
      .then((settings) => {
        if (cancelled) return;
        setSources(normalizeSources(settings?.settingsJson?.sources));
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

  async function save() {
    if (!companyId) return;
    setSaving(true);
    try {
      await api(`/api/companies/${companyId}/plugins/paperclip.feed-sources/settings`, {
        method: "POST",
        body: JSON.stringify({
          enabled: true,
          settingsJson: {
            sources: sources.map((source) => ({
              ...source,
              label: source.label.trim(),
              url: source.url.trim(),
              projectId: source.projectId.trim(),
            })),
          },
        }),
      });
      pushToast({
        title: tr(locale, "Feed sources saved", "Источники сохранены"),
        body: tr(locale, "The editorial source catalog was updated.", "Каталог editorial-источников обновлен."),
        tone: "success",
      });
    } catch (nextError) {
      pushToast({
        title: tr(locale, "Failed to save feed sources", "Не удалось сохранить источники"),
        body: nextError instanceof Error ? nextError.message : String(nextError),
        tone: "error",
      });
    } finally {
      setSaving(false);
    }
  }

  if (!companyId) return <div style={muted}>{tr(locale, "Company context is required.", "Нужен контекст компании.")}</div>;
  if (loading) return <div style={muted}>{tr(locale, "Loading feed sources...", "Загружаем источники...")}</div>;
  if (error) return <div style={{ ...muted, color: "var(--destructive, #c00)" }}>{error}</div>;

  return (
    <div style={stack}>
      <div style={card}>
        <div style={{ fontSize: 14, fontWeight: 600 }}>{tr(locale, "Editorial source catalog", "Каталог источников")}</div>
        <div style={{ ...muted, marginTop: 8 }}>
          {tr(
            locale,
            "Keep this plugin simple: add RSS, Atom, or web feeds that should land in an editorial queue later. Telegram donor channels stay in Telegram Publishing.",
            "Здесь только простая настройка RSS, Atom и web-источников, которые потом попадут в editorial queue. Telegram donor channels остаются внутри Telegram Publishing.",
          )}
        </div>
      </div>

      <div style={card}>
        <div style={{ ...row, justifyContent: "space-between" }}>
          <div style={{ fontSize: 14, fontWeight: 600 }}>{tr(locale, "Sources", "Источники")}</div>
          <button type="button" style={button} onClick={() => setSources((current) => [...current, emptySource(current.length)])}>
            {tr(locale, "Add source", "Добавить источник")}
          </button>
        </div>

        <div style={{ ...stack, marginTop: 14 }}>
          {sources.length === 0 ? (
            <div style={muted}>{tr(locale, "No feed sources yet.", "Источников пока нет.")}</div>
          ) : (
            sources.map((source, index) => (
              <div key={source.id} style={{ ...card, padding: 14 }}>
                <div style={{ ...row, justifyContent: "space-between" }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{source.label.trim() || tr(locale, `Source ${index + 1}`, `Источник ${index + 1}`)}</div>
                  <button
                    type="button"
                    style={button}
                    onClick={() => setSources((current) => current.filter((entry) => entry.id !== source.id))}
                  >
                    {tr(locale, "Remove", "Удалить")}
                  </button>
                </div>
                <div style={{ ...stack, marginTop: 12 }}>
                  <label style={stack}>
                    <span style={{ fontSize: 12 }}>{tr(locale, "Label", "Название")}</span>
                    <input
                      style={input}
                      value={source.label}
                      onChange={(event) =>
                        setSources((current) => current.map((entry) => (
                          entry.id === source.id ? { ...entry, label: event.target.value } : entry
                        )))
                      }
                      placeholder={tr(locale, "Founder's RSS", "RSS автора")}
                    />
                  </label>
                  <label style={stack}>
                    <span style={{ fontSize: 12 }}>{tr(locale, "Feed URL", "Ссылка на ленту")}</span>
                    <input
                      style={input}
                      value={source.url}
                      onChange={(event) =>
                        setSources((current) => current.map((entry) => (
                          entry.id === source.id ? { ...entry, url: event.target.value } : entry
                        )))
                      }
                      placeholder="https://example.com/feed.xml"
                    />
                  </label>
                  <label style={stack}>
                    <span style={{ fontSize: 12 }}>{tr(locale, "Project ID (optional)", "Project ID (необязательно)")}</span>
                    <input
                      style={input}
                      value={source.projectId}
                      onChange={(event) =>
                        setSources((current) => current.map((entry) => (
                          entry.id === source.id ? { ...entry, projectId: event.target.value } : entry
                        )))
                      }
                      placeholder={tr(locale, "Attach intake to a specific project", "Привязать intake к конкретному проекту")}
                    />
                  </label>
                  <label style={{ ...row, fontSize: 12 }}>
                    <input
                      type="checkbox"
                      checked={source.enabled}
                      onChange={(event) =>
                        setSources((current) => current.map((entry) => (
                          entry.id === source.id ? { ...entry, enabled: event.target.checked } : entry
                        )))
                      }
                    />
                    {tr(locale, "Enabled", "Включено")}
                  </label>
                </div>
              </div>
            ))
          )}
        </div>

        <div style={{ ...row, marginTop: 14, justifyContent: "flex-end" }}>
          <button type="button" style={primaryButton} disabled={saving} onClick={() => void save()}>
            {saving ? tr(locale, "Saving...", "Сохраняем...") : tr(locale, "Save sources", "Сохранить источники")}
          </button>
        </div>
      </div>
    </div>
  );
}

export function FeedSourcesSettingsPage({ context }: PluginSettingsPageProps) {
  return <FeedSourcesSurface companyId={context.companyId} locale={context.locale} />;
}

export function FeedSourcesPage({ context }: PluginPageProps) {
  return <FeedSourcesSurface companyId={context.companyId} locale={context.locale} />;
}
