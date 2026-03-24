import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { URL } from "node:url";
import {
  type AdapterEnvironmentTestResult,
  type AdapterExecutionResult,
  type AdapterInvocationMeta,
  type HostRuntimeBrowserSessionRequest,
  type HostRuntimeBrowserSessionResponse,
  type HostRuntimeCapability,
  type HostRuntimeExecuteContext,
  type HostRuntimeExecuteEvent,
  type HostRuntimeExecuteRequest,
  type HostRuntimeHealthResponse,
  type HostRuntimePathMap,
  type HostRuntimeTestEnvironmentRequest,
  buildHostRuntimeUnavailableTestResult,
  injectPaperclipApiUrlIntoConfig,
  parseHostRuntimePathMap,
  translatePathBearingValue,
} from "@paperclipai/adapter-utils";
import { runningProcesses } from "@paperclipai/adapter-utils/server-utils";
import {
  execute as claudeExecute,
  testEnvironment as claudeTestEnvironment,
} from "@paperclipai/adapter-claude-local/server";
import {
  execute as codexExecute,
  testEnvironment as codexTestEnvironment,
} from "@paperclipai/adapter-codex-local/server";

type HostRuntimeServeOptions = {
  listen?: string;
  token?: string;
  pathMap?: string[] | string;
  capability?: string[] | string;
};

type BrowserSessionRecord = {
  id: string;
  managed: boolean;
  wsEndpoint: string | null;
  cdpUrl: string | null;
  url: string | null;
  close: (() => Promise<void>) | null;
};

const CONTROL_PLANE_PREFLIGHT_TIMEOUT_MS = 15_000;

function parseListenAddress(raw: string | undefined) {
  const value = (raw?.trim() || "127.0.0.1:4243").trim();
  const ipv6Match = value.match(/^\[([^\]]+)\]:(\d+)$/);
  if (ipv6Match) {
    return {
      host: ipv6Match[1]!,
      port: Number(ipv6Match[2]),
    };
  }
  const idx = value.lastIndexOf(":");
  if (idx <= 0) {
    throw new Error(`Invalid listen address "${value}". Expected host:port.`);
  }
  const host = value.slice(0, idx).trim();
  const port = Number(value.slice(idx + 1).trim());
  if (!host || !Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`Invalid listen address "${value}". Expected host:port.`);
  }
  return { host, port };
}

function parseRepeatedOption(value: string[] | string | undefined) {
  if (Array.isArray(value)) return value.flatMap((entry) => entry.split(",")).map((entry) => entry.trim()).filter(Boolean);
  if (typeof value === "string") return value.split(",").map((entry) => entry.trim()).filter(Boolean);
  return [];
}

function parseCapabilities(input: string[] | string | undefined): Set<HostRuntimeCapability> {
  const raw = parseRepeatedOption(input);
  if (raw.length === 0) {
    return new Set<HostRuntimeCapability>(["codex", "claude", "browser"]);
  }
  const next = new Set<HostRuntimeCapability>();
  for (const entry of raw) {
    if (entry === "codex" || entry === "claude" || entry === "browser") {
      next.add(entry);
      continue;
    }
    throw new Error(`Unknown host-runtime capability "${entry}".`);
  }
  return next;
}

function parsePathMaps(input: string[] | string | undefined) {
  return parseRepeatedOption(input).map((entry) => parseHostRuntimePathMap(entry));
}

function writeJson(res: ServerResponse, statusCode: number, body: unknown) {
  res.statusCode = statusCode;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

async function readJsonBody(req: IncomingMessage) {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > 10 * 1024 * 1024) {
      throw new Error("Request body exceeds 10MB limit.");
    }
    chunks.push(buffer);
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new Error("Request body is not valid JSON.");
  }
}

function requireAuth(req: IncomingMessage, token: string) {
  const auth = req.headers.authorization?.trim() ?? "";
  return auth === `Bearer ${token}`;
}

async function sendNdjsonEvent(res: ServerResponse, event: HostRuntimeExecuteEvent) {
  if (res.destroyed || res.writableEnded) return;
  const payload = `${JSON.stringify(event)}\n`;
  const wrote = res.write(payload);
  if (wrote || res.destroyed || res.writableEnded) return;
  await new Promise<void>((resolve) => {
    const cleanup = () => {
      res.off("drain", handleDrain);
      res.off("close", handleClose);
      res.off("error", handleClose);
    };
    const handleDrain = () => {
      cleanup();
      resolve();
    };
    const handleClose = () => {
      cleanup();
      resolve();
    };
    res.on("drain", handleDrain);
    res.on("close", handleClose);
    res.on("error", handleClose);
  });
}

async function cancelHostedRun(runId: string) {
  const running = runningProcesses.get(runId);
  if (!running) return false;
  try {
    running.child.kill("SIGTERM");
  } catch {
    // ignore
  }
  const graceMs = Math.max(1, running.graceSec) * 1000;
  setTimeout(() => {
    const current = runningProcesses.get(runId);
    if (!current) return;
    try {
      current.child.kill("SIGKILL");
    } catch {
      // ignore
    }
  }, graceMs).unref?.();
  return true;
}

function ensureCapability(capabilities: Set<HostRuntimeCapability>, capability: HostRuntimeCapability, message: string) {
  if (capabilities.has(capability)) return;
  throw new Error(message);
}

function translateExecuteContext(ctx: HostRuntimeExecuteContext, maps: HostRuntimePathMap[], paperclipApiUrl?: string | null) {
  const normalizedPaperclipApiUrl = rewriteWindowsLoopbackHostname(paperclipApiUrl);
  const nextConfig = injectPaperclipApiUrlIntoConfig(
    translatePathBearingValue(ctx.config, maps, "container_to_host", {
      throwOnUnmapped: true,
    }),
    normalizedPaperclipApiUrl,
  );
  return {
    ...ctx,
    config: nextConfig,
    runtime: translatePathBearingValue(ctx.runtime, maps, "container_to_host", {
      throwOnUnmapped: true,
    }),
    context: translatePathBearingValue(ctx.context, maps, "container_to_host", {
      throwOnUnmapped: true,
    }),
  };
}

function translateExecutionResult(result: AdapterExecutionResult, maps: HostRuntimePathMap[]) {
  return translatePathBearingValue(result, maps, "host_to_container") as AdapterExecutionResult;
}

function translateInvocationMeta(meta: Record<string, unknown>, maps: HostRuntimePathMap[]) {
  return translatePathBearingValue(meta, maps, "host_to_container") as Record<string, unknown>;
}

function normalizeApiBaseUrl(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  return trimmed.replace(/\/+$/, "");
}

function rewriteWindowsLoopbackHostname(raw: string | null | undefined, platform = process.platform): string | null {
  const baseUrl = normalizeApiBaseUrl(raw);
  if (!baseUrl) return null;
  if (platform !== "win32") return baseUrl;

  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    return baseUrl;
  }

  if (parsed.hostname.toLowerCase() !== "localhost") return baseUrl;
  parsed.hostname = "127.0.0.1";
  return parsed.toString().replace(/\/+$/, "");
}

function buildControlPlaneFailureResult(
  errorCode: "paperclip_control_plane_unavailable" | "paperclip_control_plane_auth_failed",
  errorMessage: string,
): AdapterExecutionResult {
  return {
    exitCode: null,
    signal: null,
    timedOut: false,
    errorCode,
    errorMessage,
  };
}

async function fetchJsonWithTimeout(url: string, init: RequestInit = {}, timeoutMs = CONTROL_PLANE_PREFLIGHT_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
    });
    const text = await response.text();
    let body: Record<string, unknown> | null = null;
    if (text.trim()) {
      try {
        body = JSON.parse(text) as Record<string, unknown>;
      } catch {
        body = { error: text.trim() };
      }
    }
    return { response, body };
  } finally {
    clearTimeout(timeout);
  }
}

async function preflightPaperclipControlPlane(
  payload: HostRuntimeExecuteRequest,
): Promise<AdapterExecutionResult | null> {
  const baseUrl = rewriteWindowsLoopbackHostname(payload.paperclipApiUrl);
  if (!baseUrl) {
    return buildControlPlaneFailureResult(
      "paperclip_control_plane_unavailable",
      "Host runtime is missing a Paperclip control-plane URL for this run.",
    );
  }

  try {
    const { response, body } = await fetchJsonWithTimeout(`${baseUrl}/api/health`, {
      headers: {
        accept: "application/json",
      },
    });
    if (!response.ok) {
      const detail =
        typeof body?.error === "string" && body.error.trim()
          ? ` ${body.error.trim()}`
          : "";
      return buildControlPlaneFailureResult(
        "paperclip_control_plane_unavailable",
        `Paperclip control plane health check failed at ${baseUrl}/api/health with HTTP ${response.status}.${detail}`.trim(),
      );
    }
  } catch (err) {
    const suffix = err instanceof Error ? `: ${err.message}` : "";
    return buildControlPlaneFailureResult(
      "paperclip_control_plane_unavailable",
      `Paperclip control plane is unreachable at ${baseUrl}/api/health${suffix}`,
    );
  }

  const authToken = payload.ctx.authToken?.trim();
  if (!authToken) return null;

  try {
    const { response, body } = await fetchJsonWithTimeout(`${baseUrl}/api/agents/me`, {
      headers: {
        accept: "application/json",
        authorization: `Bearer ${authToken}`,
      },
    });
    if (response.status === 401 || response.status === 403) {
      const detail =
        typeof body?.error === "string" && body.error.trim()
          ? ` ${body.error.trim()}`
          : "";
      return buildControlPlaneFailureResult(
        "paperclip_control_plane_auth_failed",
        `Paperclip control plane at ${baseUrl} rejected this run's agent auth. Check PAPERCLIP_AGENT_API_URL/PAPERCLIP_PUBLIC_URL and make sure the host runtime points at the correct Paperclip instance.${detail}`.trim(),
      );
    }
    if (!response.ok) {
      const detail =
        typeof body?.error === "string" && body.error.trim()
          ? ` ${body.error.trim()}`
          : "";
      return buildControlPlaneFailureResult(
        "paperclip_control_plane_unavailable",
        `Paperclip control plane agent preflight failed at ${baseUrl}/api/agents/me with HTTP ${response.status}.${detail}`.trim(),
      );
    }
  } catch (err) {
    const suffix = err instanceof Error ? `: ${err.message}` : "";
    return buildControlPlaneFailureResult(
      "paperclip_control_plane_unavailable",
      `Paperclip control plane agent preflight failed at ${baseUrl}/api/agents/me${suffix}`,
    );
  }

  return null;
}

async function runEnvironmentTest(
  payload: HostRuntimeTestEnvironmentRequest,
  maps: HostRuntimePathMap[],
  capabilities: Set<HostRuntimeCapability>,
): Promise<AdapterEnvironmentTestResult> {
  const normalizedPaperclipApiUrl = rewriteWindowsLoopbackHostname(payload.paperclipApiUrl);
  const translatedConfig = injectPaperclipApiUrlIntoConfig(
    translatePathBearingValue(payload.config, maps, "container_to_host", {
      throwOnUnmapped: true,
    }),
    normalizedPaperclipApiUrl,
  );

  if (payload.adapterType === "codex_local") {
    ensureCapability(capabilities, "codex", "Host runtime codex capability is disabled.");
    return codexTestEnvironment({
      companyId: payload.companyId,
      adapterType: payload.adapterType,
      config: translatedConfig,
    });
  }

  if (payload.adapterType === "claude_local") {
    ensureCapability(capabilities, "claude", "Host runtime claude capability is disabled.");
    return claudeTestEnvironment({
      companyId: payload.companyId,
      adapterType: payload.adapterType,
      config: translatedConfig,
    });
  }

  return buildHostRuntimeUnavailableTestResult({
    adapterType: payload.adapterType,
    code: "host_runtime_adapter_unsupported",
    message: `Adapter ${payload.adapterType} is not supported by the host runtime bridge.`,
  });
}

async function executeOnHost(
  payload: HostRuntimeExecuteRequest,
  maps: HostRuntimePathMap[],
  capabilities: Set<HostRuntimeCapability>,
  res: ServerResponse,
) {
  const controlPlanePreflight = await preflightPaperclipControlPlane(payload);
  if (controlPlanePreflight) {
    await sendNdjsonEvent(res, { type: "result", result: controlPlanePreflight });
    return;
  }

  const translatedCtx = translateExecuteContext(payload.ctx, maps, payload.paperclipApiUrl);
  if (payload.adapterType === "codex_local") {
    ensureCapability(capabilities, "codex", "Host runtime codex capability is disabled.");
    const result = await codexExecute({
      ...translatedCtx,
      onLog: async (stream, chunk) => {
        await sendNdjsonEvent(res, { type: "log", stream, chunk });
      },
      onMeta: async (meta) => {
        await sendNdjsonEvent(res, {
          type: "meta",
          meta: translateInvocationMeta(meta as unknown as Record<string, unknown>, maps) as unknown as AdapterInvocationMeta,
        });
      },
      onSpawn: async (meta) => {
        await sendNdjsonEvent(res, { type: "spawn", meta });
      },
    });
    await sendNdjsonEvent(res, { type: "result", result: translateExecutionResult(result, maps) });
    return;
  }

  if (payload.adapterType === "claude_local") {
    ensureCapability(capabilities, "claude", "Host runtime claude capability is disabled.");
    const result = await claudeExecute({
      ...translatedCtx,
      onLog: async (stream, chunk) => {
        await sendNdjsonEvent(res, { type: "log", stream, chunk });
      },
      onMeta: async (meta) => {
        await sendNdjsonEvent(res, {
          type: "meta",
          meta: translateInvocationMeta(meta as unknown as Record<string, unknown>, maps) as unknown as AdapterInvocationMeta,
        });
      },
      onSpawn: async (meta) => {
        await sendNdjsonEvent(res, { type: "spawn", meta });
      },
    });
    await sendNdjsonEvent(res, { type: "result", result: translateExecutionResult(result, maps) });
    return;
  }

  await sendNdjsonEvent(res, {
    type: "error",
    errorCode: "host_runtime_adapter_unsupported",
    message: `Adapter ${payload.adapterType} is not supported by the host runtime bridge.`,
  });
}

async function launchBrowserSession(
  payload: HostRuntimeBrowserSessionRequest,
  maps: HostRuntimePathMap[],
  capabilities: Set<HostRuntimeCapability>,
  browserSessions: Map<string, BrowserSessionRecord>,
): Promise<HostRuntimeBrowserSessionResponse> {
  ensureCapability(capabilities, "browser", "Host runtime browser capability is disabled.");
  const browserConfig = translatePathBearingValue(payload.browserConfig, maps, "container_to_host", {
    throwOnUnmapped: true,
  });
  const wsEndpoint = typeof browserConfig.wsEndpoint === "string" && browserConfig.wsEndpoint.trim()
    ? browserConfig.wsEndpoint.trim()
    : null;
  const cdpUrl = typeof browserConfig.cdpUrl === "string" && browserConfig.cdpUrl.trim()
    ? browserConfig.cdpUrl.trim()
    : null;
  const directUrl = typeof browserConfig.url === "string" && browserConfig.url.trim()
    ? browserConfig.url.trim()
    : null;

  if (wsEndpoint || cdpUrl || directUrl) {
    const id = randomUUID();
    const record: BrowserSessionRecord = {
      id,
      managed: false,
      wsEndpoint,
      cdpUrl,
      url: directUrl,
      close: null,
    };
    browserSessions.set(id, record);
    return {
      id,
      managed: false,
      wsEndpoint,
      cdpUrl,
      url: directUrl,
    };
  }

  const playwrightModule = await import("playwright");
  const browserName =
    typeof browserConfig.browserName === "string" && browserConfig.browserName.trim()
      ? browserConfig.browserName.trim()
      : "chromium";
  const browserType =
    browserName === "webkit"
      ? playwrightModule.webkit
      : browserName === "firefox"
        ? playwrightModule.firefox
        : playwrightModule.chromium;
  const launchOptions =
    browserConfig.launchOptions && typeof browserConfig.launchOptions === "object" && !Array.isArray(browserConfig.launchOptions)
      ? { ...(browserConfig.launchOptions as Record<string, unknown>) }
      : {};
  if (typeof launchOptions.headless !== "boolean") {
    launchOptions.headless = true;
  }
  const server = await browserType.launchServer(launchOptions as Parameters<typeof browserType.launchServer>[0]);
  const id = randomUUID();
  const record: BrowserSessionRecord = {
    id,
    managed: true,
    wsEndpoint: server.wsEndpoint(),
    cdpUrl: null,
    url: null,
    close: async () => {
      await server.close();
    },
  };
  browserSessions.set(id, record);
  return {
    id,
    managed: true,
    wsEndpoint: record.wsEndpoint,
    cdpUrl: record.cdpUrl,
    url: record.url,
  };
}

export async function hostRuntimeServe(opts: HostRuntimeServeOptions): Promise<Server> {
  const token = opts.token?.trim() || process.env.PAPERCLIP_HOST_BRIDGE_TOKEN?.trim() || "";
  if (!token) {
    throw new Error("Host runtime bridge requires --token or PAPERCLIP_HOST_BRIDGE_TOKEN.");
  }
  const { host, port } = parseListenAddress(opts.listen);
  const capabilities = parseCapabilities(opts.capability);
  const pathMaps = parsePathMaps(opts.pathMap);
  const browserSessions = new Map<string, BrowserSessionRecord>();

  const server = createServer(async (req, res) => {
    res.setHeader("cache-control", "no-store");

    if (!requireAuth(req, token)) {
      writeJson(res, 401, { error: "Unauthorized" });
      return;
    }

    const method = req.method ?? "GET";
    const parsedUrl = new URL(req.url ?? "/", "http://host-runtime.local");

    try {
      if (method === "GET" && parsedUrl.pathname === "/health") {
        const body: HostRuntimeHealthResponse = {
          ok: true,
          version: "0.1",
          platform: process.platform,
          capabilities: {
            codex: capabilities.has("codex"),
            claude: capabilities.has("claude"),
            browser: capabilities.has("browser"),
          },
          pathMaps,
        };
        writeJson(res, 200, body);
        return;
      }

      if (method === "POST" && parsedUrl.pathname === "/v1/test-environment") {
        const payload = await readJsonBody(req) as unknown as HostRuntimeTestEnvironmentRequest;
        const result = await runEnvironmentTest(payload, pathMaps, capabilities);
        writeJson(res, 200, result);
        return;
      }

      if (method === "POST" && parsedUrl.pathname === "/v1/execute") {
        const payload = await readJsonBody(req) as unknown as HostRuntimeExecuteRequest;
        res.statusCode = 200;
        res.setHeader("content-type", "application/x-ndjson; charset=utf-8");
        const handleResponseClose = () => {
          if (res.writableEnded || res.writableFinished) return;
          void cancelHostedRun(payload.ctx.runId);
        };
        res.on("close", handleResponseClose);
        try {
          await executeOnHost(payload, pathMaps, capabilities, res);
        } catch (err) {
          await sendNdjsonEvent(res, {
            type: "error",
            errorCode: "host_runtime_execute_failed",
            message: err instanceof Error ? err.message : String(err),
          });
        } finally {
          res.off("close", handleResponseClose);
          if (!res.writableEnded) {
            res.end();
          }
        }
        return;
      }

      if (method === "POST" && parsedUrl.pathname === "/v1/browser-sessions") {
        const payload = await readJsonBody(req) as unknown as HostRuntimeBrowserSessionRequest;
        const session = await launchBrowserSession(payload, pathMaps, capabilities, browserSessions);
        writeJson(res, 200, session);
        return;
      }

      if (method === "DELETE" && parsedUrl.pathname.startsWith("/v1/browser-sessions/")) {
        const id = decodeURIComponent(parsedUrl.pathname.slice("/v1/browser-sessions/".length));
        const record = browserSessions.get(id);
        if (!record) {
          writeJson(res, 404, { error: "Browser session not found" });
          return;
        }
        browserSessions.delete(id);
        if (record.close) {
          await record.close().catch(() => undefined);
        }
        writeJson(res, 200, { ok: true });
        return;
      }

      if (method === "POST" && parsedUrl.pathname.startsWith("/v1/executions/") && parsedUrl.pathname.endsWith("/cancel")) {
        const runId = decodeURIComponent(parsedUrl.pathname.slice("/v1/executions/".length, -"/cancel".length));
        const cancelled = await cancelHostedRun(runId);
        writeJson(res, 200, { ok: true, cancelled });
        return;
      }

      writeJson(res, 404, { error: "Not found" });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      writeJson(res, 500, { error: message });
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => resolve());
  });

  process.stdout.write(
    `[paperclip host-runtime] listening on http://${host}:${port} capabilities=${Array.from(capabilities).join(",")}\n`,
  );
  return server;
}
