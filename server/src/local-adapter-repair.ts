import type { Db } from "@paperclipai/db";
import { agents } from "@paperclipai/db";
import { eq, inArray } from "drizzle-orm";
import {
  listLocalAdapterTypes,
  needsLocalExecutionLocationBackfill,
  resolveDefaultLocalAdapterExecutionLocation,
} from "./local-adapter-defaults.js";

export interface LocalAdapterExecutionLocationRepairResult {
  checked: number;
  updated: number;
  skipped: boolean;
  defaultExecutionLocation: "container" | "host";
}

export async function repairMissingLocalAdapterExecutionLocations(
  db: Db,
  env: NodeJS.ProcessEnv = process.env,
): Promise<LocalAdapterExecutionLocationRepairResult> {
  const defaultExecutionLocation = resolveDefaultLocalAdapterExecutionLocation(env);
  if (defaultExecutionLocation !== "host") {
    return {
      checked: 0,
      updated: 0,
      skipped: true,
      defaultExecutionLocation,
    };
  }

  const localAdapterTypes = listLocalAdapterTypes();
  const rows = await db
    .select({
      id: agents.id,
      adapterType: agents.adapterType,
      adapterConfig: agents.adapterConfig,
    })
    .from(agents)
    .where(inArray(agents.adapterType, localAdapterTypes));

  let updated = 0;
  for (const row of rows) {
    if (!needsLocalExecutionLocationBackfill(row.adapterType, row.adapterConfig)) continue;
    const nextAdapterConfig =
      typeof row.adapterConfig === "object" && row.adapterConfig !== null && !Array.isArray(row.adapterConfig)
        ? { ...(row.adapterConfig as Record<string, unknown>), executionLocation: "host" }
        : { executionLocation: "host" };
    await db
      .update(agents)
      .set({
        adapterConfig: nextAdapterConfig,
        updatedAt: new Date(),
      })
      .where(eq(agents.id, row.id));
    updated += 1;
  }

  return {
    checked: rows.length,
    updated,
    skipped: false,
    defaultExecutionLocation,
  };
}
