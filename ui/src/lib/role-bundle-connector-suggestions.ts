import type {
  Approval,
  PluginRecord,
  RoleBundleCatalogConnectorRequirement,
  RoleBundleCatalogEntry,
} from "@paperclipai/shared";
import {
  findInstalledConnector,
  findOpenConnectorInstallApproval,
} from "./install-approval-drafts";

export type RoleBundleConnectorSuggestionStatus =
  | "available"
  | "approval_open"
  | "installed";

export interface RoleBundleConnectorSuggestionItem {
  bundleKey: string;
  bundleLabel: string;
  bundleTitle: string;
  requirement: RoleBundleCatalogConnectorRequirement;
  status: RoleBundleConnectorSuggestionStatus;
  installedPlugin: PluginRecord | null;
  openApproval: Approval | null;
}

export function getRoleBundleConnectorSuggestions(input: {
  roleBundles: RoleBundleCatalogEntry[];
  installedPlugins: PluginRecord[];
  approvals: Approval[];
  includeInstalled?: boolean;
}): RoleBundleConnectorSuggestionItem[] {
  const items: RoleBundleConnectorSuggestionItem[] = [];

  for (const bundle of input.roleBundles) {
    for (const requirement of bundle.suggestedConnectorPlugins) {
      const installedPlugin =
        findInstalledConnector(input.installedPlugins, {
          pluginKey: requirement.pluginKey ?? requirement.key,
          packageName: requirement.packageName ?? null,
          localPath: requirement.localPath ?? null,
        }) ?? null;

      const openApproval =
        installedPlugin
          ? null
          : findOpenConnectorInstallApproval(input.approvals, {
              pluginKey: requirement.pluginKey ?? requirement.key,
              packageName: requirement.packageName ?? null,
              localPath: requirement.localPath ?? null,
            }) ?? null;

      const status: RoleBundleConnectorSuggestionStatus = installedPlugin
        ? "installed"
        : openApproval
          ? "approval_open"
          : "available";

      if (status === "installed" && !input.includeInstalled) continue;

      items.push({
        bundleKey: bundle.key,
        bundleLabel: bundle.label,
        bundleTitle: bundle.title,
        requirement,
        status,
        installedPlugin,
        openApproval,
      });
    }
  }

  return items.sort((left, right) => {
    const statusWeight = {
      available: 0,
      approval_open: 1,
      installed: 2,
    } as const;
    const leftWeight = statusWeight[left.status];
    const rightWeight = statusWeight[right.status];
    if (leftWeight !== rightWeight) return leftWeight - rightWeight;
    const bundleOrder = left.bundleLabel.localeCompare(right.bundleLabel);
    if (bundleOrder !== 0) return bundleOrder;
    return left.requirement.displayName.localeCompare(right.requirement.displayName);
  });
}
