import type { Approval, PluginRecord } from "@paperclipai/shared";
import type { AvailablePluginExample } from "../api/plugins";
import {
  findInstalledConnector,
  findOpenConnectorInstallApproval,
} from "./install-approval-drafts";
import { buildInstallApprovalPrefillPath } from "./install-approval-prefill";

export const TELEGRAM_CONNECTOR_PLUGIN_KEY = "paperclip.telegram-channel-connector";

export type OnboardingConnectorRecommendationStatus =
  | "available"
  | "approval_open"
  | "installed";

export interface OnboardingConnectorRecommendation {
  example: AvailablePluginExample;
  status: OnboardingConnectorRecommendationStatus;
  installedPlugin: PluginRecord | null;
  openApproval: Approval | null;
  installPath: string;
}

export function getTelegramConnectorRecommendation(input: {
  pluginExamples: AvailablePluginExample[];
  installedPlugins: PluginRecord[];
  approvals: Approval[];
}): OnboardingConnectorRecommendation | null {
  const example =
    input.pluginExamples.find((entry) => entry.pluginKey === TELEGRAM_CONNECTOR_PLUGIN_KEY)
    ?? null;
  if (!example) return null;

  const installedPlugin =
    findInstalledConnector(input.installedPlugins, {
      pluginKey: example.pluginKey,
      packageName: example.packageName,
      localPath: example.localPath,
    }) ?? null;

  const openApproval =
    installedPlugin
      ? null
      : findOpenConnectorInstallApproval(input.approvals, {
          pluginKey: example.pluginKey,
          packageName: example.packageName,
          localPath: example.localPath,
        }) ?? null;

  const status: OnboardingConnectorRecommendationStatus = installedPlugin
    ? "installed"
    : openApproval
      ? "approval_open"
      : "available";

  return {
    example,
    status,
    installedPlugin,
    openApproval,
    installPath: buildInstallApprovalPrefillPath({
      kind: "connector",
      mode: "example",
      localPath: example.localPath,
      pluginKey: example.pluginKey,
      packageName: example.packageName,
      name: example.displayName,
      reason: "Suggested during company onboarding for Telegram and channel workflows",
    }),
  };
}
