const COMMON_ENTITY_REPLACEMENTS: Array<[RegExp, string]> = [
  [/&nbsp;/gi, " "],
  [/&amp;/gi, "&"],
  [/&quot;/gi, "\""],
  [/&#39;/gi, "'"],
  [/&lt;/gi, "<"],
  [/&gt;/gi, ">"],
];

export interface ImportedWebContent {
  url: string;
  title: string | null;
  sourceText: string;
  excerpt: string;
}

function trimToNull(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isPrivateHostname(hostname: string) {
  const normalized = hostname.trim().toLowerCase();
  if (!normalized) return true;
  if (normalized === "localhost" || normalized.endsWith(".local")) return true;
  if (normalized === "0.0.0.0" || normalized === "::1") return true;
  if (normalized.startsWith("127.")) return true;
  if (normalized.startsWith("10.")) return true;
  if (normalized.startsWith("192.168.")) return true;
  if (normalized.startsWith("169.254.")) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(normalized)) return true;
  return false;
}

function decodeHtml(text: string) {
  return COMMON_ENTITY_REPLACEMENTS.reduce(
    (current, [pattern, value]) => current.replace(pattern, value),
    text,
  );
}

function stripHtml(html: string) {
  const withoutScripts = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ");
  const titleMatch = withoutScripts.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = trimToNull(titleMatch?.[1] ? decodeHtml(titleMatch[1]).replace(/\s+/g, " ") : null);
  const bodyText = decodeHtml(
    withoutScripts
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n\n")
      .replace(/<\/div>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();

  return {
    title,
    text: bodyText,
  };
}

function excerpt(text: string, limit = 280) {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= limit) return normalized;
  return `${normalized.slice(0, Math.max(0, limit - 3)).trimEnd()}...`;
}

export async function importWebContent(urlString: string): Promise<ImportedWebContent> {
  let url: URL;
  try {
    url = new URL(urlString);
  } catch {
    throw new Error("Invalid URL");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only http and https URLs are supported");
  }
  if (isPrivateHostname(url.hostname)) {
    throw new Error("Private or local URLs are not supported for web content import");
  }

  const response = await fetch(url.toString(), {
    headers: {
      "User-Agent": "Paperclip Web Content Import/1.0",
      Accept: "text/html, text/plain;q=0.9, application/xhtml+xml;q=0.8",
    },
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch source URL (${response.status})`);
  }

  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  const raw = await response.text();
  const parsed = contentType.includes("html")
    ? stripHtml(raw)
    : {
      title: null,
      text: raw.replace(/\r/g, "").trim(),
    };

  if (!parsed.text) {
    throw new Error("Source URL did not contain readable text");
  }

  return {
    url: url.toString(),
    title: parsed.title,
    sourceText: parsed.text,
    excerpt: excerpt(parsed.text),
  };
}
