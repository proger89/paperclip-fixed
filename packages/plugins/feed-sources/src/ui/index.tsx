import { useEffect, useState, type CSSProperties } from "react";
import type { PluginPageProps, PluginSettingsPageProps } from "@paperclipai/plugin-sdk/ui";
import { usePluginToast } from "@paperclipai/plugin-sdk/ui";

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

function FeedSourcesSurface({ companyId }: { companyId: string | null }) {
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
        title: "Feed sources saved",
        body: "The editorial source catalog was updated.",
        tone: "success",
      });
    } catch (nextError) {
      pushToast({
        title: "Failed to save feed sources",
        body: nextError instanceof Error ? nextError.message : String(nextError),
        tone: "error",
      });
    } finally {
      setSaving(false);
    }
  }

  if (!companyId) return <div style={muted}>Company context is required.</div>;
  if (loading) return <div style={muted}>Loading feed sources...</div>;
  if (error) return <div style={{ ...muted, color: "var(--destructive, #c00)" }}>{error}</div>;

  return (
    <div style={stack}>
      <div style={card}>
        <div style={{ fontSize: 14, fontWeight: 600 }}>Editorial source catalog</div>
        <div style={{ ...muted, marginTop: 8 }}>
          Keep this plugin simple: add RSS, Atom, or web feeds that should land in an editorial queue later. Telegram donor channels stay in Telegram Publishing.
        </div>
      </div>

      <div style={card}>
        <div style={{ ...row, justifyContent: "space-between" }}>
          <div style={{ fontSize: 14, fontWeight: 600 }}>Sources</div>
          <button type="button" style={button} onClick={() => setSources((current) => [...current, emptySource(current.length)])}>
            Add source
          </button>
        </div>

        <div style={{ ...stack, marginTop: 14 }}>
          {sources.length === 0 ? (
            <div style={muted}>No feed sources yet.</div>
          ) : (
            sources.map((source, index) => (
              <div key={source.id} style={{ ...card, padding: 14 }}>
                <div style={{ ...row, justifyContent: "space-between" }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{source.label.trim() || `Source ${index + 1}`}</div>
                  <button
                    type="button"
                    style={button}
                    onClick={() => setSources((current) => current.filter((entry) => entry.id !== source.id))}
                  >
                    Remove
                  </button>
                </div>
                <div style={{ ...stack, marginTop: 12 }}>
                  <label style={stack}>
                    <span style={{ fontSize: 12 }}>Label</span>
                    <input
                      style={input}
                      value={source.label}
                      onChange={(event) =>
                        setSources((current) => current.map((entry) => (
                          entry.id === source.id ? { ...entry, label: event.target.value } : entry
                        )))
                      }
                      placeholder="Founder's RSS"
                    />
                  </label>
                  <label style={stack}>
                    <span style={{ fontSize: 12 }}>Feed URL</span>
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
                    <span style={{ fontSize: 12 }}>Project ID (optional)</span>
                    <input
                      style={input}
                      value={source.projectId}
                      onChange={(event) =>
                        setSources((current) => current.map((entry) => (
                          entry.id === source.id ? { ...entry, projectId: event.target.value } : entry
                        )))
                      }
                      placeholder="Attach intake to a specific project"
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
                    Enabled
                  </label>
                </div>
              </div>
            ))
          )}
        </div>

        <div style={{ ...row, marginTop: 14, justifyContent: "flex-end" }}>
          <button type="button" style={primaryButton} disabled={saving} onClick={() => void save()}>
            {saving ? "Saving..." : "Save sources"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function FeedSourcesSettingsPage({ context }: PluginSettingsPageProps) {
  return <FeedSourcesSurface companyId={context.companyId} />;
}

export function FeedSourcesPage({ context }: PluginPageProps) {
  return <FeedSourcesSurface companyId={context.companyId} />;
}
