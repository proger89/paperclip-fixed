import type { Db } from "@paperclipai/db";
import type { PluginRecord } from "@paperclipai/shared";
import type { RoleBundleConnectorRequirement } from "./role-bundles.js";
import { pluginRegistryService } from "./plugin-registry.js";
import { resolveRoleBundle } from "./role-bundles.js";

export interface RoleBundleConnectorCoverage {
  required: RoleBundleConnectorRequirement[];
  installed: RoleBundleConnectorRequirement[];
  missing: RoleBundleConnectorRequirement[];
}

function normalizeToken(value: string | null | undefined) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function requirementTokens(requirement: RoleBundleConnectorRequirement) {
  return new Set(
    [
      requirement.key,
      requirement.pluginKey,
      requirement.packageName,
      requirement.localPath,
    ]
      .map((value) => normalizeToken(value))
      .filter((value) => value.length > 0),
  );
}

function pluginTokens(plugin: Pick<PluginRecord, "pluginKey" | "packageName">) {
  return new Set(
    [plugin.pluginKey, plugin.packageName]
      .map((value) => normalizeToken(value))
      .filter((value) => value.length > 0),
  );
}

function requirementMatchesPlugin(
  requirement: RoleBundleConnectorRequirement,
  plugin: Pick<PluginRecord, "pluginKey" | "packageName">,
) {
  const required = requirementTokens(requirement);
  if (required.size === 0) return false;
  const installed = pluginTokens(plugin);
  for (const token of required) {
    if (installed.has(token)) return true;
  }
  return false;
}

export async function resolveRoleBundleConnectorCoverage(
  db: Db,
  roleBundleKey: string | null | undefined,
  agentRole: string | null | undefined,
): Promise<RoleBundleConnectorCoverage> {
  const roleBundle = resolveRoleBundle(roleBundleKey, agentRole);
  const required = roleBundle.requiredConnectorPlugins;
  if (required.length === 0) {
    return {
      required,
      installed: [],
      missing: [],
    };
  }

  const installedPlugins = await pluginRegistryService(db).listInstalled();
  const installed: RoleBundleConnectorRequirement[] = [];
  const missing: RoleBundleConnectorRequirement[] = [];

  for (const requirement of required) {
    const matched = installedPlugins.some((plugin) => requirementMatchesPlugin(requirement, plugin));
    if (matched) installed.push(requirement);
    else missing.push(requirement);
  }

  return {
    required,
    installed,
    missing,
  };
}
