import { createDb } from "@paperclipai/db";
import { loadConfig } from "../config.js";
import { windowsEncodingRepairService } from "../services/windows-encoding-repair.js";

function parseArgs(argv: string[]) {
  const parsed: {
    companyId?: string;
    issue?: string;
    runId?: string;
    dryRun: boolean;
  } = {
    dryRun: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    switch (value) {
      case "--company-id":
        parsed.companyId = argv[index + 1];
        index += 1;
        break;
      case "--issue":
        parsed.issue = argv[index + 1];
        index += 1;
        break;
      case "--run-id":
        parsed.runId = argv[index + 1];
        index += 1;
        break;
      case "--dry-run":
        parsed.dryRun = true;
        break;
      case "--help":
      case "-h":
        console.log(
          [
            "Usage: tsx src/scripts/repair-windows-encoding.ts [options]",
            "",
            "Options:",
            "  --company-id <id>   Limit to one company",
            "  --issue <id|key>    Limit to one issue UUID or identifier (e.g. TEL-2)",
            "  --run-id <id>       Limit to one heartbeat run",
            "  --dry-run           Report only; do not write changes",
          ].join("\n"),
        );
        process.exit(0);
        break;
      default:
        throw new Error(`Unknown argument: ${value}`);
    }
  }
  return parsed;
}

function resolveConnectionString() {
  const config = loadConfig();
  if (config.databaseUrl?.trim()) return config.databaseUrl.trim();
  return `postgres://paperclip:paperclip@127.0.0.1:${config.embeddedPostgresPort}/paperclip`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const db = createDb(resolveConnectionString());
  const closableDb = db as typeof db & {
    $client?: {
      end?: (options?: { timeout?: number }) => Promise<void>;
    };
  };

  try {
    const looksLikeUuid = !!args.issue && /^[0-9a-f-]{36}$/i.test(args.issue);
    const report = await windowsEncodingRepairService(db).repair({
      companyId: args.companyId ?? null,
      issueId: looksLikeUuid ? args.issue : null,
      issueIdentifier: looksLikeUuid ? null : (args.issue ?? null),
      runId: args.runId ?? null,
      dryRun: args.dryRun,
    });
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await closableDb.$client?.end?.({ timeout: 5000 }).catch(() => undefined);
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
