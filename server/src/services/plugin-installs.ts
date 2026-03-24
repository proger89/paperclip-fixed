import type { Db } from "@paperclipai/db";
import type { PluginRecord } from "@paperclipai/shared";
import type { PluginLifecycleManager } from "./plugin-lifecycle.js";
import type { PluginLoader } from "./plugin-loader.js";
import { publishGlobalLiveEvent } from "./live-events.js";
import { pluginRegistryService } from "./plugin-registry.js";

export type ManagedPluginInstallSource = "local_path" | "npm";

export interface ManagedPluginInstallRequest {
  packageName: string;
  version?: string;
  isLocalPath: boolean;
  source: ManagedPluginInstallSource;
}

export interface InstallManagedPluginResult {
  plugin: PluginRecord;
  source: ManagedPluginInstallSource;
}

export function normalizeManagedPluginInstallInput(input: {
  packageName?: unknown;
  version?: unknown;
  isLocalPath?: unknown;
}): ManagedPluginInstallRequest {
  const packageName = typeof input.packageName === "string" ? input.packageName.trim() : "";
  const version =
    typeof input.version === "string" && input.version.trim().length > 0
      ? input.version.trim()
      : undefined;
  const isLocalPath = input.isLocalPath === true;

  if (!packageName) {
    throw new Error("packageName is required and must be a string");
  }

  if (input.version !== undefined && typeof input.version !== "string") {
    throw new Error("version must be a string if provided");
  }

  if (input.isLocalPath !== undefined && typeof input.isLocalPath !== "boolean") {
    throw new Error("isLocalPath must be a boolean if provided");
  }

  if (!isLocalPath && /[<>:\"|?*]/.test(packageName)) {
    throw new Error("packageName contains invalid characters");
  }

  return {
    packageName,
    version,
    isLocalPath,
    source: isLocalPath ? "local_path" : "npm",
  };
}

export async function installManagedPlugin(
  db: Db,
  loader: PluginLoader,
  lifecycle: PluginLifecycleManager,
  rawInput: {
    packageName?: unknown;
    version?: unknown;
    isLocalPath?: unknown;
  },
): Promise<InstallManagedPluginResult> {
  const input = normalizeManagedPluginInstallInput(rawInput);
  const registry = pluginRegistryService(db);
  const installOptions = input.isLocalPath
    ? { localPath: input.packageName }
    : { packageName: input.packageName, version: input.version };

  const discovered = await loader.installPlugin(installOptions);
  if (!discovered.manifest) {
    throw new Error("Plugin installed but manifest is missing");
  }

  const existingPlugin = await registry.getByKey(discovered.manifest.id);
  if (!existingPlugin) {
    throw new Error("Plugin installed but not found in registry");
  }

  await lifecycle.load(existingPlugin.id);

  const updatedPlugin = await registry.getById(existingPlugin.id);
  if (!updatedPlugin) {
    throw new Error("Plugin installed but not found after activation");
  }

  publishGlobalLiveEvent({
    type: "plugin.ui.updated",
    payload: { pluginId: existingPlugin.id, action: "installed" },
  });

  return {
    plugin: updatedPlugin as PluginRecord,
    source: input.source,
  };
}
