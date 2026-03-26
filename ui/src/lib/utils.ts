import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { deriveAgentUrlKey, deriveProjectUrlKey } from "@paperclipai/shared";
import type { BillingType, FinanceDirection, FinanceEventKind } from "@paperclipai/shared";
import { getCurrentUiLanguage, uiLanguageToLocaleTag } from "./ui-language";
import { translateText } from "./i18n";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCents(cents: number): string {
  return new Intl.NumberFormat(uiLanguageToLocaleTag(getCurrentUiLanguage()), {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}

export function formatDate(date: Date | string): string {
  return new Date(date).toLocaleDateString(uiLanguageToLocaleTag(getCurrentUiLanguage()), {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function formatDateTime(date: Date | string): string {
  return new Date(date).toLocaleString(uiLanguageToLocaleTag(getCurrentUiLanguage()), {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function relativeTime(date: Date | string): string {
  const now = Date.now();
  const then = new Date(date).getTime();
  const diffSec = Math.round((then - now) / 1000);
  const absDiffSec = Math.abs(diffSec);
  const locale = uiLanguageToLocaleTag(getCurrentUiLanguage());
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  if (absDiffSec < 60) return formatter.format(diffSec, "second");
  const diffMin = Math.round(diffSec / 60);
  if (Math.abs(diffMin) < 60) return formatter.format(diffMin, "minute");
  const diffHr = Math.round(diffMin / 60);
  if (Math.abs(diffHr) < 24) return formatter.format(diffHr, "hour");
  const diffDay = Math.round(diffHr / 24);
  if (Math.abs(diffDay) < 30) return formatter.format(diffDay, "day");
  return formatDate(date);
}

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

/** Map a raw provider slug to a display-friendly name. */
export function providerDisplayName(provider: string): string {
  const map: Record<string, string> = {
    anthropic: "Anthropic",
    openai: "OpenAI",
    openrouter: "OpenRouter",
    chatgpt: "ChatGPT",
    google: "Google",
    cursor: "Cursor",
    jetbrains: "JetBrains AI",
  };
  return map[provider.toLowerCase()] ?? provider;
}

export function billingTypeDisplayName(billingType: BillingType): string {
  const map: Record<BillingType, string> = {
    metered_api: translateText("Metered API"),
    subscription_included: translateText("Subscription"),
    subscription_overage: translateText("Subscription overage"),
    credits: translateText("Credits"),
    fixed: translateText("Fixed"),
    unknown: translateText("Unknown"),
  };
  return map[billingType];
}

export function quotaSourceDisplayName(source: string): string {
  const map: Record<string, string> = {
    "anthropic-oauth": "Anthropic OAuth",
    "claude-cli": "Claude CLI",
    "codex-rpc": "Codex app server",
    "codex-wham": "ChatGPT WHAM",
  };
  return map[source] ?? source;
}

function coerceBillingType(value: unknown): BillingType | null {
  if (
    value === "metered_api" ||
    value === "subscription_included" ||
    value === "subscription_overage" ||
    value === "credits" ||
    value === "fixed" ||
    value === "unknown"
  ) {
    return value;
  }
  return null;
}

function readRunCostUsd(payload: Record<string, unknown> | null): number {
  if (!payload) return 0;
  for (const key of ["costUsd", "cost_usd", "total_cost_usd"] as const) {
    const value = payload[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return 0;
}

export function visibleRunCostUsd(
  usage: Record<string, unknown> | null,
  result: Record<string, unknown> | null = null,
): number {
  const billingType = coerceBillingType(usage?.billingType) ?? coerceBillingType(result?.billingType);
  if (billingType === "subscription_included") return 0;
  return readRunCostUsd(usage) || readRunCostUsd(result);
}

export function financeEventKindDisplayName(eventKind: FinanceEventKind): string {
  const map: Record<FinanceEventKind, string> = {
    inference_charge: translateText("Inference charge"),
    platform_fee: translateText("Platform fee"),
    credit_purchase: translateText("Credit purchase"),
    credit_refund: translateText("Credit refund"),
    credit_expiry: translateText("Credit expiry"),
    byok_fee: translateText("BYOK fee"),
    gateway_overhead: translateText("Gateway overhead"),
    log_storage_charge: translateText("Log storage"),
    logpush_charge: translateText("Logpush"),
    provisioned_capacity_charge: translateText("Provisioned capacity"),
    training_charge: translateText("Training"),
    custom_model_import_charge: translateText("Custom model import"),
    custom_model_storage_charge: translateText("Custom model storage"),
    manual_adjustment: translateText("Manual adjustment"),
  };
  return map[eventKind];
}

export function financeDirectionDisplayName(direction: FinanceDirection): string {
  return direction === "credit" ? translateText("Credit") : translateText("Debit");
}

/** Build an issue URL using the human-readable identifier when available. */
export function issueUrl(issue: { id: string; identifier?: string | null }): string {
  return `/issues/${issue.identifier ?? issue.id}`;
}

/** Build an agent route URL using the short URL key when available. */
export function agentRouteRef(agent: { id: string; urlKey?: string | null; name?: string | null }): string {
  return agent.urlKey ?? deriveAgentUrlKey(agent.name, agent.id);
}

/** Build an agent URL using the short URL key when available. */
export function agentUrl(agent: { id: string; urlKey?: string | null; name?: string | null }): string {
  return `/agents/${agentRouteRef(agent)}`;
}

/** Build a project route reference using the short URL key when available. */
export function projectRouteRef(project: { id: string; urlKey?: string | null; name?: string | null }): string {
  return project.urlKey ?? deriveProjectUrlKey(project.name, project.id);
}

/** Build a project URL using the short URL key when available. */
export function projectUrl(project: { id: string; urlKey?: string | null; name?: string | null }): string {
  return `/projects/${projectRouteRef(project)}`;
}
