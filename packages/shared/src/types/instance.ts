export interface InstanceGeneralSettings {
  censorUsernameInLogs: boolean;
}

export type LocalAdapterExecutionLocation = "container" | "host";

export interface InstanceGeneralSettingsView extends InstanceGeneralSettings {
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
