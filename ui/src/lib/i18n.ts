import type { UiLanguage } from "@paperclipai/shared";
import { keyTranslations, textTranslations, type TranslationParams } from "./i18n-catalog";
import { getCurrentUiLanguage } from "./ui-language";

function interpolate(template: string, params: TranslationParams = {}): string {
  return template.replace(/\{(\w+)\}/g, (_match, key) => String(params[key] ?? ""));
}

export function translateKey(
  key: string,
  params: TranslationParams = {},
  locale: UiLanguage = getCurrentUiLanguage(),
): string {
  const entry = keyTranslations[locale][key] ?? keyTranslations.en[key];
  if (typeof entry === "function") return entry(params);
  if (typeof entry === "string") return interpolate(entry, params);
  return key;
}

export function translateText(
  value: string,
  locale: UiLanguage = getCurrentUiLanguage(),
): string {
  return textTranslations[locale][value] ?? value;
}
