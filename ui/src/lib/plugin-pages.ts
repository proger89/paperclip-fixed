import type { PluginRecord, PluginUiSlotDeclaration } from "@paperclipai/shared";
import { resolveUiText } from "./localized";
import { getCurrentUiLanguage } from "./ui-language";

function getPageSlot(plugin: PluginRecord | null | undefined): PluginUiSlotDeclaration | null {
  const slots = plugin?.manifestJson?.ui?.slots;
  if (!Array.isArray(slots)) return null;
  const pageSlot = slots.find((slot) => slot.type === "page");
  return pageSlot ?? null;
}

export function getPluginPageRoutePath(plugin: PluginRecord | null | undefined): string | null {
  const routePath = getPageSlot(plugin)?.routePath;
  if (typeof routePath !== "string") return null;
  const trimmed = routePath.trim().replace(/^\/+/, "").replace(/\/+$/, "");
  return trimmed.length > 0 ? trimmed : null;
}

export function getPluginCompanyPagePath(
  plugin: PluginRecord | null | undefined,
  companyPrefix: string | null | undefined,
): string | null {
  const routePath = getPluginPageRoutePath(plugin);
  if (!routePath || !companyPrefix) return null;
  return `/${companyPrefix}/${routePath}`;
}

export function getPluginPageLinkLabel(plugin: PluginRecord | null | undefined): string {
  const locale = getCurrentUiLanguage();
  const displayName = resolveUiText(plugin?.manifestJson?.displayName).trim();
  if (!displayName) return locale === "ru" ? "Открыть страницу плагина" : "Open plugin page";
  if (/telegram/i.test(displayName)) return locale === "ru" ? "Открыть панель Telegram" : "Open Telegram dashboard";
  return locale === "ru" ? `Открыть страницу «${displayName}»` : `Open ${displayName} page`;
}
