import { and, eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { pluginCompanySettings, plugins } from "@paperclipai/db";
import { notFound } from "../errors.js";

export function pluginCompanySettingsService(db: Db) {
  async function assertPluginExists(pluginId: string) {
    const plugin = await db
      .select({ id: plugins.id })
      .from(plugins)
      .where(eq(plugins.id, pluginId))
      .then((rows) => rows[0] ?? null);
    if (!plugin) {
      throw notFound("Plugin not found");
    }
  }

  return {
    async get(pluginId: string, companyId: string) {
      return await db
        .select()
        .from(pluginCompanySettings)
        .where(
          and(
            eq(pluginCompanySettings.pluginId, pluginId),
            eq(pluginCompanySettings.companyId, companyId),
          ),
        )
        .then((rows) => rows[0] ?? null);
    },

    async listByPlugin(pluginId: string, opts?: { enabledOnly?: boolean }) {
      const conditions = [eq(pluginCompanySettings.pluginId, pluginId)];
      if (opts?.enabledOnly) {
        conditions.push(eq(pluginCompanySettings.enabled, true));
      }
      return await db
        .select()
        .from(pluginCompanySettings)
        .where(and(...conditions));
    },

    async upsert(input: {
      pluginId: string;
      companyId: string;
      enabled?: boolean;
      settingsJson?: Record<string, unknown>;
      lastError?: string | null;
    }) {
      await assertPluginExists(input.pluginId);
      const existing = await this.get(input.pluginId, input.companyId);
      const nextSettingsJson = input.settingsJson ?? existing?.settingsJson ?? {};
      const nextEnabled = input.enabled ?? existing?.enabled ?? true;
      const nextLastError =
        input.lastError !== undefined ? input.lastError : (existing?.lastError ?? null);

      if (existing) {
        return await db
          .update(pluginCompanySettings)
          .set({
            enabled: nextEnabled,
            settingsJson: nextSettingsJson,
            lastError: nextLastError,
            updatedAt: new Date(),
          })
          .where(eq(pluginCompanySettings.id, existing.id))
          .returning()
          .then((rows) => rows[0] ?? null);
      }

      return await db
        .insert(pluginCompanySettings)
        .values({
          pluginId: input.pluginId,
          companyId: input.companyId,
          enabled: nextEnabled,
          settingsJson: nextSettingsJson,
          lastError: nextLastError,
        })
        .returning()
        .then((rows) => rows[0] ?? null);
    },
  };
}
