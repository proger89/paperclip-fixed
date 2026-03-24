// @vitest-environment node

import { describe, expect, it } from "vitest";
import type {
  Approval,
  CompanySkillListItem,
  Issue,
  PluginRecord,
} from "@paperclipai/shared";
import {
  buildInstallApprovalIssueOptions,
  findInstalledConnector,
  findInstalledSkill,
  findOpenConnectorInstallApproval,
  findOpenSkillInstallApproval,
  parseLinkedIssueIds,
} from "./install-approval-drafts";

function makeApproval(overrides: Partial<Approval> = {}): Approval {
  return {
    id: "approval-1",
    companyId: "company-1",
    type: "install_company_skill",
    requestedByAgentId: null,
    requestedByUserId: "board",
    status: "pending",
    payload: {},
    decisionNote: null,
    decidedByUserId: null,
    decidedAt: null,
    createdAt: new Date("2026-03-24T09:00:00.000Z"),
    updatedAt: new Date("2026-03-24T09:00:00.000Z"),
    ...overrides,
  };
}

function makeSkill(overrides: Partial<CompanySkillListItem> = {}): CompanySkillListItem {
  return {
    id: "skill-1",
    companyId: "company-1",
    key: "paperclipai/paperclip/playwright",
    slug: "playwright",
    name: "Playwright",
    description: "Browser automation",
    sourceType: "github",
    sourceLocator: "https://skills.sh/playwright",
    sourceRef: null,
    trustLevel: "markdown_only",
    compatibility: "compatible",
    fileInventory: [],
    createdAt: new Date("2026-03-24T09:00:00.000Z"),
    updatedAt: new Date("2026-03-24T09:00:00.000Z"),
    attachedAgentCount: 0,
    editable: true,
    editableReason: null,
    sourceLabel: "skills.sh/playwright",
    sourceBadge: "skills_sh",
    sourcePath: null,
    ...overrides,
  };
}

function makePlugin(overrides: Partial<PluginRecord> = {}): PluginRecord {
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
    installedAt: new Date("2026-03-24T09:00:00.000Z"),
    updatedAt: new Date("2026-03-24T09:00:00.000Z"),
    ...overrides,
  };
}

function makeIssue(overrides: Partial<Issue> = {}): Issue {
  return {
    id: "issue-1",
    companyId: "company-1",
    projectId: null,
    projectWorkspaceId: null,
    goalId: null,
    parentId: null,
    title: "Ship review queue",
    description: null,
    status: "todo",
    priority: "medium",
    assigneeAgentId: null,
    assigneeUserId: null,
    checkoutRunId: null,
    executionRunId: null,
    executionAgentNameKey: null,
    executionLockedAt: null,
    createdByAgentId: null,
    createdByUserId: "board",
    issueNumber: 42,
    identifier: "ISS-42",
    requestDepth: 0,
    billingCode: null,
    assigneeAdapterOverrides: null,
    executionWorkspaceId: null,
    executionWorkspacePreference: null,
    executionWorkspaceSettings: null,
    startedAt: null,
    completedAt: null,
    cancelledAt: null,
    hiddenAt: null,
    createdAt: new Date("2026-03-24T09:00:00.000Z"),
    updatedAt: new Date("2026-03-24T09:00:00.000Z"),
    ...overrides,
  };
}

describe("install approval drafts", () => {
  it("parses linked issue ids from mixed separators and dedupes them", () => {
    expect(parseLinkedIssueIds("issue-1, issue-2\nissue-1  issue-3")).toEqual([
      "issue-1",
      "issue-2",
      "issue-3",
    ]);
  });

  it("builds recent open issue options and filters resolved issues", () => {
    const options = buildInstallApprovalIssueOptions([
      makeIssue({ id: "issue-old", identifier: "ISS-10", updatedAt: new Date("2026-03-24T08:00:00.000Z") }),
      makeIssue({ id: "issue-new", identifier: "ISS-11", updatedAt: new Date("2026-03-24T10:00:00.000Z") }),
      makeIssue({ id: "issue-done", status: "done", identifier: "ISS-12" }),
    ]);

    expect(options.map((entry) => entry.id)).toEqual(["issue-new", "issue-old"]);
    expect(options[0]).toMatchObject({ label: "ISS-11", title: "Ship review queue" });
  });

  it("finds installed skills by source locator or ref", () => {
    expect(findInstalledSkill([makeSkill()], {
      source: "https://skills.sh/playwright",
    })?.id).toBe("skill-1");

    expect(findInstalledSkill([makeSkill()], {
      requestedRef: "playwright",
    })?.id).toBe("skill-1");
  });

  it("finds open skill approvals by requested ref or source", () => {
    const approval = makeApproval({
      id: "approval-skill",
      payload: {
        requestedRef: "playwright",
        source: "https://skills.sh/playwright",
      },
    });

    expect(findOpenSkillInstallApproval([approval], {
      source: "https://skills.sh/playwright",
    })?.id).toBe("approval-skill");
  });

  it("finds installed connectors by package name or local path", () => {
    const plugins = [
      makePlugin(),
      makePlugin({
        id: "plugin-local",
        pluginKey: "paperclipai.plugin-authoring-smoke-example",
        packageName: "@paperclipai/plugin-authoring-smoke-example",
        packagePath: "D:/new-projects/paperclip/packages/plugins/examples/plugin-authoring-smoke-example",
      }),
    ];

    expect(findInstalledConnector(plugins, {
      packageName: "@paperclip/plugin-linear",
    })?.id).toBe("plugin-1");

    expect(findInstalledConnector(plugins, {
      localPath: "D:/new-projects/paperclip/packages/plugins/examples/plugin-authoring-smoke-example",
    })?.id).toBe("plugin-local");
  });

  it("finds open connector approvals by local path or package", () => {
    const approval = makeApproval({
      id: "approval-connector",
      type: "install_connector_plugin",
      payload: {
        pluginKey: "paperclipai.plugin-authoring-smoke-example",
        localPath: "D:/new-projects/paperclip/packages/plugins/examples/plugin-authoring-smoke-example",
      },
    });

    expect(findOpenConnectorInstallApproval([approval], {
      localPath: "D:/new-projects/paperclip/packages/plugins/examples/plugin-authoring-smoke-example",
    })?.id).toBe("approval-connector");
  });
});
