const OPENAI_API_BASE = (process.env.OPENAI_API_BASE_URL?.trim() || "https://api.openai.com/v1").replace(/\/+$/, "");
const GPT_54_MODEL = "gpt-5.4";

export interface EditorialAuthorProfile {
  id: string;
  name: string;
  destinationId: string;
  authorName?: string | null;
  toneRules?: string | null;
  samplePosts?: string | null;
  bannedPhrases?: string | null;
  ctaRules?: string | null;
}

export interface TelegramEditorialRewriteInput {
  destinationLabel: string;
  sourceTitle?: string | null;
  sourceUrl?: string | null;
  sourceText: string;
  authorProfile: EditorialAuthorProfile;
}

export interface TelegramEditorialRewriteResult {
  model: string;
  title: string;
  sourceSummary: string;
  finalCopy: string;
  checklist: string[];
  riskFlags: string[];
  rawText: string;
}

function requireOpenAiApiKey() {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is required for Telegram editorial rewrite with GPT-5.4");
  }
  return apiKey;
}

function buildSystemPrompt(profile: EditorialAuthorProfile) {
  return [
    "You are the editorial engine for a Telegram publishing workflow inside Paperclip.",
    "Always rewrite into a publication-ready Telegram post that preserves facts, respects the source, and matches the target channel voice.",
    "The target model is GPT-5.4 and there is no fallback editorial path.",
    "",
    "Return strict JSON with this shape:",
    "{",
    '  "title": "short internal title",',
    '  "sourceSummary": "1-2 sentence summary of the source",',
    '  "finalCopy": "the final Telegram post text",',
    '  "checklist": ["review item"],',
    '  "riskFlags": ["possible risk"]',
    "}",
    "",
    "Rules:",
    "- finalCopy must be concise, polished, and ready for approval.",
    "- Keep the author's style without inventing facts.",
    "- Mention uncertainty only when the source is actually ambiguous.",
    "- Avoid generic marketing filler.",
    "- Respect banned phrases and CTA constraints.",
    "",
    `Channel profile name: ${profile.name}`,
    `Channel destination id: ${profile.destinationId}`,
    `Author name: ${profile.authorName ?? "unknown"}`,
    `Tone rules: ${profile.toneRules ?? "none"}`,
    `Sample posts: ${profile.samplePosts ?? "none"}`,
    `Banned phrases: ${profile.bannedPhrases ?? "none"}`,
    `CTA rules: ${profile.ctaRules ?? "none"}`,
  ].join("\n");
}

function buildUserPrompt(input: TelegramEditorialRewriteInput) {
  return [
    `Destination label: ${input.destinationLabel}`,
    `Source title: ${input.sourceTitle ?? "none"}`,
    `Source URL: ${input.sourceUrl ?? "none"}`,
    "",
    "Source text:",
    input.sourceText,
  ].join("\n");
}

async function openAiRequest(apiKey: string, path: string, payload: Record<string, unknown>) {
  const response = await fetch(`${OPENAI_API_BASE}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const rawText = await response.text();
  let json: Record<string, unknown> | null = null;
  try {
    json = rawText ? JSON.parse(rawText) as Record<string, unknown> : null;
  } catch {
    json = null;
  }

  if (!response.ok) {
    const message =
      typeof json?.error === "object" && json?.error !== null && typeof (json.error as { message?: unknown }).message === "string"
        ? (json.error as { message: string }).message
        : rawText || `OpenAI request failed (${response.status})`;
    throw new Error(message);
  }

  return json ?? {};
}

function extractTextFromResponsesPayload(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;
  if (typeof record.output_text === "string" && record.output_text.trim().length > 0) {
    return record.output_text.trim();
  }

  const output = Array.isArray(record.output) ? record.output : [];
  const textParts: string[] = [];
  for (const entry of output) {
    if (!entry || typeof entry !== "object") continue;
    const content = Array.isArray((entry as Record<string, unknown>).content)
      ? (entry as Record<string, unknown>).content as Array<Record<string, unknown>>
      : [];
    for (const chunk of content) {
      if (!chunk || typeof chunk !== "object") continue;
      const candidate =
        typeof chunk.text === "string"
          ? chunk.text
          : typeof chunk.value === "string"
            ? chunk.value
            : null;
      if (candidate && candidate.trim().length > 0) {
        textParts.push(candidate.trim());
      }
    }
  }

  return textParts.length > 0 ? textParts.join("\n") : null;
}

function extractTextFromChatCompletionsPayload(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;
  const choices = Array.isArray(record.choices) ? record.choices : [];
  const first = choices[0];
  if (!first || typeof first !== "object") return null;
  const message = (first as Record<string, unknown>).message;
  if (!message || typeof message !== "object") return null;
  const content = (message as Record<string, unknown>).content;
  if (typeof content === "string" && content.trim().length > 0) {
    return content.trim();
  }
  if (Array.isArray(content)) {
    const text = content
      .map((entry) => {
        if (!entry || typeof entry !== "object") return "";
        if (typeof (entry as Record<string, unknown>).text === "string") {
          return ((entry as Record<string, unknown>).text as string).trim();
        }
        return "";
      })
      .filter(Boolean)
      .join("\n");
    return text || null;
  }
  return null;
}

function extractJsonObject(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  const direct = trimmed.match(/^\s*\{[\s\S]*\}\s*$/);
  const candidate = direct?.[0] ?? trimmed.match(/\{[\s\S]*\}/)?.[0] ?? null;
  if (!candidate) return null;
  try {
    return JSON.parse(candidate) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function normalizeStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .filter((entry): entry is string => typeof entry === "string")
      .map((entry) => entry.trim())
      .filter(Boolean);
  }
  if (typeof value === "string" && value.trim().length > 0) {
    return value
      .split(/\r?\n|;/)
      .map((entry) => entry.trim())
      .filter(Boolean);
  }
  return [];
}

function fallbackTitle(sourceTitle: string | null | undefined, sourceText: string) {
  const preferred = typeof sourceTitle === "string" ? sourceTitle.trim() : "";
  if (preferred) return preferred.slice(0, 120);
  return sourceText.replace(/\s+/g, " ").trim().slice(0, 120) || "Telegram editorial draft";
}

export async function rewriteTelegramEditorialDraft(
  input: TelegramEditorialRewriteInput,
): Promise<TelegramEditorialRewriteResult> {
  const apiKey = requireOpenAiApiKey();
  const systemPrompt = buildSystemPrompt(input.authorProfile);
  const userPrompt = buildUserPrompt(input);

  let rawText: string | null = null;
  try {
    const payload = await openAiRequest(apiKey, "/responses", {
      model: GPT_54_MODEL,
      input: [
        {
          role: "system",
          content: [{ type: "input_text", text: systemPrompt }],
        },
        {
          role: "user",
          content: [{ type: "input_text", text: userPrompt }],
        },
      ],
    });
    rawText = extractTextFromResponsesPayload(payload);
  } catch (error) {
    const payload = await openAiRequest(apiKey, "/chat/completions", {
      model: GPT_54_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.7,
    });
    rawText = extractTextFromChatCompletionsPayload(payload);
    if (!rawText) {
      throw error;
    }
  }

  const output = extractJsonObject(rawText ?? "");
  const finalCopy =
    typeof output?.finalCopy === "string" && output.finalCopy.trim().length > 0
      ? output.finalCopy.trim()
      : (rawText ?? "").trim();
  if (!finalCopy) {
    throw new Error("GPT-5.4 did not return Telegram copy");
  }

  return {
    model: GPT_54_MODEL,
    title:
      typeof output?.title === "string" && output.title.trim().length > 0
        ? output.title.trim()
        : fallbackTitle(input.sourceTitle, input.sourceText),
    sourceSummary:
      typeof output?.sourceSummary === "string" && output.sourceSummary.trim().length > 0
        ? output.sourceSummary.trim()
        : fallbackTitle(input.sourceTitle, input.sourceText),
    finalCopy,
    checklist: normalizeStringArray(output?.checklist),
    riskFlags: normalizeStringArray(output?.riskFlags),
    rawText: rawText ?? finalCopy,
  };
}
