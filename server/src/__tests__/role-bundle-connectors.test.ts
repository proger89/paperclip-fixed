import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveRoleBundleConnectorCoverage } from "../services/role-bundle-connectors.ts";
import { ROLE_BUNDLES } from "../services/role-bundles.ts";

const mockPluginRegistryService = vi.hoisted(() => vi.fn());

vi.mock("../services/plugin-registry.js", () => ({
  pluginRegistryService: mockPluginRegistryService,
}));

describe("role bundle connector coverage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ROLE_BUNDLES.pm.requiredConnectorPlugins = [];
  });

  it("marks requirements as installed when plugin key matches", async () => {
    ROLE_BUNDLES.pm.requiredConnectorPlugins = [
      {
        key: "@paperclip/plugin-linear",
        displayName: "Linear Connector",
        pluginKey: "@paperclip/plugin-linear",
        packageName: "@paperclip/plugin-linear",
      },
    ];
    mockPluginRegistryService.mockReturnValue({
      listInstalled: vi.fn(async () => [
        {
          pluginKey: "@paperclip/plugin-linear",
          packageName: "@paperclip/plugin-linear",
        },
      ]),
    });

    const coverage = await resolveRoleBundleConnectorCoverage({} as any, "pm", "pm");

    expect(coverage.installed).toHaveLength(1);
    expect(coverage.missing).toHaveLength(0);
  });

  it("marks requirements as missing when no installed plugin matches", async () => {
    ROLE_BUNDLES.pm.requiredConnectorPlugins = [
      {
        key: "@paperclip/plugin-linear",
        displayName: "Linear Connector",
        pluginKey: "@paperclip/plugin-linear",
        packageName: "@paperclip/plugin-linear",
      },
    ];
    mockPluginRegistryService.mockReturnValue({
      listInstalled: vi.fn(async () => [
        {
          pluginKey: "@paperclip/plugin-github",
          packageName: "@paperclip/plugin-github",
        },
      ]),
    });

    const coverage = await resolveRoleBundleConnectorCoverage({} as any, "pm", "pm");

    expect(coverage.installed).toHaveLength(0);
    expect(coverage.missing).toHaveLength(1);
    expect(coverage.missing[0]?.pluginKey).toBe("@paperclip/plugin-linear");
  });
});
