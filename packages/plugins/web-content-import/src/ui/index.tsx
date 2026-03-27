import { useState, type CSSProperties } from "react";
import type { PluginPageProps, PluginSettingsPageProps } from "@paperclipai/plugin-sdk/ui";
import { usePluginToast } from "@paperclipai/plugin-sdk/ui";

type Locale = "en" | "ru";

type ImportResult = {
  url: string;
  title: string | null;
  sourceText: string;
  excerpt: string | null;
};

const stack: CSSProperties = { display: "grid", gap: 16 };
const card: CSSProperties = {
  border: "1px solid var(--border)",
  borderRadius: 14,
  padding: 16,
  background: "var(--card, transparent)",
};
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
  minHeight: 220,
  resize: "vertical",
  lineHeight: 1.5,
};
const row: CSSProperties = { display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" };
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

function WebContentImportSurface({ companyId, locale }: { companyId: string | null; locale: Locale }) {
  const pushToast = usePluginToast();
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function extract() {
    if (!companyId || !url.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const next = await api<ImportResult>(`/api/companies/${companyId}/web-content-import/extract`, {
        method: "POST",
        body: JSON.stringify({ url: url.trim() }),
      });
      setResult(next);
      pushToast({
        title: tr(locale, "Content imported", "Текст импортирован"),
        body: tr(
          locale,
          "The page was extracted into clean source text and is ready for editorial use.",
          "Страница извлечена в чистый исходный текст и готова для редакторской обработки.",
        ),
        tone: "success",
      });
    } catch (nextError) {
      const message = nextError instanceof Error ? nextError.message : String(nextError);
      setError(message);
      pushToast({
        title: tr(locale, "Import failed", "Не удалось импортировать"),
        body: message,
        tone: "error",
      });
    } finally {
      setLoading(false);
    }
  }

  if (!companyId) return <div style={muted}>{tr(locale, "Company context is required.", "Нужен контекст компании.")}</div>;

  return (
    <div style={stack}>
      <div style={card}>
        <div style={{ fontSize: 14, fontWeight: 600 }}>{tr(locale, "Import from URL", "Импорт по ссылке")}</div>
        <div style={{ ...muted, marginTop: 8 }}>
          {tr(
            locale,
            "Paste a source URL and Paperclip will extract a clean text body for editorial work. Telegram Publishing can use the same endpoint during compose-from-link.",
            "Вставь ссылку на источник, и Paperclip извлечет чистый текст для дальнейшей редакторской работы. Telegram Publishing использует этот же импорт для compose-from-link.",
          )}
        </div>
        <div style={{ ...row, marginTop: 14 }}>
          <input
            style={{ ...input, flex: 1 }}
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://example.com/article"
          />
          <button type="button" style={button} disabled={loading || !url.trim()} onClick={() => void extract()}>
            {loading ? tr(locale, "Extracting...", "Извлекаем...") : tr(locale, "Extract", "Извлечь")}
          </button>
        </div>
        {error ? <div style={{ ...muted, color: "var(--destructive, #c00)", marginTop: 12 }}>{error}</div> : null}
      </div>

      <div style={card}>
        <div style={{ fontSize: 14, fontWeight: 600 }}>{tr(locale, "Preview", "Предпросмотр")}</div>
        {result ? (
          <div style={{ ...stack, marginTop: 12 }}>
            <div style={muted}>{tr(locale, "URL", "Ссылка")}: {result.url}</div>
            <div style={muted}>{tr(locale, "Title", "Заголовок")}: {result.title || tr(locale, "No title detected", "Заголовок не найден")}</div>
            {result.excerpt ? <div style={muted}>{tr(locale, "Excerpt", "Краткая выжимка")}: {result.excerpt}</div> : null}
            <textarea style={textarea} readOnly value={result.sourceText} />
          </div>
        ) : (
          <div style={{ ...muted, marginTop: 10 }}>{tr(locale, "No imported page yet.", "Пока ничего не импортировано.")}</div>
        )}
      </div>
    </div>
  );
}

export function WebContentImportSettingsPage({ context }: PluginSettingsPageProps) {
  return <WebContentImportSurface companyId={context.companyId} locale={context.locale} />;
}

export function WebContentImportPage({ context }: PluginPageProps) {
  return <WebContentImportSurface companyId={context.companyId} locale={context.locale} />;
}
