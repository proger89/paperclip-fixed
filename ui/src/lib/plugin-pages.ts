import type { PluginRecord, PluginUiSlotDeclaration } from "@paperclipai/shared";

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
  const displayName = plugin?.manifestJson?.displayName?.trim();
  if (!displayName) return "Open plugin page";
  if (/telegram/i.test(displayName)) return "Open Telegram dashboard";
  return `Open ${displayName} page`;
}
