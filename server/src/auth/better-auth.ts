import type { Request, RequestHandler } from "express";
import type { IncomingHttpHeaders } from "node:http";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { toNodeHandler } from "better-auth/node";
import type { Db } from "@paperclipai/db";
import {
  authAccounts,
  authSessions,
  authUsers,
  authVerifications,
} from "@paperclipai/db";
import type { Config } from "../config.js";
import { logger } from "../middleware/logger.js";
import { accessService } from "../services/access.js";

export type BetterAuthSessionUser = {
  id: string;
  email?: string | null;
  name?: string | null;
};

export type BetterAuthSessionResult = {
  session: { id: string; userId: string } | null;
  user: BetterAuthSessionUser | null;
};

type BetterAuthInstance = ReturnType<typeof betterAuth>;
const LOOPBACK_HOSTNAMES = ["localhost", "127.0.0.1", "::1"] as const;

function headersFromNodeHeaders(rawHeaders: IncomingHttpHeaders): Headers {
  const headers = new Headers();
  for (const [key, raw] of Object.entries(rawHeaders)) {
    if (!raw) continue;
    if (Array.isArray(raw)) {
      for (const value of raw) headers.append(key, value);
      continue;
    }
    headers.set(key, raw);
  }
  return headers;
}

function headersFromExpressRequest(req: Request): Headers {
  return headersFromNodeHeaders(req.headers);
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase();
  return LOOPBACK_HOSTNAMES.includes(normalized as (typeof LOOPBACK_HOSTNAMES)[number]);
}

function expandTrustedHostnames(hostname: string): string[] {
  const normalized = hostname.trim().toLowerCase();
  if (!normalized) return [];
  return isLoopbackHostname(normalized) ? [...LOOPBACK_HOSTNAMES] : [normalized];
}

function addTrustedOrigin(
  trustedOrigins: Set<string>,
  protocol: string,
  hostname: string,
  port?: string | undefined,
) {
  const normalizedProtocol = protocol.endsWith(":") ? protocol.toLowerCase() : `${protocol.toLowerCase()}:`;
  const normalizedHostname = hostname.trim().toLowerCase();
  if (!normalizedHostname) return;
  const formattedHostname =
    normalizedHostname.includes(":") && !normalizedHostname.startsWith("[")
      ? `[${normalizedHostname}]`
      : normalizedHostname;
  const origin = `${normalizedProtocol}//${formattedHostname}${port ? `:${port}` : ""}`;
  trustedOrigins.add(origin);
}

function addTrustedOriginVariants(
  trustedOrigins: Set<string>,
  protocol: string,
  hostname: string,
  port?: string | undefined,
) {
  for (const candidate of expandTrustedHostnames(hostname)) {
    addTrustedOrigin(trustedOrigins, protocol, candidate);
    if (port) addTrustedOrigin(trustedOrigins, protocol, candidate, port);
  }
}

export function deriveAuthTrustedOrigins(config: Config): string[] {
  const baseUrl = config.authBaseUrlMode === "explicit" ? config.authPublicBaseUrl : undefined;
  const trustedOrigins = new Set<string>();
  let configuredPort: string | undefined;

  if (baseUrl) {
    try {
      const parsed = new URL(baseUrl);
      configuredPort = parsed.port || undefined;
      addTrustedOriginVariants(trustedOrigins, parsed.protocol, parsed.hostname, configuredPort);
    } catch {
      // Better Auth will surface invalid base URL separately.
    }
  }
  if (config.deploymentMode === "authenticated") {
    const fallbackPort = configuredPort ?? String(config.port);
    for (const hostname of config.allowedHostnames) {
      const trimmed = hostname.trim().toLowerCase();
      if (!trimmed) continue;
      addTrustedOriginVariants(trustedOrigins, "https:", trimmed, fallbackPort);
      addTrustedOriginVariants(trustedOrigins, "http:", trimmed, fallbackPort);
    }
  }

  return Array.from(trustedOrigins);
}

export function createBetterAuthInstance(db: Db, config: Config, trustedOrigins?: string[]): BetterAuthInstance {
  const baseUrl = config.authBaseUrlMode === "explicit" ? config.authPublicBaseUrl : undefined;
  const secret = process.env.BETTER_AUTH_SECRET ?? process.env.PAPERCLIP_AGENT_JWT_SECRET ?? "paperclip-dev-secret";
  const effectiveTrustedOrigins = trustedOrigins ?? deriveAuthTrustedOrigins(config);
  const access = accessService(db);

  const publicUrl = process.env.PAPERCLIP_PUBLIC_URL ?? baseUrl;
  const isHttpOnly = publicUrl ? publicUrl.startsWith("http://") : false;

  const authConfig = {
    baseURL: baseUrl,
    secret,
    trustedOrigins: effectiveTrustedOrigins,
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: {
        user: authUsers,
        session: authSessions,
        account: authAccounts,
        verification: authVerifications,
      },
    }),
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: false,
      disableSignUp: config.authDisableSignUp,
      sendResetPassword: async ({ user, url, token }: { user: BetterAuthSessionUser; url: string; token: string }) => {
        logger.info(
          {
            email: user.email ?? null,
            resetUrl: url,
            token,
          },
          "Generated password reset link",
        );
      },
    },
    databaseHooks: {
      user: {
        create: {
          after: async (user: { id: string }) => {
            await access.ensureFirstRegisteredUserIsInstanceAdmin(user.id);
          },
        },
      },
    },
    ...(isHttpOnly ? { advanced: { useSecureCookies: false } } : {}),
  };

  if (!baseUrl) {
    delete (authConfig as { baseURL?: string }).baseURL;
  }

  return betterAuth(authConfig);
}

export function createBetterAuthHandler(auth: BetterAuthInstance): RequestHandler {
  const handler = toNodeHandler(auth);
  return (req, res, next) => {
    void Promise.resolve(handler(req, res)).catch(next);
  };
}

export async function resolveBetterAuthSessionFromHeaders(
  auth: BetterAuthInstance,
  headers: Headers,
): Promise<BetterAuthSessionResult | null> {
  const api = (auth as unknown as { api?: { getSession?: (input: unknown) => Promise<unknown> } }).api;
  if (!api?.getSession) return null;

  const sessionValue = await api.getSession({
    headers,
  });
  if (!sessionValue || typeof sessionValue !== "object") return null;

  const value = sessionValue as {
    session?: { id?: string; userId?: string } | null;
    user?: { id?: string; email?: string | null; name?: string | null } | null;
  };
  const session = value.session?.id && value.session.userId
    ? { id: value.session.id, userId: value.session.userId }
    : null;
  const user = value.user?.id
    ? {
        id: value.user.id,
        email: value.user.email ?? null,
        name: value.user.name ?? null,
      }
    : null;

  if (!session || !user) return null;
  return { session, user };
}

export async function resolveBetterAuthSession(
  auth: BetterAuthInstance,
  req: Request,
): Promise<BetterAuthSessionResult | null> {
  return resolveBetterAuthSessionFromHeaders(auth, headersFromExpressRequest(req));
}
