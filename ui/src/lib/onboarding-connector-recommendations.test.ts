// @vitest-environment node

import { describe, expect, it } from "vitest";
import type { Approval, PluginRecord } from "@paperclipai/shared";
import type { AvailablePluginExample } from "../api/plugins";
import {
  TELEGRAM_CONNECTOR_PLUGIN_KEY,
  getTelegramConnectorRecommendation,
} from "./onboarding-connector-recommendations";

function makePluginExample(
  overrides: Partial<AvailablePluginExample> = {},
): AvailablePluginExample {
  return {
    packageName: "@paperclipai/plugin-telegram-publishing",
    pluginKey: TELEGRAM_CONNECTOR_PLUGIN_KEY,
    displayName: "Telegram Publishing",
    description: "Telegram publishing plugin",
    localPath: "packages/plugins/telegram-publishing",
    tag: "bundled",
    categories: ["connector", "ui"],
    ...overrides,
  };
}

function makeInstalledPlugin(overrides: Partial<PluginRecord> = {}): PluginRecord {
  return {
    id: "plugin-1",
    pluginKey: TELEGRAM_CONNECTOR_PLUGIN_KEY,
    packageName: "@paperclipai/plugin-telegram-publishing",
    version: "0.1.0",
    apiVersion: 1,
    categories: ["connector", "ui"],
    manifestJson: {} as any,
    status: "ready",
    installOrder: 1,
    packagePath: "packages/plugins/telegram-publishing",
    lastError: null,
    installedAt: new Date("2026-03-25T00:00:00.000Z"),
    updatedAt: new Date("2026-03-25T00:00:00.000Z"),
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
      pluginKey: TELEGRAM_CONNECTOR_PLUGIN_KEY,
      packageName: "@paperclipai/plugin-telegram-publishing",
      localPath: "packages/plugins/telegram-publishing",
    },
    decisionNote: null,
    decidedByUserId: null,
    decidedAt: null,
    createdAt: new Date("2026-03-25T00:00:00.000Z"),
    updatedAt: new Date("2026-03-25T00:00:00.000Z"),
    ...overrides,
  };
}

describe("getTelegramConnectorRecommendation", () => {
  it("returns an available recommendation when Telegram is bundled but not installed", () => {
    const recommendation = getTelegramConnectorRecommendation({
      pluginExamples: [makePluginExample()],
      installedPlugins: [],
      approvals: [],
    });

    expect(recommendation).toEqual(
      expect.objectContaining({
        status: "available",
        example: expect.objectContaining({
          pluginKey: TELEGRAM_CONNECTOR_PLUGIN_KEY,
        }),
      }),
    );
    expect(recommendation?.installPath).toContain("/approvals/pending?");
  });

  it("marks an existing onboarding install approval", () => {
    const recommendation = getTelegramConnectorRecommendation({
      pluginExamples: [makePluginExample()],
      installedPlugins: [],
      approvals: [makeApproval()],
    });

    expect(recommendation).toEqual(
      expect.objectContaining({
        status: "approval_open",
        openApproval: expect.objectContaining({ id: "approval-1" }),
      }),
    );
  });

  it("marks the connector as installed when it is already present", () => {
    const recommendation = getTelegramConnectorRecommendation({
      pluginExamples: [makePluginExample()],
      installedPlugins: [makeInstalledPlugin()],
      approvals: [],
    });

    expect(recommendation).toEqual(
      expect.objectContaining({
        status: "installed",
        installedPlugin: expect.objectContaining({
          pluginKey: TELEGRAM_CONNECTOR_PLUGIN_KEY,
        }),
      }),
    );
  });

  it("returns null when the Telegram connector is not in the bundled catalog", () => {
    const recommendation = getTelegramConnectorRecommendation({
      pluginExamples: [],
      installedPlugins: [],
      approvals: [],
    });

    expect(recommendation).toBeNull();
  });
});
