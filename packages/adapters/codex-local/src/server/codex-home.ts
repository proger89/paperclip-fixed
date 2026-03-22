import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AdapterExecutionContext } from "@paperclipai/adapter-utils";

const TRUTHY_ENV_RE = /^(1|true|yes|on)$/i;
const COPIED_SHARED_FILES = ["config.json", "config.toml", "instructions.md"] as const;
const SYMLINKED_SHARED_FILES = ["auth.json"] as const;
const DEFAULT_PAPERCLIP_INSTANCE_ID = "default";

function nonEmpty(value: string | undefined): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

export async function pathExists(candidate: string): Promise<boolean> {
  return fs.access(candidate).then(() => true).catch(() => false);
}

export function resolveSharedCodexHomeDir(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const fromEnv = nonEmpty(env.CODEX_HOME);
  return fromEnv ? path.resolve(fromEnv) : path.join(os.homedir(), ".codex");
}

function isWorktreeMode(env: NodeJS.ProcessEnv): boolean {
  return TRUTHY_ENV_RE.test(env.PAPERCLIP_IN_WORKTREE ?? "");
}

export function resolveManagedCodexHomeDir(
  env: NodeJS.ProcessEnv,
  companyId?: string,
): string {
  const paperclipHome = nonEmpty(env.PAPERCLIP_HOME) ?? path.resolve(os.homedir(), ".paperclip");
  const instanceId = nonEmpty(env.PAPERCLIP_INSTANCE_ID) ?? DEFAULT_PAPERCLIP_INSTANCE_ID;
  return companyId
    ? path.resolve(paperclipHome, "instances", instanceId, "companies", companyId, "codex-home")
    : path.resolve(paperclipHome, "instances", instanceId, "codex-home");
}

async function ensureParentDir(target: string): Promise<void> {
  await fs.mkdir(path.dirname(target), { recursive: true });
}

function getErrorCode(error: unknown): string | null {
  return typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
    ? error.code
    : null;
}

function isSymlinkPermissionError(error: unknown): boolean {
  const code = getErrorCode(error);
  return code === "EPERM" || code === "EACCES";
}

function canFallBackFromHardLink(error: unknown): boolean {
  const code = getErrorCode(error);
  return code === "EPERM" || code === "EACCES" || code === "EXDEV" || code === "UNKNOWN";
}

async function createSharedFileReference(target: string, source: string): Promise<"symlink" | "hardlink" | "copy"> {
  try {
    await fs.symlink(source, target);
    return "symlink";
  } catch (error) {
    if (!isSymlinkPermissionError(error)) throw error;
  }

  try {
    await fs.link(source, target);
    return "hardlink";
  } catch (error) {
    if (!canFallBackFromHardLink(error)) throw error;
  }

  await fs.copyFile(source, target);
  return "copy";
}

async function areSameFile(source: string, target: string): Promise<boolean> {
  try {
    const [sourceStat, targetStat] = await Promise.all([fs.stat(source), fs.stat(target)]);
    return sourceStat.dev === targetStat.dev && sourceStat.ino === targetStat.ino;
  } catch {
    return false;
  }
}

async function ensureSharedFile(target: string, source: string): Promise<"symlink" | "hardlink" | "copy" | "unchanged"> {
  const existing = await fs.lstat(target).catch(() => null);
  if (!existing) {
    await ensureParentDir(target);
    return await createSharedFileReference(target, source);
  }

  if (existing.isSymbolicLink()) {
    const linkedPath = await fs.readlink(target).catch(() => null);
    if (!linkedPath) return "unchanged";

    const resolvedLinkedPath = path.resolve(path.dirname(target), linkedPath);
    if (resolvedLinkedPath === source) return "unchanged";

    await fs.unlink(target);
    return await createSharedFileReference(target, source);
  }

  if (existing.isFile()) {
    if (await areSameFile(source, target)) return "unchanged";
    await fs.unlink(target);
    return await createSharedFileReference(target, source);
  }

  return "unchanged";
}

async function ensureCopiedFile(target: string, source: string): Promise<void> {
  const existing = await fs.lstat(target).catch(() => null);
  if (existing) return;
  await ensureParentDir(target);
  await fs.copyFile(source, target);
}

export async function prepareManagedCodexHome(
  env: NodeJS.ProcessEnv,
  onLog: AdapterExecutionContext["onLog"],
  companyId?: string,
): Promise<string> {
  const targetHome = resolveManagedCodexHomeDir(env, companyId);

  const sourceHome = resolveSharedCodexHomeDir(env);
  if (path.resolve(sourceHome) === path.resolve(targetHome)) return targetHome;

  await fs.mkdir(targetHome, { recursive: true });

  for (const name of SYMLINKED_SHARED_FILES) {
    const source = path.join(sourceHome, name);
    if (!(await pathExists(source))) continue;
    const result = await ensureSharedFile(path.join(targetHome, name), source);
    if (result === "hardlink") {
      await onLog(
        "stdout",
        `[paperclip] Mirroring Codex auth via hard link because symbolic links are unavailable for "${name}".\n`,
      );
    } else if (result === "copy") {
      await onLog(
        "stdout",
        `[paperclip] Copied Codex auth into managed home because this machine cannot create a shared link for "${name}".\n`,
      );
    }
  }

  for (const name of COPIED_SHARED_FILES) {
    const source = path.join(sourceHome, name);
    if (!(await pathExists(source))) continue;
    await ensureCopiedFile(path.join(targetHome, name), source);
  }

  await onLog(
    "stdout",
    `[paperclip] Using ${isWorktreeMode(env) ? "worktree-isolated" : "Paperclip-managed"} Codex home "${targetHome}" (seeded from "${sourceHome}").\n`,
  );
  return targetHome;
}
