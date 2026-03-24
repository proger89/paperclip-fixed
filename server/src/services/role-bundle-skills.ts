import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Db } from "@paperclipai/db";
import type { CompanySkill } from "@paperclipai/shared";
import { companySkillService } from "./company-skills.js";

export interface RoleBundleSkillRequirement {
  reference: string;
  displayName: string;
  source: string | null;
  sourceType: "local_path" | "skills_sh" | null;
}

export interface RoleBundleSkillCoverage {
  installedSkillKeys: string[];
  installedReferences: string[];
  missing: RoleBundleSkillRequirement[];
}

function normalizeToken(value: string | null | undefined) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function resolveSkillReference(
  installedSkills: CompanySkill[],
  reference: string,
) {
  const normalizedReference = normalizeToken(reference);
  if (!normalizedReference) return null;
  return installedSkills.find((skill) =>
    [skill.key, skill.slug, skill.name]
      .map((value) => normalizeToken(value))
      .includes(normalizedReference)) ?? null;
}

function repoSkillRoots() {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const homeDir = process.env.HOME || process.env.USERPROFILE || os.homedir();
  const codexHome = process.env.CODEX_HOME;

  return [
    path.resolve(moduleDir, "../../skills"),
    path.resolve(moduleDir, "../../.agents/skills"),
    path.resolve(process.cwd(), "skills"),
    path.resolve(process.cwd(), ".agents/skills"),
    path.resolve(moduleDir, "../../../skills"),
    path.resolve(moduleDir, "../../../.agents/skills"),
    codexHome ? path.resolve(codexHome, "skills") : null,
    homeDir ? path.resolve(homeDir, ".codex/skills") : null,
    homeDir ? path.resolve(homeDir, ".claude/skills") : null,
  ].filter((value): value is string => Boolean(value));
}

export function resolveSkillImportSource(reference: string) {
  const trimmed = reference.trim();
  if (!trimmed) return { source: null, sourceType: null } as const;

  if (/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(trimmed)) {
    return {
      source: trimmed,
      sourceType: "skills_sh",
    } as const;
  }

  for (const root of repoSkillRoots()) {
    const candidateDir = path.resolve(root, trimmed);
    const candidateSkill = path.join(candidateDir, "SKILL.md");
    if (fs.existsSync(candidateSkill)) {
      return {
        source: candidateDir,
        sourceType: "local_path",
      } as const;
    }
  }

  return { source: null, sourceType: null } as const;
}

export function resolveRoleBundleSkillRequirement(reference: string): RoleBundleSkillRequirement {
  const trimmed = reference.trim();
  const importSource = resolveSkillImportSource(trimmed);
  return {
    reference: trimmed,
    displayName: trimmed,
    source: importSource.source,
    sourceType: importSource.sourceType,
  };
}

export async function resolveRoleBundleSkillCoverage(
  db: Db,
  companyId: string,
  requestedReferences: string[],
): Promise<RoleBundleSkillCoverage> {
  const installedSkills = await companySkillService(db).listFull(companyId);
  const installedSkillKeys = new Set<string>();
  const installedReferences = new Set<string>();
  const missing = new Map<string, RoleBundleSkillRequirement>();

  for (const requestedReference of requestedReferences) {
    const trimmed = requestedReference.trim();
    if (!trimmed) continue;

    const installedSkill = resolveSkillReference(installedSkills, trimmed);
    if (installedSkill) {
      installedSkillKeys.add(installedSkill.key);
      installedReferences.add(trimmed);
      continue;
    }

    missing.set(trimmed, resolveRoleBundleSkillRequirement(trimmed));
  }

  return {
    installedSkillKeys: Array.from(installedSkillKeys),
    installedReferences: Array.from(installedReferences),
    missing: Array.from(missing.values()),
  };
}
