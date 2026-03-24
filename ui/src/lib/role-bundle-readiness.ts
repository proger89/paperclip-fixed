import type {
  CompanySkillListItem,
  PluginRecord,
  RoleBundleCatalogConnectorRequirement,
  RoleBundleCatalogEntry,
  ToolInstallPolicy,
} from "@paperclipai/shared";

export interface RoleBundleInstalledSkillMatch {
  reference: string;
  skill: CompanySkillListItem;
}

export interface RoleBundleInstalledConnectorMatch {
  requirement: RoleBundleCatalogConnectorRequirement;
  plugin: PluginRecord;
}

export interface RoleBundleReadiness {
  installedSkills: RoleBundleInstalledSkillMatch[];
  missingSkillRefs: string[];
  installedConnectors: RoleBundleInstalledConnectorMatch[];
  missingConnectorRequirements: RoleBundleCatalogConnectorRequirement[];
  pendingApprovalSkillRefs: string[];
  manualSkillRefs: string[];
  pendingApprovalConnectors: RoleBundleCatalogConnectorRequirement[];
  manualConnectorRequirements: RoleBundleCatalogConnectorRequirement[];
}

function normalizeToken(value: string | null | undefined) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function matchesSkillReference(skill: CompanySkillListItem, reference: string) {
  const normalizedReference = normalizeToken(reference);
  if (!normalizedReference) return false;
  return [skill.key, skill.slug, skill.name]
    .map((value) => normalizeToken(value))
    .includes(normalizedReference);
}

function requirementTokens(requirement: RoleBundleCatalogConnectorRequirement) {
  return new Set(
    [requirement.key, requirement.pluginKey, requirement.packageName]
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

function matchesConnectorRequirement(
  requirement: RoleBundleCatalogConnectorRequirement,
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

function canQueueConnectorInstallApproval(
  requirement: RoleBundleCatalogConnectorRequirement,
  toolInstallPolicy: ToolInstallPolicy,
) {
  if (toolInstallPolicy !== "approval_gated") return false;
  return normalizeToken(requirement.packageName).length > 0;
}

export function getRoleBundleReadiness(input: {
  bundle: RoleBundleCatalogEntry;
  companySkills: CompanySkillListItem[];
  installedPlugins: PluginRecord[];
  toolInstallPolicy?: ToolInstallPolicy | null;
}): RoleBundleReadiness {
  const toolInstallPolicy = input.toolInstallPolicy ?? "approval_gated";
  const installedSkills: RoleBundleInstalledSkillMatch[] = [];
  const missingSkillRefs: string[] = [];

  for (const reference of input.bundle.requestedSkillRefs) {
    const match = input.companySkills.find((skill) => matchesSkillReference(skill, reference));
    if (match) {
      installedSkills.push({ reference, skill: match });
    } else {
      missingSkillRefs.push(reference);
    }
  }

  const installedConnectors: RoleBundleInstalledConnectorMatch[] = [];
  const missingConnectorRequirements: RoleBundleCatalogConnectorRequirement[] = [];

  for (const requirement of input.bundle.requiredConnectorPlugins) {
    const match = input.installedPlugins.find((plugin) => matchesConnectorRequirement(requirement, plugin));
    if (match) {
      installedConnectors.push({ requirement, plugin: match });
    } else {
      missingConnectorRequirements.push(requirement);
    }
  }

  return {
    installedSkills,
    missingSkillRefs,
    installedConnectors,
    missingConnectorRequirements,
    pendingApprovalSkillRefs:
      toolInstallPolicy === "approval_gated" ? missingSkillRefs : [],
    manualSkillRefs:
      toolInstallPolicy === "manual_only" ? missingSkillRefs : [],
    pendingApprovalConnectors: missingConnectorRequirements.filter((requirement) =>
      canQueueConnectorInstallApproval(requirement, toolInstallPolicy),
    ),
    manualConnectorRequirements: missingConnectorRequirements.filter(
      (requirement) => !canQueueConnectorInstallApproval(requirement, toolInstallPolicy),
    ),
  };
}
