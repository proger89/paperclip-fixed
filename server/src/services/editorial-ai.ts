import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { execute as codexExecute } from "@paperclipai/adapter-codex-local/server";

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

export interface TelegramEditorialExecutionConfig {
  adapterType: "codex_local";
  model: string;
  reasoningEffort: "low" | "medium" | "high";
}

export interface TelegramEditorialRewriteInput {
  destinationLabel: string;
  sourceTitle?: string | null;
  sourceUrl?: string | null;
  sourceText: string;
  authorProfile: EditorialAuthorProfile;
  execution: TelegramEditorialExecutionConfig;
}

export interface TelegramEditorialRewriteResult {
  model: string;
  reasoningEffort: "low" | "medium" | "high";
  title: string;
  sourceSummary: string;
  finalCopy: string;
  checklist: string[];
  riskFlags: string[];
  rawText: string;
}

function buildSystemPrompt(profile: EditorialAuthorProfile) {
  return [
    "You are the editorial engine for a Telegram publishing workflow inside Paperclip.",
    "Always rewrite into a publication-ready Telegram post that preserves facts, respects the source, and matches the target channel voice.",
    "There is no fallback editorial path.",
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
    "Prepare Telegram-ready editorial copy from the source below.",
    `Destination label: ${input.destinationLabel}`,
    `Source title: ${input.sourceTitle ?? "none"}`,
    `Source URL: ${input.sourceUrl ?? "none"}`,
    "",
    "Source text:",
    input.sourceText,
  ].join("\n");
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

function resolveExecutionConfig(input: TelegramEditorialExecutionConfig): TelegramEditorialExecutionConfig {
  const model = input.model.trim();
  if (!model) {
    throw new Error("AI model is required for Telegram editorial rewrite");
  }
  if (input.adapterType !== "codex_local") {
    throw new Error(`Unsupported AI adapter for Telegram editorial rewrite: ${input.adapterType}`);
  }
  if (input.reasoningEffort !== "low" && input.reasoningEffort !== "medium" && input.reasoningEffort !== "high") {
    throw new Error(`Unsupported AI reasoning effort: ${input.reasoningEffort}`);
  }
  return {
    adapterType: "codex_local",
    model,
    reasoningEffort: input.reasoningEffort,
  };
}

export async function rewriteTelegramEditorialDraft(
  input: TelegramEditorialRewriteInput,
): Promise<TelegramEditorialRewriteResult> {
  const execution = resolveExecutionConfig(input.execution);
  const prompt = [buildSystemPrompt(input.authorProfile), "", buildUserPrompt(input)].join("\n");
  const runId = `telegram-editorial-${randomUUID()}`;
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-telegram-editorial-"));
  const logs: string[] = [];

  try {
    const result = await codexExecute({
      runId,
      agent: {
        id: "telegram-editorial-ai",
        companyId: "paperclip-editorial",
        name: "Telegram Editorial AI",
        adapterType: "codex_local",
        adapterConfig: {},
      },
      runtime: {
        sessionId: null,
        sessionParams: null,
        sessionDisplayId: null,
        taskKey: null,
      },
      config: {
        command: process.env.PAPERCLIP_EDITORIAL_CODEX_COMMAND?.trim() || "codex",
        cwd: tempDir,
        model: execution.model,
        modelReasoningEffort: execution.reasoningEffort,
        dangerouslyBypassApprovalsAndSandbox: true,
        promptTemplate: prompt,
      },
      context: {},
      authToken: "",
      onLog: async (_stream, chunk) => {
        if (chunk.trim()) logs.push(chunk.trim());
      },
    });

    if (result.timedOut) {
      throw new Error(`AI rewrite timed out${result.errorMessage ? `: ${result.errorMessage}` : ""}`);
    }
    if ((result.exitCode ?? 0) !== 0) {
      const stderr =
        result.resultJson && typeof result.resultJson === "object" && typeof (result.resultJson as Record<string, unknown>).stderr === "string"
          ? ((result.resultJson as Record<string, unknown>).stderr as string).trim()
          : "";
      throw new Error(result.errorMessage || stderr || "AI rewrite failed");
    }

    const rawText = result.summary?.trim() || "";
    const output = extractJsonObject(rawText);
    const finalCopy =
      typeof output?.finalCopy === "string" && output.finalCopy.trim().length > 0
        ? output.finalCopy.trim()
        : rawText;
    if (!finalCopy) {
      throw new Error("AI did not return Telegram copy");
    }

    return {
      model: execution.model,
      reasoningEffort: execution.reasoningEffort,
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
      rawText: rawText || finalCopy,
    };
  } catch (error) {
    const detail = logs.slice(-6).join("\n").trim();
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(detail ? `${message}\n${detail}` : message);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}
