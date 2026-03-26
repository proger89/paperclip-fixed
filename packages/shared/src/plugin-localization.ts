import type { JsonSchema, LocalizedText, PaperclipPluginManifestV1 } from "./types/plugin.js";
import type { UiLanguage } from "./constants.js";

export function isLocalizedTextRecord(
  value: unknown,
): value is Record<UiLanguage, string> {
  return typeof value === "object"
    && value !== null
    && typeof (value as Record<string, unknown>).en === "string"
    && typeof (value as Record<string, unknown>).ru === "string";
}

export function resolveLocalizedText(
  value: LocalizedText | undefined,
  locale: UiLanguage,
): string {
  if (typeof value === "string") return value;
  if (isLocalizedTextRecord(value)) {
    return value[locale] ?? value.en;
  }
  return "";
}

function localizeJsonSchemaNode(value: unknown, locale: UiLanguage): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => localizeJsonSchemaNode(item, locale));
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  if (isLocalizedTextRecord(value)) {
    return resolveLocalizedText(value, locale);
  }

  const record = value as Record<string, unknown>;
  const next: Record<string, unknown> = {};

  for (const [key, child] of Object.entries(record)) {
    if ((key === "title" || key === "description") && isLocalizedTextRecord(child)) {
      next[key] = resolveLocalizedText(child, locale);
      continue;
    }
    next[key] = localizeJsonSchemaNode(child, locale);
  }

  return next;
}

export function localizeJsonSchemaPresentation<T extends JsonSchema | undefined>(
  schema: T,
  locale: UiLanguage,
): T {
  if (!schema) return schema;
  return localizeJsonSchemaNode(schema, locale) as T;
}

export function localizePluginManifest(
  manifest: PaperclipPluginManifestV1,
  locale: UiLanguage,
): PaperclipPluginManifestV1 {
  return {
    ...manifest,
    displayName: resolveLocalizedText(manifest.displayName, locale),
    description: resolveLocalizedText(manifest.description, locale),
    instanceConfigSchema: localizeJsonSchemaPresentation(manifest.instanceConfigSchema, locale),
    jobs: manifest.jobs?.map((job) => ({
      ...job,
      displayName: resolveLocalizedText(job.displayName, locale),
      description:
        job.description === undefined
          ? undefined
          : resolveLocalizedText(job.description, locale),
    })),
    webhooks: manifest.webhooks?.map((webhook) => ({
      ...webhook,
      displayName: resolveLocalizedText(webhook.displayName, locale),
      description:
        webhook.description === undefined
          ? undefined
          : resolveLocalizedText(webhook.description, locale),
    })),
    launchers: manifest.launchers?.map((launcher) => ({
      ...launcher,
      displayName: resolveLocalizedText(launcher.displayName, locale),
      description:
        launcher.description === undefined
          ? undefined
          : resolveLocalizedText(launcher.description, locale),
    })),
    ui: manifest.ui
      ? {
        ...manifest.ui,
        slots: manifest.ui.slots?.map((slot) => ({
          ...slot,
          displayName: resolveLocalizedText(slot.displayName, locale),
        })),
        launchers: manifest.ui.launchers?.map((launcher) => ({
          ...launcher,
          displayName: resolveLocalizedText(launcher.displayName, locale),
          description:
            launcher.description === undefined
              ? undefined
              : resolveLocalizedText(launcher.description, locale),
        })),
      }
      : undefined,
  };
}
