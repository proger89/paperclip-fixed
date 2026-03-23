import type {
  AdapterAgent,
  AdapterEnvironmentTestResult,
  AdapterExecutionResult,
  AdapterInvocationMeta,
  AdapterRuntime,
} from "./types.js";

export type HostRuntimeCapability = "codex" | "claude" | "browser";
export type HostRuntimePathDirection = "container_to_host" | "host_to_container";

export interface HostRuntimePathMap {
  containerPath: string;
  hostPath: string;
}

export interface HostRuntimeExecuteContext {
  runId: string;
  agent: AdapterAgent;
  runtime: AdapterRuntime;
  config: Record<string, unknown>;
  context: Record<string, unknown>;
  authToken?: string;
}

export interface HostRuntimeExecuteRequest {
  adapterType: "codex_local" | "claude_local";
  paperclipApiUrl?: string | null;
  ctx: HostRuntimeExecuteContext;
}

export type HostRuntimeExecuteEvent =
  | {
      type: "log";
      stream: "stdout" | "stderr";
      chunk: string;
    }
  | {
      type: "meta";
      meta: AdapterInvocationMeta;
    }
  | {
      type: "spawn";
      meta: { pid: number; startedAt: string };
    }
  | {
      type: "result";
      result: AdapterExecutionResult;
    }
  | {
      type: "error";
      errorCode: string;
      message: string;
      detail?: string | null;
    };

export interface HostRuntimeTestEnvironmentRequest {
  companyId: string;
  adapterType: "codex_local" | "claude_local";
  paperclipApiUrl?: string | null;
  config: Record<string, unknown>;
}

export interface HostRuntimeBrowserSessionRequest {
  runId: string;
  workspaceCwd: string;
  browserConfig: Record<string, unknown>;
}

export interface HostRuntimeBrowserSessionResponse {
  id: string;
  wsEndpoint: string | null;
  cdpUrl: string | null;
  url: string | null;
  managed: boolean;
}

export interface HostRuntimeHealthResponse {
  ok: true;
  version: string;
  platform: NodeJS.Platform;
  capabilities: Record<HostRuntimeCapability, boolean>;
  pathMaps: HostRuntimePathMap[];
}

type TranslatePathOptions = {
  throwOnUnmapped?: boolean;
  platform?: NodeJS.Platform;
};

type TranslateStructureOptions = TranslatePathOptions & {
  currentKey?: string | null;
};

const JSON_KEY_RE = /json$/i;
const PATH_KEY_RE =
  /(cwd|path|paths|root|roots|dir|dirs|home|workspace|worktree|instructionsfile|instructionsroot|agentsmd|code(x)?_home|claude_home|command|executable|script)/i;
const ARG_PATH_KEY_RE = /^(?:args|extraArgs|commandArgs)$/i;
const PATH_ENV_KEY_RE =
  /^(?:PATH|PWD|HOME|TMPDIR|TEMP|TMP|CODEX_HOME|CLAUDE_HOME|AGENT_HOME|PAPERCLIP_.*(?:CWD|PATH|DIR|HOME|ROOT))$/i;
const URL_LIKE_RE = /^[a-z][a-z0-9+.-]*:\/\//i;
const WINDOWS_ABS_RE = /^[a-zA-Z]:[\\/]/;
const WINDOWS_UNC_RE = /^\\\\/;

function normalizeSlashes(value: string) {
  return value.replaceAll("\\", "/");
}

function normalizeForCompare(value: string, platform: NodeJS.Platform) {
  const normalized = normalizeSlashes(value).replace(/\/+$/, "") || "/";
  return platform === "win32" ? normalized.toLowerCase() : normalized;
}

function isPathBoundary(value: string, prefixLength: number) {
  if (value.length === prefixLength) return true;
  const next = value[prefixLength];
  return next === "/" || next === "\\";
}

function defaultPlatformForDirection(direction: HostRuntimePathDirection): NodeJS.Platform {
  return direction === "container_to_host" ? process.platform : "linux";
}

function looksLikeAbsolutePath(value: string) {
  if (!value.trim()) return false;
  if (URL_LIKE_RE.test(value)) return false;
  return value.startsWith("/") || value.startsWith("~/") || WINDOWS_ABS_RE.test(value) || WINDOWS_UNC_RE.test(value);
}

function looksLikeAbsolutePathArg(value: string) {
  if (WINDOWS_ABS_RE.test(value) || WINDOWS_UNC_RE.test(value) || value.startsWith("~/")) return true;
  if (!value.startsWith("/")) return false;
  return value.includes("/", 1);
}

function shouldTranslateString(key: string | null | undefined, value: string) {
  if (!key) return false;
  if (ARG_PATH_KEY_RE.test(key)) return looksLikeAbsolutePathArg(value);
  if (!looksLikeAbsolutePath(value)) return false;
  if (PATH_ENV_KEY_RE.test(key)) return true;
  if (PATH_KEY_RE.test(key)) return true;
  return false;
}

function tryParseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export function parseHostRuntimePathMap(raw: string): HostRuntimePathMap {
  const separatorIndex = raw.indexOf("=");
  if (separatorIndex <= 0 || separatorIndex >= raw.length - 1) {
    throw new Error(`Invalid path map "${raw}". Expected containerPath=hostPath.`);
  }
  const containerPath = raw.slice(0, separatorIndex).trim();
  const hostPath = raw.slice(separatorIndex + 1).trim();
  if (!containerPath || !hostPath) {
    throw new Error(`Invalid path map "${raw}". Expected containerPath=hostPath.`);
  }
  return { containerPath, hostPath };
}

export function translateMappedPath(
  value: string,
  maps: HostRuntimePathMap[],
  direction: HostRuntimePathDirection,
  options: TranslatePathOptions = {},
): string {
  const throwOnUnmapped = options.throwOnUnmapped ?? false;
  const platform = options.platform ?? defaultPlatformForDirection(direction);
  const mapped = maps
    .map((entry) =>
      direction === "container_to_host"
        ? { from: entry.containerPath, to: entry.hostPath }
        : { from: entry.hostPath, to: entry.containerPath },
    )
    .sort((left, right) => right.from.length - left.from.length);

  const normalizedValue = normalizeForCompare(value, platform);
  for (const entry of mapped) {
    const normalizedFrom = normalizeForCompare(entry.from, platform);
    if (!normalizedValue.startsWith(normalizedFrom)) continue;
    if (!isPathBoundary(value, entry.from.replace(/\/+$/, "").replace(/\\+$/, "").length)) continue;
    const suffix = value.slice(entry.from.length).replace(/^[/\\]+/, "");
    if (!suffix) return entry.to;
    if (entry.to.endsWith("/") || entry.to.endsWith("\\")) {
      return `${entry.to}${suffix}`;
    }
    const separator = entry.to.includes("\\") ? "\\" : "/";
    return `${entry.to}${separator}${suffix}`;
  }

  if (throwOnUnmapped && looksLikeAbsolutePath(value)) {
    throw new Error(`Path "${value}" is outside configured host-runtime path maps.`);
  }
  return value;
}

export function translatePathBearingValue<T>(
  value: T,
  maps: HostRuntimePathMap[],
  direction: HostRuntimePathDirection,
  options: TranslateStructureOptions = {},
): T {
  if (typeof value === "string") {
    const currentKey = options.currentKey ?? null;
    if (currentKey && JSON_KEY_RE.test(currentKey)) {
      const parsed = tryParseJson(value);
      if (parsed !== null) {
        return JSON.stringify(
          translatePathBearingValue(parsed, maps, direction, {
            ...options,
            currentKey: null,
          }),
        ) as T;
      }
    }
    if (shouldTranslateString(currentKey, value)) {
      return translateMappedPath(value, maps, direction, options) as T;
    }
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((entry) =>
      translatePathBearingValue(entry, maps, direction, {
        ...options,
        currentKey: options.currentKey ?? null,
      }),
    ) as T;
  }

  if (value && typeof value === "object") {
    const next: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      next[key] = translatePathBearingValue(entry, maps, direction, {
        ...options,
        currentKey: key,
      });
    }
    return next as T;
  }

  return value;
}

export function injectPaperclipApiUrlIntoConfig(
  config: Record<string, unknown>,
  paperclipApiUrl: string | null | undefined,
) {
  const trimmedApiUrl = typeof paperclipApiUrl === "string" ? paperclipApiUrl.trim() : "";
  if (!trimmedApiUrl) return config;
  const next = { ...config };
  const env = next.env && typeof next.env === "object" && !Array.isArray(next.env)
    ? { ...(next.env as Record<string, unknown>) }
    : {};
  if (typeof env.PAPERCLIP_API_URL !== "string" || !env.PAPERCLIP_API_URL.trim()) {
    env.PAPERCLIP_API_URL = trimmedApiUrl;
  }
  next.env = env;
  return next;
}

export function buildHostRuntimeUnavailableTestResult(input: {
  companyId?: string;
  adapterType: string;
  message: string;
  code: string;
  hint?: string | null;
}): AdapterEnvironmentTestResult {
  return {
    adapterType: input.adapterType,
    status: "fail",
    testedAt: new Date().toISOString(),
    checks: [
      {
        code: input.code,
        level: "error",
        message: input.message,
        ...(input.hint ? { hint: input.hint } : {}),
      },
    ],
  };
}
