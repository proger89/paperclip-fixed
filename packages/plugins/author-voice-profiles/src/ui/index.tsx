import { useEffect, useMemo, useState, type CSSProperties } from "react";
import type { PluginPageProps, PluginSettingsPageProps } from "@paperclipai/plugin-sdk/ui";
import { usePluginToast } from "@paperclipai/plugin-sdk/ui";

type AuthorVoiceProfile = {
  id: string;
  destinationId: string;
  name: string;
  authorName: string | null;
  toneRules: string | null;
  samplePosts: string | null;
  bannedPhrases: string | null;
  ctaRules: string | null;
  enabled: boolean;
};

type SettingsRecord = {
  settingsJson?: {
    channelProfiles?: AuthorVoiceProfile[];
  } | null;
};

type Destination = {
  id: string;
  label: string;
};

type PublishingOverview = {
  publishChannels?: Destination[];
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
const textarea: CSSProperties = {
  ...input,
  minHeight: 90,
  resize: "vertical",
  lineHeight: 1.5,
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

function emptyProfile(index: number): AuthorVoiceProfile {
  return {
    id: `profile-${Date.now()}-${index}`,
    destinationId: "",
    name: "",
    authorName: "",
    toneRules: "",
    samplePosts: "",
    bannedPhrases: "",
    ctaRules: "",
    enabled: true,
  };
}

function normalizeProfiles(input: unknown): AuthorVoiceProfile[] {
  if (!Array.isArray(input)) return [];
  return input.flatMap((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const record = entry as Record<string, unknown>;
    return [{
      id: typeof record.id === "string" && record.id.trim() ? record.id.trim() : `profile-${index + 1}`,
      destinationId: typeof record.destinationId === "string" ? record.destinationId.trim() : "",
      name: typeof record.name === "string" ? record.name : "",
      authorName: typeof record.authorName === "string" ? record.authorName : "",
      toneRules: typeof record.toneRules === "string" ? record.toneRules : "",
      samplePosts: typeof record.samplePosts === "string" ? record.samplePosts : "",
      bannedPhrases: typeof record.bannedPhrases === "string" ? record.bannedPhrases : "",
      ctaRules: typeof record.ctaRules === "string" ? record.ctaRules : "",
      enabled: record.enabled !== false,
    }];
  });
}

function labelForDestination(destinations: Destination[], destinationId: string) {
  return destinations.find((entry) => entry.id === destinationId)?.label ?? destinationId;
}

function AuthorVoiceProfilesSurface({ companyId }: { companyId: string | null }) {
  const pushToast = usePluginToast();
  const [profiles, setProfiles] = useState<AuthorVoiceProfile[]>([]);
  const [destinations, setDestinations] = useState<Destination[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!companyId) {
      setLoading(false);
      setProfiles([]);
      setDestinations([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([
      api<SettingsRecord | null>(`/api/companies/${companyId}/plugins/paperclip.author-voice-profiles/settings`),
      api<PublishingOverview>(`/api/companies/${companyId}/telegram-publishing/overview`).catch(() => ({ publishChannels: [] })),
    ])
      .then(([settings, overview]) => {
        if (cancelled) return;
        setProfiles(normalizeProfiles(settings?.settingsJson?.channelProfiles));
        setDestinations(Array.isArray(overview.publishChannels) ? overview.publishChannels : []);
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

  const profileCount = profiles.filter((entry) => entry.enabled).length;
  const uncoveredDestinations = useMemo(
    () => destinations.filter((destination) => !profiles.some((profile) => profile.enabled && profile.destinationId === destination.id)),
    [destinations, profiles],
  );

  async function save() {
    if (!companyId) return;
    setSaving(true);
    try {
      await api(`/api/companies/${companyId}/plugins/paperclip.author-voice-profiles/settings`, {
        method: "POST",
        body: JSON.stringify({
          enabled: true,
          settingsJson: {
            channelProfiles: profiles.map((profile) => ({
              ...profile,
              name: profile.name.trim(),
              destinationId: profile.destinationId.trim(),
              authorName: profile.authorName?.trim() || null,
              toneRules: profile.toneRules?.trim() || null,
              samplePosts: profile.samplePosts?.trim() || null,
              bannedPhrases: profile.bannedPhrases?.trim() || null,
              ctaRules: profile.ctaRules?.trim() || null,
            })),
          },
        }),
      });
      pushToast({
        title: "Author voice profiles saved",
        body: "Telegram Publishing can now use these channel-specific style rules during GPT-5.4 rewrites.",
        tone: "success",
      });
    } catch (nextError) {
      pushToast({
        title: "Failed to save profiles",
        body: nextError instanceof Error ? nextError.message : String(nextError),
        tone: "error",
      });
    } finally {
      setSaving(false);
    }
  }

  if (!companyId) return <div style={muted}>Company context is required.</div>;
  if (loading) return <div style={muted}>Loading author voice profiles...</div>;
  if (error) return <div style={{ ...muted, color: "var(--destructive, #c00)" }}>{error}</div>;

  return (
    <div style={stack}>
      <div style={card}>
        <div style={{ fontSize: 14, fontWeight: 600 }}>Channel voice coverage</div>
        <div style={{ ...muted, marginTop: 8 }}>
          {profileCount} active profiles. {uncoveredDestinations.length} Telegram channels still have no author voice profile and will be blocked in the publishing queue.
        </div>
        {uncoveredDestinations.length > 0 ? (
          <div style={{ ...muted, marginTop: 10 }}>
            Missing: {uncoveredDestinations.map((destination) => destination.label).join(", ")}
          </div>
        ) : null}
      </div>

      <div style={card}>
        <div style={{ ...row, justifyContent: "space-between" }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600 }}>Profiles</div>
            <div style={{ ...muted, marginTop: 6 }}>
              One profile per publish channel. Telegram Publishing requires a matching profile before GPT-5.4 can prepare a post for approval.
            </div>
          </div>
          <button
            type="button"
            style={button}
            onClick={() => setProfiles((current) => [...current, emptyProfile(current.length)])}
          >
            Add profile
          </button>
        </div>

        <div style={{ ...stack, marginTop: 14 }}>
          {profiles.length === 0 ? (
            <div style={muted}>No profiles yet. Add one for each Telegram publish channel.</div>
          ) : (
            profiles.map((profile, index) => (
              <div key={profile.id} style={{ ...card, padding: 14 }}>
                <div style={{ ...row, justifyContent: "space-between" }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>
                    {profile.name.trim() || labelForDestination(destinations, profile.destinationId) || `Profile ${index + 1}`}
                  </div>
                  <button
                    type="button"
                    style={button}
                    onClick={() => setProfiles((current) => current.filter((entry) => entry.id !== profile.id))}
                  >
                    Remove
                  </button>
                </div>

                <div style={{ ...stack, marginTop: 12 }}>
                  <label style={stack}>
                    <span style={{ fontSize: 12 }}>Publish channel</span>
                    <select
                      style={input}
                      value={profile.destinationId}
                      onChange={(event) =>
                        setProfiles((current) => current.map((entry) => (
                          entry.id === profile.id
                            ? { ...entry, destinationId: event.target.value }
                            : entry
                        )))
                      }
                    >
                      <option value="">Select Telegram channel...</option>
                      {destinations.map((destination) => (
                        <option key={destination.id} value={destination.id}>
                          {destination.label}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label style={stack}>
                    <span style={{ fontSize: 12 }}>Profile name</span>
                    <input
                      style={input}
                      value={profile.name}
                      onChange={(event) =>
                        setProfiles((current) => current.map((entry) => (
                          entry.id === profile.id ? { ...entry, name: event.target.value } : entry
                        )))
                      }
                      placeholder="Founder voice"
                    />
                  </label>

                  <label style={stack}>
                    <span style={{ fontSize: 12 }}>Author / persona</span>
                    <input
                      style={input}
                      value={profile.authorName ?? ""}
                      onChange={(event) =>
                        setProfiles((current) => current.map((entry) => (
                          entry.id === profile.id ? { ...entry, authorName: event.target.value } : entry
                        )))
                      }
                      placeholder="Who the post should sound like"
                    />
                  </label>

                  <label style={stack}>
                    <span style={{ fontSize: 12 }}>Tone rules</span>
                    <textarea
                      style={textarea}
                      value={profile.toneRules ?? ""}
                      onChange={(event) =>
                        setProfiles((current) => current.map((entry) => (
                          entry.id === profile.id ? { ...entry, toneRules: event.target.value } : entry
                        )))
                      }
                      placeholder="Short, punchy, founder-like. Avoid bureaucratic tone."
                    />
                  </label>

                  <label style={stack}>
                    <span style={{ fontSize: 12 }}>Sample posts</span>
                    <textarea
                      style={textarea}
                      value={profile.samplePosts ?? ""}
                      onChange={(event) =>
                        setProfiles((current) => current.map((entry) => (
                          entry.id === profile.id ? { ...entry, samplePosts: event.target.value } : entry
                        )))
                      }
                      placeholder="Paste 2-5 strong examples to anchor GPT-5.4."
                    />
                  </label>

                  <label style={stack}>
                    <span style={{ fontSize: 12 }}>Banned phrases / stop patterns</span>
                    <textarea
                      style={textarea}
                      value={profile.bannedPhrases ?? ""}
                      onChange={(event) =>
                        setProfiles((current) => current.map((entry) => (
                          entry.id === profile.id ? { ...entry, bannedPhrases: event.target.value } : entry
                        )))
                      }
                      placeholder="Phrases the author never uses."
                    />
                  </label>

                  <label style={stack}>
                    <span style={{ fontSize: 12 }}>CTA / ending rules</span>
                    <textarea
                      style={textarea}
                      value={profile.ctaRules ?? ""}
                      onChange={(event) =>
                        setProfiles((current) => current.map((entry) => (
                          entry.id === profile.id ? { ...entry, ctaRules: event.target.value } : entry
                        )))
                      }
                      placeholder="Optional closing or CTA constraints."
                    />
                  </label>

                  <label style={{ ...row, fontSize: 12 }}>
                    <input
                      type="checkbox"
                      checked={profile.enabled}
                      onChange={(event) =>
                        setProfiles((current) => current.map((entry) => (
                          entry.id === profile.id ? { ...entry, enabled: event.target.checked } : entry
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
            {saving ? "Saving..." : "Save profiles"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function AuthorVoiceProfilesSettingsPage({ context }: PluginSettingsPageProps) {
  return <AuthorVoiceProfilesSurface companyId={context.companyId} />;
}

export function AuthorVoiceProfilesPage({ context }: PluginPageProps) {
  return <AuthorVoiceProfilesSurface companyId={context.companyId} />;
}
