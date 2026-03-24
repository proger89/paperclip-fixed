import type { Db } from "@paperclipai/db";
import { agents, agentTaskSessions } from "@paperclipai/db";
import { eq, inArray } from "drizzle-orm";
import {
  repairPersistedLocalAdapterConfigPaths,
  repairTaskSessionPathState,
} from "./local-adapter-paths.js";
import { listLocalAdapterTypes } from "./local-adapter-defaults.js";

export interface LocalAdapterPathRepairResult {
  checkedAgents: number;
  updatedAgents: number;
  checkedSessions: number;
  updatedSessions: number;
  clearedSessions: number;
}

export async function repairPersistedLocalAdapterPaths(
  db: Db,
  env: NodeJS.ProcessEnv = process.env,
): Promise<LocalAdapterPathRepairResult> {
  const localAdapterTypes = listLocalAdapterTypes();

  const agentRows = await db
    .select({
      id: agents.id,
      companyId: agents.companyId,
      adapterType: agents.adapterType,
      adapterConfig: agents.adapterConfig,
    })
    .from(agents)
    .where(inArray(agents.adapterType, localAdapterTypes));

  let updatedAgents = 0;
  for (const row of agentRows) {
    const repaired = repairPersistedLocalAdapterConfigPaths(
      row.adapterType,
      row.adapterConfig,
      {
        env,
        companyId: row.companyId,
        agentId: row.id,
        repairSource: "startup",
      },
    );
    if (!repaired.changed) continue;
    await db
      .update(agents)
      .set({
        adapterConfig: repaired.adapterConfig,
        updatedAt: new Date(),
      })
      .where(eq(agents.id, row.id));
    updatedAgents += 1;
  }

  const sessionRows = await db
    .select({
      id: agentTaskSessions.id,
      companyId: agentTaskSessions.companyId,
      agentId: agentTaskSessions.agentId,
      adapterType: agentTaskSessions.adapterType,
      taskKey: agentTaskSessions.taskKey,
      sessionParamsJson: agentTaskSessions.sessionParamsJson,
      sessionDisplayId: agentTaskSessions.sessionDisplayId,
    })
    .from(agentTaskSessions)
    .where(inArray(agentTaskSessions.adapterType, localAdapterTypes));

  let updatedSessions = 0;
  let clearedSessions = 0;
  for (const row of sessionRows) {
    const repaired = repairTaskSessionPathState(
      row.sessionParamsJson,
      row.sessionDisplayId,
      {
        env,
        companyId: row.companyId,
        agentId: row.agentId,
        adapterType: row.adapterType,
        taskKey: row.taskKey,
        sessionId: row.id,
        repairSource: "startup",
      },
    );
    if (!repaired.changed) continue;
    await db
      .update(agentTaskSessions)
      .set({
        sessionParamsJson: repaired.sessionParamsJson,
        sessionDisplayId: repaired.sessionDisplayId,
        updatedAt: new Date(),
      })
      .where(eq(agentTaskSessions.id, row.id));
    updatedSessions += 1;
    if (repaired.cleared) {
      clearedSessions += 1;
    }
  }

  return {
    checkedAgents: agentRows.length,
    updatedAgents,
    checkedSessions: sessionRows.length,
    updatedSessions,
    clearedSessions,
  };
}
