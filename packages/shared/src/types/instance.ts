import type { UiLanguage } from "../constants.js";

export type { UiLanguage } from "../constants.js";

export interface InstanceGeneralSettings {
  censorUsernameInLogs: boolean;
  uiLanguage: UiLanguage | null;
}

export type LocalAdapterExecutionLocation = "container" | "host";

export interface InstanceGeneralSettingsView extends InstanceGeneralSettings {
  effectiveUiLanguage: UiLanguage;
  defaultLocalExecutionLocation: LocalAdapterExecutionLocation;
  hostBridgeConfigured: boolean;
  agentFacingApiUrl: string;
}

export interface InstanceExperimentalSettings {
  enableIsolatedWorkspaces: boolean;
  autoRestartDevServerWhenIdle: boolean;
}

export interface InstanceSettings {
  id: string;
  general: InstanceGeneralSettings;
  experimental: InstanceExperimentalSettings;
  createdAt: Date;
  updatedAt: Date;
}
