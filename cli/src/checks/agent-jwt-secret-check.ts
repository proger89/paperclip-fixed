import {
  ensureAgentJwtSecret,
  readAgentJwtSecretFromEnv,
  readAgentJwtSecretFromEnvFile,
  readPaperclipEnvEntries,
  resolveAgentJwtEnvFile,
} from "../config/env.js";
import type { CheckResult } from "./index.js";

export function agentJwtSecretCheck(configPath?: string): CheckResult {
  const betterAuthSecret = process.env.BETTER_AUTH_SECRET?.trim();
  if (betterAuthSecret) {
    return {
      name: "Agent JWT secret",
      status: "pass",
      message: "BETTER_AUTH_SECRET is set; local agent JWT signing will reuse it",
    };
  }

  if (readAgentJwtSecretFromEnv(configPath)) {
    return {
      name: "Agent JWT secret",
      status: "pass",
      message: "PAPERCLIP_AGENT_JWT_SECRET is set in environment",
    };
  }

  const envPath = resolveAgentJwtEnvFile(configPath);
  const fileSecret = readAgentJwtSecretFromEnvFile(envPath);
  const fileEntries = readPaperclipEnvEntries(envPath);
  const fileBetterAuthSecret =
    typeof fileEntries.BETTER_AUTH_SECRET === "string" && fileEntries.BETTER_AUTH_SECRET.trim().length > 0
      ? fileEntries.BETTER_AUTH_SECRET.trim()
      : null;

  if (fileSecret) {
    return {
      name: "Agent JWT secret",
      status: "warn",
      message: `PAPERCLIP_AGENT_JWT_SECRET is present in ${envPath} but not loaded into environment`,
      repairHint: `Set the value from ${envPath} in your shell before starting the Paperclip server`,
    };
  }
  if (fileBetterAuthSecret) {
    return {
      name: "Agent JWT secret",
      status: "warn",
      message: `BETTER_AUTH_SECRET is present in ${envPath} but not loaded into environment`,
      repairHint: `Set the value from ${envPath} in your shell before starting the Paperclip server`,
    };
  }

  return {
    name: "Agent JWT secret",
    status: "fail",
    message: `PAPERCLIP_AGENT_JWT_SECRET and BETTER_AUTH_SECRET are missing from environment and ${envPath}`,
    canRepair: true,
    repair: () => {
      ensureAgentJwtSecret(configPath);
    },
    repairHint: `Run with --repair to create ${envPath} containing PAPERCLIP_AGENT_JWT_SECRET, or set BETTER_AUTH_SECRET before starting Paperclip`,
  };
}
