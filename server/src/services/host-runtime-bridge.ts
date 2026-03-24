import {
  type AdapterEnvironmentTestResult,
  type AdapterExecutionContext,
  type AdapterExecutionResult,
  type AdapterInvocationMeta,
  type HostRuntimeHealthResponse,
  type HostRuntimeBrowserSessionRequest,
  type HostRuntimeBrowserSessionResponse,
  type HostRuntimeExecuteEvent,
  buildHostRuntimeUnavailableTestResult,
} from "@paperclipai/adapter-utils";
import { buildPaperclipEnv } from "@paperclipai/adapter-utils/server-utils";
import {
  hostRuntimePathMapsContainExpected,
  resolveConfiguredHostRuntimePathMaps,
} from "../local-adapter-paths.js";

const activeExecutions = new Map<string, AbortController>();
const HOST_BRIDGE_LOG_QUEUE_MAX = 64;
const HOST_BRIDGE_COALESCED_LOG_MAX_CHARS = 256 * 1024;
const HOST_BRIDGE_COALESCED_WARNING =
  "[paperclip] Host bridge log consumer lagged; some live log chunks were coalesced.\n";

type BridgeErrorCode =
  | "host_bridge_unavailable"
  | "host_bridge_auth_failed"
  | "host_browser_unavailable"
  | "host_bridge_path_map_mismatch"
  | "host_bridge_unmapped_path"
  | "host_bridge_bad_response";

class HostRuntimeBridgeError extends Error {
  code: BridgeErrorCode;

  constructor(code: BridgeErrorCode, message: string) {
    super(message);
    this.name = "HostRuntimeBridgeError";
    this.code = code;
  }
}

function readBridgeConfig() {
  const baseUrl = process.env.PAPERCLIP_HOST_BRIDGE_URL?.trim() ?? "";
  const token = process.env.PAPERCLIP_HOST_BRIDGE_TOKEN?.trim() ?? "";
  return {
    baseUrl,
    token,
    configured: baseUrl.length > 0 && token.length > 0,
  };
}

function isExecutionLocationHost(config: Record<string, unknown>) {
  return typeof config.executionLocation === "string" && config.executionLocation.trim() === "host";
}

async function parseJsonResponse(response: Response) {
  const text = await response.text();
  if (!text.trim()) return {};
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { error: text };
  }
}

async function bridgeFetch(path: string, init: RequestInit = {}) {
  const bridge = readBridgeConfig();
  if (!bridge.configured) {
    throw new HostRuntimeBridgeError(
      "host_bridge_unavailable",
      "Host runtime bridge is not configured. Set PAPERCLIP_HOST_BRIDGE_URL and PAPERCLIP_HOST_BRIDGE_TOKEN.",
    );
  }

  let response: Response;
  try {
    response = await fetch(new URL(path, bridge.baseUrl), {
      ...init,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${bridge.token}`,
        ...(init.headers ?? {}),
      },
    });
  } catch (err) {
    throw new HostRuntimeBridgeError(
      "host_bridge_unavailable",
      err instanceof Error ? err.message : "Host runtime bridge is unreachable.",
    );
  }

  if (response.status === 401 || response.status === 403) {
    const body = await parseJsonResponse(response);
    throw new HostRuntimeBridgeError(
      "host_bridge_auth_failed",
      typeof body.error === "string" && body.error.trim()
        ? body.error.trim()
        : "Host runtime bridge rejected authentication.",
    );
  }

  return response;
}

async function readBridgeHealth() {
  const response = await bridgeFetch("/health", {
    method: "GET",
    headers: {
      accept: "application/json",
    },
  });
  if (!response.ok) {
    const body = await parseJsonResponse(response);
    throw new HostRuntimeBridgeError(
      "host_bridge_bad_response",
      typeof body.error === "string" && body.error.trim()
        ? body.error.trim()
        : `Host runtime bridge health returned ${response.status}.`,
    );
  }
  const health = await response.json() as HostRuntimeHealthResponse;
  const expectedMaps = resolveConfiguredHostRuntimePathMaps();
  if (
    expectedMaps.length > 0
    && !hostRuntimePathMapsContainExpected(expectedMaps, Array.isArray(health.pathMaps) ? health.pathMaps : [])
  ) {
    throw new HostRuntimeBridgeError(
      "host_bridge_path_map_mismatch",
      "Host runtime bridge path maps do not match PAPERCLIP_HOST_RUNTIME_PATH_MAPS. Restart the bridge with the same /paperclip and /app mappings configured on the server.",
    );
  }
  return health;
}

function derivePaperclipApiUrl(ctx: Pick<AdapterExecutionContext, "agent">) {
  return buildPaperclipEnv(ctx.agent, { apiTarget: "agent" }).PAPERCLIP_API_URL;
}

function buildHostModeFailureResult(error: HostRuntimeBridgeError): AdapterExecutionResult {
  return {
    exitCode: null,
    signal: null,
    timedOut: false,
    errorCode: error.code,
    errorMessage: error.message,
  };
}

function appendWithCap(current: string, chunk: string, cap: number) {
  const combined = current + chunk;
  return combined.length > cap ? combined.slice(combined.length - cap) : combined;
}

async function readNdjsonStream(
  response: Response,
  handlers: {
    onLog: AdapterExecutionContext["onLog"];
    onMeta?: AdapterExecutionContext["onMeta"];
    onSpawn?: AdapterExecutionContext["onSpawn"];
  },
): Promise<AdapterExecutionResult> {
  if (!response.body) {
    throw new HostRuntimeBridgeError(
      "host_bridge_bad_response",
      "Host runtime bridge returned an empty response body.",
    );
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result: AdapterExecutionResult | null = null;
  let readerDone = false;
  let queueLagged = false;
  let fatalBridgeError: HostRuntimeBridgeError | null = null;
  let notifyConsumer: (() => void) | null = null;
  const queuedEvents: Array<
    | { type: "log"; stream: "stdout" | "stderr"; chunk: string }
    | { type: "meta"; meta: AdapterInvocationMeta }
    | { type: "spawn"; meta: { pid: number; startedAt: string } }
  > = [];
  let coalescedStdout = "";
  let coalescedStderr = "";

  const wakeConsumer = () => {
    const resolver = notifyConsumer;
    notifyConsumer = null;
    resolver?.();
  };

  const waitForConsumer = () => new Promise<void>((resolve) => {
    notifyConsumer = resolve;
  });

  const enqueueLog = (stream: "stdout" | "stderr", chunk: string) => {
    if (queuedEvents.length >= HOST_BRIDGE_LOG_QUEUE_MAX) {
      queueLagged = true;
      if (stream === "stdout") {
        coalescedStdout = appendWithCap(coalescedStdout, chunk, HOST_BRIDGE_COALESCED_LOG_MAX_CHARS);
      } else {
        coalescedStderr = appendWithCap(coalescedStderr, chunk, HOST_BRIDGE_COALESCED_LOG_MAX_CHARS);
      }
      return;
    }
    queuedEvents.push({ type: "log", stream, chunk });
    wakeConsumer();
  };

  const enqueueMeta = (meta: AdapterInvocationMeta) => {
    queuedEvents.push({ type: "meta", meta });
    wakeConsumer();
  };

  const enqueueSpawn = (meta: { pid: number; startedAt: string }) => {
    queuedEvents.push({ type: "spawn", meta });
    wakeConsumer();
  };

  const flushCoalescedLogs = async () => {
    if (!queueLagged) return;
    queueLagged = false;
    await handlers.onLog("stderr", HOST_BRIDGE_COALESCED_WARNING);
    if (coalescedStdout) {
      await handlers.onLog("stdout", coalescedStdout);
      coalescedStdout = "";
    }
    if (coalescedStderr) {
      await handlers.onLog("stderr", coalescedStderr);
      coalescedStderr = "";
    }
  };

  const consumer = (async () => {
    while (true) {
      if (queuedEvents.length === 0) {
        if (readerDone) break;
        await waitForConsumer();
        continue;
      }
      const next = queuedEvents.shift();
      if (!next) continue;
      if (next.type === "log") {
        await handlers.onLog(next.stream, next.chunk);
      } else if (next.type === "meta") {
        await handlers.onMeta?.(next.meta);
      } else {
        await handlers.onSpawn?.(next.meta);
      }
    }
    await flushCoalescedLogs();
  })();

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
    let newlineIndex = buffer.indexOf("\n");
    while (newlineIndex >= 0) {
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);
      if (line) {
        let event: HostRuntimeExecuteEvent;
        try {
          event = JSON.parse(line) as HostRuntimeExecuteEvent;
        } catch {
          readerDone = true;
          wakeConsumer();
          throw new HostRuntimeBridgeError(
            "host_bridge_bad_response",
            "Host runtime bridge returned invalid NDJSON.",
          );
        }
        if (event.type === "log") {
          enqueueLog(event.stream, event.chunk);
        } else if (event.type === "meta") {
          enqueueMeta(event.meta as AdapterInvocationMeta);
        } else if (event.type === "spawn") {
          enqueueSpawn(event.meta);
        } else if (event.type === "error") {
          fatalBridgeError = new HostRuntimeBridgeError(
            event.errorCode === "host_browser_unavailable"
              ? "host_browser_unavailable"
              : "host_bridge_bad_response",
            event.message,
          );
          readerDone = true;
          wakeConsumer();
          break;
        } else if (event.type === "result") {
          result = event.result;
        }
      }
      if (fatalBridgeError) break;
      newlineIndex = buffer.indexOf("\n");
    }

    if (done) break;
    if (fatalBridgeError) break;
  }
  readerDone = true;
  wakeConsumer();
  await consumer;

  if (fatalBridgeError) {
    throw fatalBridgeError;
  }

  if (!result) {
    throw new HostRuntimeBridgeError(
      "host_bridge_bad_response",
      "Host runtime bridge finished without returning a result.",
    );
  }

  return result;
}

export function hostRuntimeExecutionRequested(config: Record<string, unknown>) {
  return isExecutionLocationHost(config);
}

export async function executeViaHostRuntimeBridge(
  adapterType: "codex_local" | "claude_local",
  ctx: AdapterExecutionContext,
): Promise<AdapterExecutionResult> {
  const controller = new AbortController();
  activeExecutions.set(ctx.runId, controller);
  try {
    await readBridgeHealth();
    const response = await bridgeFetch("/v1/execute", {
      method: "POST",
      signal: controller.signal,
      body: JSON.stringify({
        adapterType,
        paperclipApiUrl: derivePaperclipApiUrl(ctx),
        ctx: {
          runId: ctx.runId,
          agent: ctx.agent,
          runtime: ctx.runtime,
          config: ctx.config,
          context: ctx.context,
          authToken: ctx.authToken,
        },
      }),
    });
    if (!response.ok) {
      const body = await parseJsonResponse(response);
      const message =
        typeof body.error === "string" && body.error.trim()
          ? body.error.trim()
          : `Host runtime bridge returned ${response.status}.`;
      throw new HostRuntimeBridgeError(
        /outside configured host-runtime path maps/i.test(message)
          ? "host_bridge_unmapped_path"
          : "host_bridge_bad_response",
        message,
      );
    }
    return await readNdjsonStream(response, {
      onLog: ctx.onLog,
      onMeta: ctx.onMeta,
      onSpawn: ctx.onSpawn,
    });
  } catch (err) {
    if (err instanceof HostRuntimeBridgeError) {
      return buildHostModeFailureResult(err);
    }
    if (err instanceof Error && err.name === "AbortError") {
      return {
        exitCode: null,
        signal: "SIGTERM",
        timedOut: false,
        errorCode: "host_bridge_unavailable",
        errorMessage: "Host runtime bridge execution was interrupted.",
      };
    }
    return {
      exitCode: null,
      signal: null,
      timedOut: false,
      errorCode: "host_bridge_unavailable",
      errorMessage: err instanceof Error ? err.message : String(err),
    };
  } finally {
    activeExecutions.delete(ctx.runId);
  }
}

export async function testEnvironmentViaHostRuntimeBridge(input: {
  companyId: string;
  adapterType: "codex_local" | "claude_local";
  config: Record<string, unknown>;
}): Promise<AdapterEnvironmentTestResult> {
  try {
    await readBridgeHealth();
    const response = await bridgeFetch("/v1/test-environment", {
      method: "POST",
      body: JSON.stringify({
        companyId: input.companyId,
        adapterType: input.adapterType,
        config: input.config,
        paperclipApiUrl: buildPaperclipEnv({
          id: "bridge-envtest-agent",
          companyId: input.companyId,
        }, { apiTarget: "agent" }).PAPERCLIP_API_URL,
      }),
    });
    if (!response.ok) {
      const body = await parseJsonResponse(response);
      const message =
        typeof body.error === "string" && body.error.trim()
          ? body.error.trim()
          : `Host runtime bridge returned ${response.status}.`;
      return buildHostRuntimeUnavailableTestResult({
        adapterType: input.adapterType,
        code: /outside configured host-runtime path maps/i.test(message)
          ? "host_bridge_unmapped_path"
          : "host_runtime_test_failed",
        message,
      });
    }
    return await response.json() as AdapterEnvironmentTestResult;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const code =
      err instanceof HostRuntimeBridgeError
        ? err.code === "host_bridge_auth_failed"
          ? "host_bridge_auth_failed"
          : err.code === "host_bridge_path_map_mismatch"
            ? "host_bridge_path_map_mismatch"
            : err.code === "host_bridge_unmapped_path"
              ? "host_bridge_unmapped_path"
              : "host_bridge_unavailable"
        : "host_bridge_unavailable";
    return buildHostRuntimeUnavailableTestResult({
      adapterType: input.adapterType,
      code,
      message,
      hint:
        code === "host_bridge_auth_failed"
          ? "Check PAPERCLIP_HOST_BRIDGE_TOKEN on both the server container and host bridge."
          : "Start `paperclipai host-runtime serve` and make sure PAPERCLIP_HOST_BRIDGE_URL points to it.",
    });
  }
}

export async function cancelHostRuntimeExecution(runId: string) {
  const controller = activeExecutions.get(runId);
  if (controller) {
    controller.abort();
  }
  try {
    const response = await bridgeFetch(`/v1/executions/${encodeURIComponent(runId)}/cancel`, {
      method: "POST",
    });
    if (!response.ok) return false;
    const body = await parseJsonResponse(response);
    return body.cancelled === true;
  } catch {
    return false;
  }
}

export async function createHostBrowserSession(input: {
  runId: string;
  workspaceCwd: string;
  browserConfig: Record<string, unknown>;
}): Promise<HostRuntimeBrowserSessionResponse> {
  const response = await bridgeFetch("/v1/browser-sessions", {
    method: "POST",
    body: JSON.stringify({
      runId: input.runId,
      workspaceCwd: input.workspaceCwd,
      browserConfig: input.browserConfig,
    } satisfies HostRuntimeBrowserSessionRequest),
  });
  if (!response.ok) {
    const body = await parseJsonResponse(response);
    throw new HostRuntimeBridgeError(
      response.status === 503 ? "host_browser_unavailable" : "host_bridge_bad_response",
      typeof body.error === "string" && body.error.trim()
        ? body.error.trim()
        : `Host runtime bridge returned ${response.status}.`,
    );
  }
  return await response.json() as HostRuntimeBrowserSessionResponse;
}

export async function destroyHostBrowserSession(id: string) {
  try {
    const response = await bridgeFetch(`/v1/browser-sessions/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    return response.ok;
  } catch {
    return false;
  }
}

export function hostBrowserFailureResult(message: string): AdapterExecutionResult {
  return {
    exitCode: null,
    signal: null,
    timedOut: false,
    errorCode: "host_browser_unavailable",
    errorMessage: message,
  };
}
