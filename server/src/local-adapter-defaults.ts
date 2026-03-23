const LOCAL_ADAPTER_TYPES = new Set([
  "claude_local",
  "codex_local",
  "cursor",
  "gemini_local",
  "opencode_local",
  "pi_local",
]);

export type LocalAdapterExecutionLocation = "container" | "host";

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function isLocalAdapterType(adapterType: string | null | undefined): boolean {
  return typeof adapterType === "string" && LOCAL_ADAPTER_TYPES.has(adapterType);
}

export function listLocalAdapterTypes(): string[] {
  return Array.from(LOCAL_ADAPTER_TYPES);
}

export function resolveDefaultLocalAdapterExecutionLocation(
  env: NodeJS.ProcessEnv = process.env,
): LocalAdapterExecutionLocation {
  return env.PAPERCLIP_LOCAL_ADAPTER_DEFAULT_EXECUTION_LOCATION?.trim() === "host"
    ? "host"
    : "container";
}

export function isHostBridgeConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.PAPERCLIP_HOST_BRIDGE_URL?.trim() && env.PAPERCLIP_HOST_BRIDGE_TOKEN?.trim());
}

export function applyDefaultLocalExecutionLocation(
  adapterType: string | null | undefined,
  adapterConfig: Record<string, unknown>,
  env: NodeJS.ProcessEnv = process.env,
): Record<string, unknown> {
  if (!isLocalAdapterType(adapterType)) return adapterConfig;

  const current = asNonEmptyString(adapterConfig.executionLocation);
  if (current === "host" || current === "container") return adapterConfig;

  return {
    ...adapterConfig,
    executionLocation: resolveDefaultLocalAdapterExecutionLocation(env),
  };
}

export function needsLocalExecutionLocationBackfill(
  adapterType: string | null | undefined,
  adapterConfig: unknown,
): boolean {
  if (!isLocalAdapterType(adapterType)) return false;
  const config = asRecord(adapterConfig);
  if (!config) return true;
  const current = asNonEmptyString(config.executionLocation);
  return current !== "host" && current !== "container";
}
