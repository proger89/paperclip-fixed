import { spawn, spawnSync } from "node:child_process";

const INTERNAL_PORT = process.env.PORT?.trim() || "3100";
const INTERNAL_HEALTH_URL = `http://127.0.0.1:${INTERNAL_PORT}/api/health`;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizePublicBaseUrl() {
  const raw = process.env.PAPERCLIP_PUBLIC_URL?.trim();
  if (raw) return raw.replace(/\/+$/, "");
  return `http://localhost:${INTERNAL_PORT}`;
}

function maybeAutoLoginCodex() {
  if ((process.env.PAPERCLIP_AUTO_LOGIN_CODEX ?? "true") !== "true") return;

  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) return;

  const status = spawnSync("codex", ["login", "status"], {
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env,
    encoding: "utf8",
  });
  if (status.status === 0) return;

  const login = spawnSync("codex", ["login", "--with-api-key"], {
    stdio: ["pipe", "inherit", "inherit"],
    input: `${apiKey}\n`,
    env: process.env,
    encoding: "utf8",
  });
  if (login.status !== 0) {
    console.error("Codex auto-login failed inside docker entrypoint.");
  }
}

async function assertAuthenticatedRuntimeBuild() {
  const deploymentMode = (process.env.PAPERCLIP_DEPLOYMENT_MODE ?? "").trim();
  const betterAuthSecret = process.env.BETTER_AUTH_SECRET?.trim() ?? "";
  const agentJwtSecret = process.env.PAPERCLIP_AGENT_JWT_SECRET?.trim() ?? "";
  if (deploymentMode !== "authenticated" || !betterAuthSecret || agentJwtSecret) return;

  const { createLocalAgentJwt } = await import("../server/dist/agent-auth-jwt.js");
  const token = createLocalAgentJwt(
    "docker-self-test-agent",
    "docker-self-test-company",
    "codex_local",
    "docker-self-test-run",
  );
  if (typeof token !== "string" || token.trim().length === 0) {
    throw new Error(
      "Authenticated Docker runtime self-test failed: server/dist cannot mint local agent JWTs from BETTER_AUTH_SECRET.",
    );
  }
}

function maybeRepairHybridLocalAgents() {
  if ((process.env.PAPERCLIP_LOCAL_ADAPTER_DEFAULT_EXECUTION_LOCATION ?? "").trim() !== "host") return;

  const inlineRepairScript = `
import { createDb } from "./packages/db/src/index.ts";
import { repairMissingLocalAdapterExecutionLocations } from "./server/src/local-adapter-repair.ts";

const db = createDb(process.env.DATABASE_URL);
const result = await repairMissingLocalAdapterExecutionLocations(db, process.env);
console.log(
  "Hybrid local-agent execution-location repair",
  JSON.stringify({
    checked: result.checked,
    updated: result.updated,
    skipped: result.skipped,
    defaultExecutionLocation: result.defaultExecutionLocation,
  }),
);
process.exit(0);
`;
  const result = spawnSync(
    "node",
    [
      "--import",
      "./server/node_modules/tsx/dist/loader.mjs",
      "--input-type=module",
      "-e",
      inlineRepairScript,
    ],
    {
      stdio: "inherit",
      env: process.env,
    },
  );
  if (result.status !== 0) {
    console.error("Hybrid local-agent execution-location repair failed inside docker entrypoint.");
  }
}

function maybeRepairManagedInstructionBundles() {
  const inlineRepairScript = `
import { createDb } from "./packages/db/src/index.ts";
import { repairManagedInstructionBundles } from "./server/src/services/managed-instruction-bundles.ts";

const db = createDb(process.env.DATABASE_URL);
const result = await repairManagedInstructionBundles(db);
console.log(
  "Managed instruction bundle repair",
  JSON.stringify({
    checked: result.checked,
    updated: result.updated,
    repairedLegacy: result.repairedLegacy,
    markedCurrent: result.markedCurrent,
  }),
);
process.exit(0);
`;
  const result = spawnSync(
    "node",
    [
      "--import",
      "./server/node_modules/tsx/dist/loader.mjs",
      "--input-type=module",
      "-e",
      inlineRepairScript,
    ],
    {
      stdio: "inherit",
      env: process.env,
    },
  );
  if (result.status !== 0) {
    console.error("Managed instruction bundle repair failed inside docker entrypoint.");
  }
}

function maybeRepairPersistedLocalAdapterPaths() {
  const inlineRepairScript = `
import { createDb } from "./packages/db/src/index.ts";
import { repairPersistedLocalAdapterPaths } from "./server/src/local-adapter-path-repair.ts";

const db = createDb(process.env.DATABASE_URL);
const result = await repairPersistedLocalAdapterPaths(db, process.env);
console.log(
  "Persisted local-adapter path repair",
  JSON.stringify(result),
);
process.exit(0);
`;
  const result = spawnSync(
    "node",
    [
      "--import",
      "./server/node_modules/tsx/dist/loader.mjs",
      "--input-type=module",
      "-e",
      inlineRepairScript,
    ],
    {
      stdio: "inherit",
      env: process.env,
    },
  );
  if (result.status !== 0) {
    console.error("Persisted local-adapter path repair failed inside docker entrypoint.");
  }
}

async function waitForHealth(serverProcess, timeoutMs = 120_000) {
  const startedAt = Date.now();
  while (!serverProcess.killed && serverProcess.exitCode === null) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error(`Timed out waiting for Paperclip health at ${INTERNAL_HEALTH_URL}`);
    }

    try {
      const response = await fetch(INTERNAL_HEALTH_URL, {
        headers: { accept: "application/json" },
      });
      if (response.ok) {
        return await response.json();
      }
    } catch {
      // Server may still be booting; keep polling.
    }

    await sleep(1_000);
  }

  return null;
}

function maybeCreateBootstrapInvite(health) {
  if ((process.env.PAPERCLIP_AUTO_BOOTSTRAP_CEO ?? "true") !== "true") return;
  if ((process.env.PAPERCLIP_DEPLOYMENT_MODE ?? "").trim() !== "authenticated") return;
  if ((process.env.PAPERCLIP_AUTH_DISABLE_SIGN_UP ?? "false") !== "true") return;
  if (!health || health.bootstrapStatus !== "bootstrap_pending" || health.bootstrapInviteActive) return;

  const publicBaseUrl = normalizePublicBaseUrl();
  const result = spawnSync(
    "node",
    [
      "cli/node_modules/tsx/dist/cli.mjs",
      "cli/src/index.ts",
      "auth",
      "bootstrap-ceo",
      "--base-url",
      publicBaseUrl,
    ],
    {
      stdio: "inherit",
      env: process.env,
    },
  );
  if (result.status !== 0) {
    console.error("Bootstrap CEO invite generation failed inside docker entrypoint.");
  }
}

maybeAutoLoginCodex();
void (async () => {
  try {
    await assertAuthenticatedRuntimeBuild();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exit(1);
  }

  const serverProcess = spawn(
    "node",
    ["--import", "./server/node_modules/tsx/dist/loader.mjs", "server/dist/index.js"],
    {
      stdio: "inherit",
      env: process.env,
    },
  );

  serverProcess.on("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 1);
  });

  const forwardSignal = (signal) => {
    if (serverProcess.exitCode === null && !serverProcess.killed) {
      serverProcess.kill(signal);
    }
  };

  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => forwardSignal(signal));
  }

  try {
    const health = await waitForHealth(serverProcess);
    maybeRepairHybridLocalAgents();
    maybeRepairPersistedLocalAdapterPaths();
    maybeRepairManagedInstructionBundles();
    maybeCreateBootstrapInvite(health);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Docker entrypoint bootstrap check failed: ${message}`);
  }
})();
