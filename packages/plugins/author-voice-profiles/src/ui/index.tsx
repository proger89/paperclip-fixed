import { useEffect, useState, type CSSProperties } from "react";
import type { PluginPageProps, PluginSettingsPageProps } from "@paperclipai/plugin-sdk/ui";
import { usePluginToast } from "@paperclipai/plugin-sdk/ui";

type Locale = "en" | "ru";

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

const styles: Record<string, CSSProperties> = {
  page: { display: "grid", gap: 16 },
  card: {
    border: "1px solid var(--border)",
    borderRadius: 18,
    padding: 18,
    background: "var(--card, transparent)",
    display: "grid",
    gap: 14,
  },
  split: {
    display: "grid",
    gap: 16,
    gridTemplateColumns: "minmax(260px, 320px) minmax(0, 1fr)",
    alignItems: "start",
  },
  sidebar: {
    border: "1px solid var(--border)",
    borderRadius: 16,
    overflow: "hidden",
    display: "grid",
    alignSelf: "stretch",
  },
  sidebarRow: {
    border: "none",
    borderBottom: "1px solid var(--border)",
    background: "transparent",
    color: "inherit",
    textAlign: "left",
    padding: "14px 16px",
    cursor: "pointer",
    display: "grid",
    gap: 6,
  },
  row: { display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" },
  grid2: { display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" },
  label: { fontSize: 12, fontWeight: 600, opacity: 0.82 },
  muted: { fontSize: 12, opacity: 0.72, lineHeight: 1.5 },
  input: {
    width: "100%",
    border: "1px solid var(--border)",
    borderRadius: 12,
    background: "transparent",
    color: "inherit",
    padding: "10px 12px",
    fontSize: 13,
  },
  textarea: {
    width: "100%",
    border: "1px solid var(--border)",
    borderRadius: 12,
    background: "transparent",
    color: "inherit",
    padding: "10px 12px",
    fontSize: 13,
    minHeight: 110,
    resize: "vertical",
    lineHeight: 1.5,
  },
  button: {
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
  },
  primaryButton: {
    appearance: "none",
    border: "1px solid var(--foreground)",
    borderRadius: 999,
    background: "var(--foreground)",
    color: "var(--background)",
    padding: "9px 15px",
    fontSize: 12,
    cursor: "pointer",
    textDecoration: "none",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
  },
};

function tr(locale: Locale, en: string, ru: string) {
  return locale === "ru" ? ru : en;
}

function localeFrom(value: string | null | undefined): Locale {
  return value === "ru" ? "ru" : "en";
}

function publishingHref(companyPrefix?: string | null) {
  return companyPrefix ? `/${companyPrefix}/telegram` : "#";
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

function createProfile(destinationId: string, destinationLabel: string): AuthorVoiceProfile {
  return {
    id: `profile-${destinationId || Date.now()}`,
    destinationId,
    name: destinationLabel ? `${destinationLabel} style` : "",
    authorName: "",
    toneRules: "",
    samplePosts: "",
    bannedPhrases: "",
    ctaRules: "",
    enabled: true,
  };
}

function updateProfile(
  profiles: AuthorVoiceProfile[],
  profileId: string,
  patch: Partial<AuthorVoiceProfile>,
) {
  return profiles.map((entry) => (entry.id === profileId ? { ...entry, ...patch } : entry));
}

function profileForDestination(profiles: AuthorVoiceProfile[], destinationId: string) {
  return profiles.find((entry) => entry.destinationId === destinationId);
}

function statusLabel(locale: Locale, hasProfile: boolean) {
  return hasProfile
    ? tr(locale, "Profile is ready", "Профиль готов")
    : tr(locale, "Profile is missing", "Профиль не настроен");
}

function AuthorVoiceProfilesSurface({
  companyId,
  companyPrefix,
  locale,
}: {
  companyId: string | null;
  companyPrefix: string | null;
  locale: Locale;
}) {
  const pushToast = usePluginToast();
  const [profiles, setProfiles] = useState<AuthorVoiceProfile[]>([]);
  const [destinations, setDestinations] = useState<Destination[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedDestinationId, setSelectedDestinationId] = useState<string | null>(null);

  useEffect(() => {
    if (!companyId) {
      setLoading(false);
      setProfiles([]);
      setDestinations([]);
      setSelectedDestinationId(null);
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
        const nextProfiles = normalizeProfiles(settings?.settingsJson?.channelProfiles);
        const nextDestinations = Array.isArray(overview.publishChannels) ? overview.publishChannels : [];
        setProfiles(nextProfiles);
        setDestinations(nextDestinations);
        setSelectedDestinationId((current) => {
          if (current && nextDestinations.some((entry) => entry.id === current)) {
            return current;
          }
          return nextDestinations[0]?.id ?? null;
        });
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

  const selectedDestination = destinations.find((entry) => entry.id === selectedDestinationId) ?? destinations[0] ?? null;
  const selectedProfile = selectedDestination ? profileForDestination(profiles, selectedDestination.id) ?? null : null;
  const coveredCount = destinations.filter((destination) => profileForDestination(profiles, destination.id)?.enabled).length;

  async function save() {
    if (!companyId) return;
    setSaving(true);
    try {
      await api(`/api/companies/${companyId}/plugins/paperclip.author-voice-profiles/settings`, {
        method: "POST",
        body: JSON.stringify({
          enabled: true,
          settingsJson: {
            channelProfiles: profiles
              .filter((profile) => profile.destinationId.trim())
              .map((profile) => ({
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
        title: tr(locale, "Profiles saved", "Профили сохранены"),
        body: tr(
          locale,
          "Telegram Publishing can now use these channel style rules.",
          "Публикации в Telegram теперь могут использовать эти правила стиля по каналам.",
        ),
        tone: "success",
      });
    } catch (nextError) {
      pushToast({
        title: tr(locale, "Failed to save profiles", "Не удалось сохранить профили"),
        body: nextError instanceof Error ? nextError.message : String(nextError),
        tone: "error",
      });
    } finally {
      setSaving(false);
    }
  }

  function createSelectedProfile() {
    if (!selectedDestination) return;
    const existing = profileForDestination(profiles, selectedDestination.id);
    if (existing) return;
    setProfiles((current) => [...current, createProfile(selectedDestination.id, selectedDestination.label)]);
  }

  if (!companyId) {
    return <div style={styles.muted}>{tr(locale, "Company context is required.", "Нужен контекст компании.")}</div>;
  }

  if (loading) {
    return <div style={styles.muted}>{tr(locale, "Loading voice profiles...", "Загружаем профили стиля...")}</div>;
  }

  if (error) {
    return <div style={{ ...styles.muted, color: "var(--destructive, #c00)" }}>{error}</div>;
  }

  if (destinations.length === 0) {
    return (
      <div style={styles.page}>
        <div style={styles.card}>
          <div style={{ fontSize: 18, fontWeight: 700 }}>
            {tr(locale, "Author voice profiles", "Профили авторского стиля")}
          </div>
          <div style={styles.muted}>
            {tr(
              locale,
              "First add at least one destination channel in Telegram Publishing. Then you will be able to set the writing style for each channel.",
              "Сначала добавь хотя бы один канал назначения в «Публикации в Telegram». После этого здесь можно будет настроить стиль для каждого канала.",
            )}
          </div>
          <div style={styles.row}>
            <a href={publishingHref(companyPrefix)} style={styles.primaryButton}>
              {tr(locale, "Open Telegram Publishing", "Открыть публикации в Telegram")}
            </a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <div style={{ fontSize: 18, fontWeight: 700 }}>
          {tr(locale, "Author voice profiles", "Профили авторского стиля")}
        </div>
        <div style={styles.muted}>
          {tr(
            locale,
            "Assign one style profile to each destination channel. Without a profile, Telegram Publishing will block AI preparation for that channel.",
            "Назначь один профиль стиля на каждый канал назначения. Без профиля «Публикации в Telegram» будут блокировать ИИ-подготовку для этого канала.",
          )}
        </div>
        <div style={styles.row}>
          <span style={styles.button}>
            {tr(locale, `${coveredCount}/${destinations.length} channels covered`, `${coveredCount}/${destinations.length} каналов настроено`)}
          </span>
          <a href={publishingHref(companyPrefix)} style={styles.button}>
            {tr(locale, "Open Telegram Publishing", "Открыть публикации в Telegram")}
          </a>
        </div>
      </div>

      <div style={styles.split}>
        <div style={styles.sidebar}>
          {destinations.map((destination, index) => {
            const profile = profileForDestination(profiles, destination.id);
            const active = destination.id === selectedDestination?.id;
            return (
              <button
                key={destination.id}
                type="button"
                style={{
                  ...styles.sidebarRow,
                  background: active ? "var(--accent, rgba(255,255,255,0.06))" : "transparent",
                  borderBottom: index === destinations.length - 1 ? "none" : "1px solid var(--border)",
                }}
                onClick={() => setSelectedDestinationId(destination.id)}
              >
                <div style={{ fontSize: 14, fontWeight: 600 }}>{destination.label}</div>
                <div style={styles.muted}>{statusLabel(locale, Boolean(profile?.enabled))}</div>
              </button>
            );
          })}
        </div>

        <div style={styles.card}>
          {selectedDestination ? (
            <>
              <div style={{ ...styles.row, justifyContent: "space-between" }}>
                <div>
                  <div style={{ fontSize: 16, fontWeight: 700 }}>{selectedDestination.label}</div>
                  <div style={styles.muted}>
                    {tr(
                      locale,
                      "This is the destination channel where final posts will be published.",
                      "Это канал назначения, куда будут публиковаться готовые посты.",
                    )}
                  </div>
                </div>
                {!selectedProfile ? (
                  <button type="button" style={styles.primaryButton} onClick={createSelectedProfile}>
                    {tr(locale, "Create profile", "Создать профиль")}
                  </button>
                ) : null}
              </div>

              {!selectedProfile ? (
                <div style={styles.muted}>
                  {tr(
                    locale,
                    "No style profile has been created for this channel yet.",
                    "Для этого канала еще не создан профиль стиля.",
                  )}
                </div>
              ) : (
                <>
                  <div style={styles.grid2}>
                    <label style={styles.page}>
                      <span style={styles.label}>{tr(locale, "Profile name", "Название профиля")}</span>
                      <input
                        style={styles.input}
                        value={selectedProfile.name}
                        onChange={(event) => setProfiles((current) => updateProfile(current, selectedProfile.id, { name: event.target.value }))}
                        placeholder={tr(locale, "Founder style", "Стиль автора")}
                      />
                    </label>

                    <label style={styles.page}>
                      <span style={styles.label}>{tr(locale, "Author / persona", "Автор / персона")}</span>
                      <input
                        style={styles.input}
                        value={selectedProfile.authorName ?? ""}
                        onChange={(event) => setProfiles((current) => updateProfile(current, selectedProfile.id, { authorName: event.target.value }))}
                        placeholder={tr(locale, "Whose voice should this sound like?", "На кого должен быть похож текст?")}
                      />
                    </label>
                  </div>

                  <label style={styles.page}>
                    <span style={styles.label}>{tr(locale, "Tone rules", "Правила тона")}</span>
                    <textarea
                      style={styles.textarea}
                      value={selectedProfile.toneRules ?? ""}
                      onChange={(event) => setProfiles((current) => updateProfile(current, selectedProfile.id, { toneRules: event.target.value }))}
                      placeholder={tr(
                        locale,
                        "Describe how the post should sound: concise, sharp, expert, warm, provocative, calm, and so on.",
                        "Опиши, как должен звучать пост: коротко, резко, экспертно, тепло, провокационно, спокойно и так далее.",
                      )}
                    />
                  </label>

                  <label style={styles.page}>
                    <span style={styles.label}>{tr(locale, "Example posts", "Примеры постов")}</span>
                    <textarea
                      style={styles.textarea}
                      value={selectedProfile.samplePosts ?? ""}
                      onChange={(event) => setProfiles((current) => updateProfile(current, selectedProfile.id, { samplePosts: event.target.value }))}
                      placeholder={tr(
                        locale,
                        "Paste 2-5 good examples so the AI can copy the rhythm, vocabulary, and structure.",
                        "Вставь 2-5 удачных примеров, чтобы ИИ мог повторять ритм, словарь и структуру.",
                      )}
                    />
                  </label>

                  <div style={styles.grid2}>
                    <label style={styles.page}>
                      <span style={styles.label}>{tr(locale, "Banned phrases", "Запрещенные фразы")}</span>
                      <textarea
                        style={styles.textarea}
                        value={selectedProfile.bannedPhrases ?? ""}
                        onChange={(event) => setProfiles((current) => updateProfile(current, selectedProfile.id, { bannedPhrases: event.target.value }))}
                        placeholder={tr(locale, "What should never appear in posts?", "Что никогда не должно появляться в постах?")}
                      />
                    </label>

                    <label style={styles.page}>
                      <span style={styles.label}>{tr(locale, "CTA / ending rules", "Правила CTA / концовки")}</span>
                      <textarea
                        style={styles.textarea}
                        value={selectedProfile.ctaRules ?? ""}
                        onChange={(event) => setProfiles((current) => updateProfile(current, selectedProfile.id, { ctaRules: event.target.value }))}
                        placeholder={tr(
                          locale,
                          "How should the post end, and what kind of call to action is allowed?",
                          "Как должен заканчиваться пост и какой призыв к действию допустим?",
                        )}
                      />
                    </label>
                  </div>

                  <label style={{ ...styles.row, fontSize: 12 }}>
                    <input
                      type="checkbox"
                      checked={selectedProfile.enabled}
                      onChange={(event) => setProfiles((current) => updateProfile(current, selectedProfile.id, { enabled: event.target.checked }))}
                    />
                    {tr(locale, "Profile is enabled", "Профиль включен")}
                  </label>

                  <div style={{ ...styles.row, justifyContent: "space-between" }}>
                    <button
                      type="button"
                      style={styles.button}
                      onClick={() => setProfiles((current) => current.filter((entry) => entry.id !== selectedProfile.id))}
                    >
                      {tr(locale, "Remove profile", "Удалить профиль")}
                    </button>
                    <button type="button" style={styles.primaryButton} disabled={saving} onClick={() => void save()}>
                      {saving ? tr(locale, "Saving...", "Сохраняем...") : tr(locale, "Save profile", "Сохранить профиль")}
                    </button>
                  </div>
                </>
              )}
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function AuthorVoiceProfilesSettingsPage({ context }: PluginSettingsPageProps) {
  return (
    <AuthorVoiceProfilesSurface
      companyId={context.companyId ?? null}
      companyPrefix={context.companyPrefix ?? null}
      locale={localeFrom(context.locale)}
    />
  );
}

export function AuthorVoiceProfilesPage({ context }: PluginPageProps) {
  return (
    <AuthorVoiceProfilesSurface
      companyId={context.companyId ?? null}
      companyPrefix={context.companyPrefix ?? null}
      locale={localeFrom(context.locale)}
    />
  );
}
