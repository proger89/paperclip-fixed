// @vitest-environment node

import { describe, expect, it } from "vitest";
import type {
  Approval,
  PluginRecord,
  RoleBundleCatalogEntry,
} from "@paperclipai/shared";
import { getRoleBundleConnectorSuggestions } from "./role-bundle-connector-suggestions";

function makeBundle(overrides: Partial<RoleBundleCatalogEntry> = {}): RoleBundleCatalogEntry {
  return {
    key: "pm",
    label: "PM",
    agentRole: "pm",
    title: "Project Manager",
    requestedSkillRefs: [],
    requestedSkillRequirements: [],
    requiredConnectorPlugins: [],
    suggestedConnectorPlugins: [
      {
        key: "paperclip-kitchen-sink-example",
        displayName: "Kitchen Sink (Example)",
        pluginKey: "paperclip-kitchen-sink-example",
        packageName: "@paperclipai/plugin-kitchen-sink-example",
        source: "local_path",
        localPath: "D:/new-projects/paperclip/packages/plugins/examples/plugin-kitchen-sink-example",
        reason: "Useful sandbox",
      },
    ],
    defaultReviewPolicyKey: null,
    defaultReviewerRole: null,
    ...overrides,
  };
}

function makePlugin(overrides: Partial<PluginRecord> = {}): PluginRecord {
  return {
    id: "plugin-1",
    pluginKey: "paperclip-kitchen-sink-example",
    packageName: "@paperclipai/plugin-kitchen-sink-example",
    version: "1.0.0",
    apiVersion: 1,
    categories: ["connector"],
    manifestJson: {} as any,
    status: "ready",
    installOrder: 1,
    packagePath: null,
    lastError: null,
    installedAt: new Date("2026-03-24T00:00:00.000Z"),
    updatedAt: new Date("2026-03-24T00:00:00.000Z"),
    ...overrides,
  };
}

function makeApproval(overrides: Partial<Approval> = {}): Approval {
  return {
    id: "approval-1",
    companyId: "company-1",
    type: "install_connector_plugin",
    requestedByAgentId: null,
    requestedByUserId: "user-1",
    status: "pending",
    payload: {
      pluginKey: "paperclip-kitchen-sink-example",
      packageName: "@paperclipai/plugin-kitchen-sink-example",
    },
    decisionNote: null,
    decidedByUserId: null,
    decidedAt: null,
    createdAt: new Date("2026-03-24T00:00:00.000Z"),
    updatedAt: new Date("2026-03-24T00:00:00.000Z"),
    ...overrides,
  };
}

describe("role bundle connector suggestions", () => {
  it("returns requestable suggestions by default", () => {
    const items = getRoleBundleConnectorSuggestions({
      roleBundles: [makeBundle()],
      installedPlugins: [],
      approvals: [],
    });

    expect(items).toEqual([
      expect.objectContaining({
        status: "available",
        bundleKey: "pm",
        requirement: expect.objectContaining({
          key: "paperclip-kitchen-sink-example",
        }),
      }),
    ]);
  });

  it("marks suggestions with open approvals", () => {
    const items = getRoleBundleConnectorSuggestions({
      roleBundles: [makeBundle()],
      installedPlugins: [],
      approvals: [makeApproval()],
    });

    expect(items).toEqual([
      expect.objectContaining({
        status: "approval_open",
        openApproval: expect.objectContaining({
          id: "approval-1",
        }),
      }),
    ]);
  });

  it("can include already installed suggestions for audit views", () => {
    const items = getRoleBundleConnectorSuggestions({
      roleBundles: [makeBundle()],
      installedPlugins: [makePlugin()],
      approvals: [],
      includeInstalled: true,
    });

    expect(items).toEqual([
      expect.objectContaining({
        status: "installed",
        installedPlugin: expect.objectContaining({
          pluginKey: "paperclip-kitchen-sink-example",
        }),
      }),
    ]);
  });

  it("hides installed suggestions by default", () => {
    const items = getRoleBundleConnectorSuggestions({
      roleBundles: [makeBundle()],
      installedPlugins: [makePlugin()],
      approvals: [],
    });

    expect(items).toEqual([]);
  });

  it("deduplicates the same connector across multiple bundles", () => {
    const items = getRoleBundleConnectorSuggestions({
      roleBundles: [
        makeBundle(),
        makeBundle({
          key: "general_specialist",
          label: "General Specialist",
          agentRole: "general",
          title: "General Specialist",
        }),
      ],
      installedPlugins: [],
      approvals: [],
      includeInstalled: true,
    });

    expect(items).toHaveLength(1);
    expect(items[0]?.bundles).toEqual([
      expect.objectContaining({ key: "pm", label: "PM" }),
      expect.objectContaining({ key: "general_specialist", label: "General Specialist" }),
    ]);
  });
});
