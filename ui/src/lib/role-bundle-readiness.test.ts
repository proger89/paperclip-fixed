// @vitest-environment node

import { describe, expect, it } from "vitest";
import type {
  CompanySkillListItem,
  PluginRecord,
  RoleBundleCatalogEntry,
} from "@paperclipai/shared";
import { getRoleBundleReadiness } from "./role-bundle-readiness";

function makeSkill(overrides: Partial<CompanySkillListItem>): CompanySkillListItem {
  return {
    id: "skill-1",
    companyId: "company-1",
    key: "paperclipai/paperclip/playwright",
    slug: "playwright",
    name: "playwright",
    description: "Browser automation",
    sourceType: "local_path",
    sourceLocator: null,
    sourceRef: null,
    trustLevel: "markdown_only",
    compatibility: "compatible",
    fileInventory: [],
    createdAt: new Date("2026-03-24T00:00:00.000Z"),
    updatedAt: new Date("2026-03-24T00:00:00.000Z"),
    attachedAgentCount: 0,
    editable: true,
    editableReason: null,
    sourceLabel: null,
    sourceBadge: "local",
    sourcePath: null,
    ...overrides,
  };
}

function makePlugin(overrides: Partial<PluginRecord>): PluginRecord {
  return {
    id: "plugin-1",
    pluginKey: "linear",
    packageName: "@paperclip/plugin-linear",
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

function makeBundle(overrides: Partial<RoleBundleCatalogEntry> = {}): RoleBundleCatalogEntry {
  return {
    key: "designer",
    label: "Designer",
    agentRole: "designer",
    title: "Product Designer",
    requestedSkillRefs: ["playwright", "frontend-skill", "paperclip"],
    requiredConnectorPlugins: [
      {
        key: "linear",
        displayName: "Linear",
        pluginKey: "linear",
        packageName: "@paperclip/plugin-linear",
      },
    ],
    defaultReviewPolicyKey: "design_review",
    defaultReviewerRole: "pm",
    ...overrides,
  };
}

describe("role bundle readiness", () => {
  it("matches installed bundle skills by key, slug, or name and separates missing refs", () => {
    const readiness = getRoleBundleReadiness({
      bundle: makeBundle(),
      companySkills: [
        makeSkill(),
        makeSkill({
          id: "skill-2",
          key: "paperclipai/paperclip/frontend-skill",
          slug: "design-system",
          name: "frontend-skill",
        }),
      ],
      installedPlugins: [makePlugin()],
      toolInstallPolicy: "approval_gated",
    });

    expect(readiness.installedSkills.map((entry) => entry.reference)).toEqual([
      "playwright",
      "frontend-skill",
    ]);
    expect(readiness.missingSkillRefs).toEqual(["paperclip"]);
    expect(readiness.pendingApprovalSkillRefs).toEqual(["paperclip"]);
    expect(readiness.installedConnectors.map((entry) => entry.requirement.displayName)).toEqual(["Linear"]);
    expect(readiness.pendingApprovalConnectors).toEqual([]);
  });

  it("sends non-installable connector gaps to manual follow-up even in approval mode", () => {
    const readiness = getRoleBundleReadiness({
      bundle: makeBundle({
        requestedSkillRefs: ["playwright"],
        requiredConnectorPlugins: [
          {
            key: "analytics",
            displayName: "Analytics Bridge",
          },
          {
            key: "slack",
            displayName: "Slack",
            packageName: "@paperclip/plugin-slack",
          },
        ],
      }),
      companySkills: [],
      installedPlugins: [],
      toolInstallPolicy: "approval_gated",
    });

    expect(readiness.pendingApprovalSkillRefs).toEqual(["playwright"]);
    expect(readiness.pendingApprovalConnectors.map((entry) => entry.displayName)).toEqual(["Slack"]);
    expect(readiness.manualConnectorRequirements.map((entry) => entry.displayName)).toEqual([
      "Analytics Bridge",
    ]);
  });

  it("marks all missing capabilities as manual when company installs are manual only", () => {
    const readiness = getRoleBundleReadiness({
      bundle: makeBundle(),
      companySkills: [],
      installedPlugins: [],
      toolInstallPolicy: "manual_only",
    });

    expect(readiness.pendingApprovalSkillRefs).toEqual([]);
    expect(readiness.manualSkillRefs).toEqual(["playwright", "frontend-skill", "paperclip"]);
    expect(readiness.pendingApprovalConnectors).toEqual([]);
    expect(readiness.manualConnectorRequirements.map((entry) => entry.displayName)).toEqual(["Linear"]);
  });
});
