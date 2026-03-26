import type { UiLanguage } from "@paperclipai/shared";

export const UI_LANGUAGE_STORAGE_KEY = "paperclip.uiLanguage";

let currentUiLanguage: UiLanguage | null = null;

export function normalizeUiLanguage(value: unknown): UiLanguage | null {
  return value === "ru" || value === "en" ? value : null;
}

export function detectBrowserUiLanguage(): UiLanguage {
  if (typeof navigator === "undefined") return "en";
  const candidates = [...(navigator.languages ?? []), navigator.language];
  return candidates.some((entry) => /^ru(?:[-_]|$)/i.test(entry ?? "")) ? "ru" : "en";
}

export function readStoredUiLanguage(): UiLanguage | null {
  if (typeof window === "undefined") return null;
  try {
    return normalizeUiLanguage(window.localStorage.getItem(UI_LANGUAGE_STORAGE_KEY));
  } catch {
    return null;
  }
}

export function getOptimisticUiLanguage(): UiLanguage {
  return currentUiLanguage ?? readStoredUiLanguage() ?? detectBrowserUiLanguage();
}

export function setCurrentUiLanguage(
  locale: UiLanguage,
  options: { persist?: boolean } = {},
): void {
  currentUiLanguage = locale;
  if (typeof document !== "undefined") {
    document.documentElement.lang = locale;
  }
  if (typeof window === "undefined") return;
  try {
    if (options.persist === false) {
      window.localStorage.removeItem(UI_LANGUAGE_STORAGE_KEY);
      return;
    }
    window.localStorage.setItem(UI_LANGUAGE_STORAGE_KEY, locale);
  } catch {
    // Ignore storage failures in restricted environments.
  }
}

export function getCurrentUiLanguage(): UiLanguage {
  return currentUiLanguage ?? getOptimisticUiLanguage();
}

export function uiLanguageToLocaleTag(locale: UiLanguage): string {
  return locale === "ru" ? "ru-RU" : "en-US";
}
