import { createDb } from "@paperclipai/db";
import { repairMissingLocalAdapterExecutionLocations } from "../server/src/local-adapter-repair.js";

async function main() {
  const dbUrl = process.env.DATABASE_URL?.trim();
  if (!dbUrl) {
    console.log("Skipping hybrid local-agent repair: DATABASE_URL is not configured.");
    return;
  }

  const db = createDb(dbUrl);
  const result = await repairMissingLocalAdapterExecutionLocations(db, process.env);

  if (result.skipped) {
    console.log(
      `Skipping hybrid local-agent repair: default execution location is ${result.defaultExecutionLocation}.`,
    );
    return;
  }

  console.log(
    `Hybrid local-agent repair checked ${result.checked} agents and updated ${result.updated} missing executionLocation values to host.`,
  );
}

void main().catch((error) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(`Hybrid local-agent repair failed: ${message}`);
  process.exit(1);
});
