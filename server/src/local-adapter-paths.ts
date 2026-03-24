import {
  translateMappedPath,
  type HostRuntimePathMap,
} from "@paperclipai/adapter-utils";
import { resolvePaperclipHostRuntimePathMaps } from "@paperclipai/adapter-utils/server-utils";
import { logger } from "./middleware/logger.js";
import { isLocalAdapterType } from "./local-adapter-defaults.js";

const WINDOWS_ABS_RE = /^[a-zA-Z]:[\\/]/;
const WINDOWS_UNC_RE = /^\\\\/;
const MANAGED_WORKSPACE_RE = /^\/paperclip\/instances\/[^/]+\/workspaces\/[^/]+(?:\/.*)?$/;

export const LOCAL_ADAPTER_PATH_CONFIG_KEYS = [
  "cwd",
  "instructionsFilePath",
  "instructionsRootPath",
  "agentsMdPath",
] as const;

export type LocalAdapterPathConfigKey = (typeof LOCAL_ADAPTER_PATH_CONFIG_KEYS)[number];

export class LocalAdapterPathValidationError extends Error {
  key: LocalAdapterPathConfigKey;
  pathValue: string;

  constructor(key: LocalAdapterPathConfigKey, pathValue: string, message: string) {
    super(message);
    this.name = "LocalAdapterPathValidationError";
    this.key = key;
    this.pathValue = pathValue;
  }
}

type NormalizeConfigOptions = {
  env?: NodeJS.ProcessEnv;
  companyId?: string | null;
  agentId?: string | null;
  route?: string | null;
};

type RepairConfigOptions = NormalizeConfigOptions & {
  repairSource: "startup" | "runtime_write";
};

type RepairSessionOptions = NormalizeConfigOptions & {
  repairSource: "startup" | "runtime_write";
  adapterType?: string | null;
  sessionId?: string | null;
  taskKey?: string | null;
};

export interface LocalAdapterConfigRepairResult {
  adapterConfig: Record<string, unknown>;
  changed: boolean;
  normalizedKeys: LocalAdapterPathConfigKey[];
  droppedKeys: LocalAdapterPathConfigKey[];
}

export interface TaskSessionPathRepairResult {
  sessionParamsJson: Record<string, unknown> | null;
  sessionDisplayId: string | null;
  changed: boolean;
  cleared: boolean;
  normalizedCwd: boolean;
}

function normalizePathForCompare(value: string) {
  return value.replaceAll("\\", "/").replace(/\/+$/, "").toLowerCase();
}

function containsMappedPrefix(value: string, prefix: string) {
  const normalizedValue = normalizePathForCompare(value);
  const normalizedPrefix = normalizePathForCompare(prefix);
  return normalizedValue === normalizedPrefix || normalizedValue.startsWith(`${normalizedPrefix}/`);
}

function looksLikeWindowsAbsolutePath(value: string) {
  return WINDOWS_ABS_RE.test(value) || WINDOWS_UNC_RE.test(value);
}

function isManagedWorkspaceContainerPath(value: string) {
  return MANAGED_WORKSPACE_RE.test(value.replaceAll("\\", "/"));
}

function reverseMapHostPath(value: string, maps: HostRuntimePathMap[]) {
  try {
    const translated = translateMappedPath(value, maps, "host_to_container", {
      throwOnUnmapped: true,
    });
    return translated === value ? null : translated;
  } catch {
    return null;
  }
}

function isUnmappedHostAbsolutePath(value: string, maps: HostRuntimePathMap[]) {
  if (!looksLikeWindowsAbsolutePath(value)) return false;
  return reverseMapHostPath(value, maps) === null;
}

function logPathRepair(input: {
  companyId?: string | null;
  agentId?: string | null;
  sessionId?: string | null;
  taskKey?: string | null;
  route?: string | null;
  repairSource: "startup" | "runtime_write" | "request";
  key: string;
  originalPath: string;
  normalizedPath?: string | null;
  action: "normalized" | "dropped" | "cleared_session";
}) {
  logger.warn({
    msg: "Local adapter path normalization applied",
    companyId: input.companyId ?? null,
    agentId: input.agentId ?? null,
    sessionId: input.sessionId ?? null,
    taskKey: input.taskKey ?? null,
    route: input.route ?? null,
    repairSource: input.repairSource,
    configKey: input.key,
    originalPath: input.originalPath,
    normalizedPath: input.normalizedPath ?? null,
    action: input.action,
  });
}

export function resolveConfiguredHostRuntimePathMaps(
  env: NodeJS.ProcessEnv = process.env,
): HostRuntimePathMap[] {
  return resolvePaperclipHostRuntimePathMaps(env);
}

export function hostRuntimePathMapsContainExpected(
  expected: HostRuntimePathMap[],
  actual: HostRuntimePathMap[],
): boolean {
  if (expected.length === 0) return true;
  return expected.every((required) =>
    actual.some((candidate) =>
      normalizePathForCompare(candidate.containerPath) === normalizePathForCompare(required.containerPath)
      && normalizePathForCompare(candidate.hostPath) === normalizePathForCompare(required.hostPath),
    ));
}

export function canonicalizeLocalAdapterConfigPathsForPersistence(
  adapterType: string | null | undefined,
  adapterConfig: Record<string, unknown>,
  options: NormalizeConfigOptions = {},
): Record<string, unknown> {
  if (!isLocalAdapterType(adapterType)) return adapterConfig;
  const maps = resolveConfiguredHostRuntimePathMaps(options.env);
  const next: Record<string, unknown> = { ...adapterConfig };

  for (const key of LOCAL_ADAPTER_PATH_CONFIG_KEYS) {
    const rawValue = next[key];
    if (typeof rawValue !== "string") continue;
    const trimmed = rawValue.trim();
    if (!trimmed) {
      next[key] = trimmed;
      continue;
    }

    const mapped = reverseMapHostPath(trimmed, maps);
    const normalized = mapped ?? trimmed;
    if (key === "cwd" && isManagedWorkspaceContainerPath(normalized)) {
      delete next[key];
      logPathRepair({
        companyId: options.companyId,
        agentId: options.agentId,
        route: options.route,
        repairSource: "request",
        key,
        originalPath: trimmed,
        normalizedPath: null,
        action: "dropped",
      });
      continue;
    }
    if (mapped) {
      next[key] = mapped;
      logPathRepair({
        companyId: options.companyId,
        agentId: options.agentId,
        route: options.route,
        repairSource: "request",
        key,
        originalPath: trimmed,
        normalizedPath: mapped,
        action: "normalized",
      });
      continue;
    }
    if (isUnmappedHostAbsolutePath(trimmed, maps)) {
      throw new LocalAdapterPathValidationError(
        key,
        trimmed,
        `adapterConfig.${key} points at a host-only path outside configured host-runtime path maps. Remove it, or provide a container-visible path instead.`,
      );
    }
  }

  return next;
}

export function repairPersistedLocalAdapterConfigPaths(
  adapterType: string | null | undefined,
  adapterConfig: unknown,
  options: RepairConfigOptions,
): LocalAdapterConfigRepairResult {
  const config =
    typeof adapterConfig === "object" && adapterConfig !== null && !Array.isArray(adapterConfig)
      ? { ...(adapterConfig as Record<string, unknown>) }
      : {};
  if (!isLocalAdapterType(adapterType)) {
    return {
      adapterConfig: config,
      changed: false,
      normalizedKeys: [],
      droppedKeys: [],
    };
  }

  const maps = resolveConfiguredHostRuntimePathMaps(options.env);
  const normalizedKeys: LocalAdapterPathConfigKey[] = [];
  const droppedKeys: LocalAdapterPathConfigKey[] = [];

  for (const key of LOCAL_ADAPTER_PATH_CONFIG_KEYS) {
    const rawValue = config[key];
    if (typeof rawValue !== "string") continue;
    const trimmed = rawValue.trim();
    if (!trimmed) {
      if (rawValue !== trimmed) {
        config[key] = trimmed;
      }
      continue;
    }
    const mapped = reverseMapHostPath(trimmed, maps);
    const normalized = mapped ?? trimmed;
    if (key === "cwd" && isManagedWorkspaceContainerPath(normalized)) {
      delete config[key];
      droppedKeys.push(key);
      logPathRepair({
        companyId: options.companyId,
        agentId: options.agentId,
        route: options.route,
        repairSource: options.repairSource,
        key,
        originalPath: trimmed,
        normalizedPath: null,
        action: "dropped",
      });
      continue;
    }
    if (!mapped) continue;
    config[key] = mapped;
    normalizedKeys.push(key);
    logPathRepair({
      companyId: options.companyId,
      agentId: options.agentId,
      route: options.route,
      repairSource: options.repairSource,
      key,
      originalPath: trimmed,
      normalizedPath: mapped,
      action: "normalized",
    });
  }

  return {
    adapterConfig: config,
    changed: normalizedKeys.length > 0 || droppedKeys.length > 0,
    normalizedKeys,
    droppedKeys,
  };
}

export function repairTaskSessionPathState(
  sessionParamsJson: Record<string, unknown> | null | undefined,
  sessionDisplayId: string | null | undefined,
  options: RepairSessionOptions,
): TaskSessionPathRepairResult {
  const params =
    typeof sessionParamsJson === "object" && sessionParamsJson !== null && !Array.isArray(sessionParamsJson)
      ? { ...sessionParamsJson }
      : null;
  const currentDisplayId = typeof sessionDisplayId === "string" && sessionDisplayId.trim()
    ? sessionDisplayId
    : null;
  if (!params || !isLocalAdapterType(options.adapterType)) {
    return {
      sessionParamsJson: params,
      sessionDisplayId: currentDisplayId,
      changed: false,
      cleared: false,
      normalizedCwd: false,
    };
  }

  const rawCwd = typeof params.cwd === "string" ? params.cwd.trim() : "";
  if (!rawCwd) {
    return {
      sessionParamsJson: params,
      sessionDisplayId: currentDisplayId,
      changed: false,
      cleared: false,
      normalizedCwd: false,
    };
  }

  const maps = resolveConfiguredHostRuntimePathMaps(options.env);
  const mapped = reverseMapHostPath(rawCwd, maps);
  if (mapped) {
    params.cwd = mapped;
    logPathRepair({
      companyId: options.companyId,
      agentId: options.agentId,
      sessionId: options.sessionId,
      taskKey: options.taskKey,
      route: options.route,
      repairSource: options.repairSource,
      key: "sessionParamsJson.cwd",
      originalPath: rawCwd,
      normalizedPath: mapped,
      action: "normalized",
    });
    return {
      sessionParamsJson: params,
      sessionDisplayId: currentDisplayId,
      changed: true,
      cleared: false,
      normalizedCwd: true,
    };
  }

  if (!isManagedWorkspaceContainerPath(rawCwd) && !isUnmappedHostAbsolutePath(rawCwd, maps)) {
    return {
      sessionParamsJson: params,
      sessionDisplayId: currentDisplayId,
      changed: false,
      cleared: false,
      normalizedCwd: false,
    };
  }

  logPathRepair({
    companyId: options.companyId,
    agentId: options.agentId,
    sessionId: options.sessionId,
    taskKey: options.taskKey,
    route: options.route,
    repairSource: options.repairSource,
    key: "sessionParamsJson.cwd",
    originalPath: rawCwd,
    normalizedPath: null,
    action: "cleared_session",
  });
  return {
    sessionParamsJson: null,
    sessionDisplayId: null,
    changed: true,
    cleared: true,
    normalizedCwd: false,
  };
}

export function isManagedAgentWorkspacePath(value: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  const mapped = reverseMapHostPath(trimmed, resolveConfiguredHostRuntimePathMaps(env));
  return isManagedWorkspaceContainerPath(mapped ?? trimmed);
}

export function isKnownLocalAdapterPathKey(key: string): key is LocalAdapterPathConfigKey {
  return LOCAL_ADAPTER_PATH_CONFIG_KEYS.includes(key as LocalAdapterPathConfigKey);
}

