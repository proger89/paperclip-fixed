import { agents, type Db } from "@paperclipai/db";
import { agentInstructionsService } from "./agent-instructions.js";

type RepairableAgentRow = {
  id: string;
  companyId: string;
  name: string;
  role: string;
  adapterConfig: unknown;
};

export async function repairManagedInstructionBundles(db: Db) {
  const instructions = agentInstructionsService();
  const rows = await db
    .select({
      id: agents.id,
      companyId: agents.companyId,
      name: agents.name,
      role: agents.role,
      adapterConfig: agents.adapterConfig,
    })
    .from(agents);

  let checked = 0;
  let updated = 0;
  let repairedLegacy = 0;
  let markedCurrent = 0;

  for (const row of rows as RepairableAgentRow[]) {
    checked += 1;
    const result = await instructions.repairManagedDefaultBundle(row);
    if (!result.updated) continue;
    updated += 1;
    if (result.reason === "repaired_legacy") repairedLegacy += 1;
    if (result.reason === "marked_current") markedCurrent += 1;
  }

  return {
    checked,
    updated,
    repairedLegacy,
    markedCurrent,
  };
}
