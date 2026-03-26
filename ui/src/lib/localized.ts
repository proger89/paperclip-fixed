import { resolveLocalizedText, type LocalizedText } from "@paperclipai/shared";
import { getCurrentUiLanguage } from "./ui-language";

export function resolveUiText(value: LocalizedText | undefined): string {
  return resolveLocalizedText(value, getCurrentUiLanguage());
}
