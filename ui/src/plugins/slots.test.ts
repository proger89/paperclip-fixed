import { describe, expect, it } from "vitest";
import type { PluginHostContext } from "./bridge";
import {
  _applyPluginElementBridgeContext,
  _slotContextToHostContext,
  type PluginSlotContext,
  type ResolvedPluginSlot,
} from "./slots";

function createSlot(overrides: Partial<ResolvedPluginSlot> = {}): ResolvedPluginSlot {
  return {
    id: "slot-telegram-sidebar",
    type: "sidebar",
    displayName: "Telegram",
    exportName: "TelegramSidebarLink",
    pluginId: "plugin-telegram",
    pluginKey: "paperclip.telegram-publishing",
    pluginDisplayName: "Telegram Publishing",
    pluginVersion: "0.1.0",
    ...overrides,
  } as ResolvedPluginSlot;
}

describe("plugin slot host context", () => {
  it("resolves sidebar-like slot input into the full host context", () => {
    const slotContext: PluginSlotContext = {
      companyId: "company-1",
      companyPrefix: "CMP",
    };

    expect(_slotContextToHostContext(slotContext, "user-1", "ru")).toEqual({
      companyId: "company-1",
      companyPrefix: "CMP",
      projectId: null,
      entityId: null,
      entityType: null,
      parentEntityId: null,
      userId: "user-1",
      locale: "ru",
      renderEnvironment: null,
    } satisfies PluginHostContext);
  });

  it("preserves entity, parent, and project information", () => {
    const slotContext: PluginSlotContext = {
      companyId: "company-2",
      companyPrefix: "ORG",
      projectId: "project-1",
      entityId: "comment-1",
      entityType: "comment",
      parentEntityId: "issue-7",
    };

    expect(_slotContextToHostContext(slotContext, "user-2", "en")).toEqual({
      companyId: "company-2",
      companyPrefix: "ORG",
      projectId: "project-1",
      entityId: "comment-1",
      entityType: "comment",
      parentEntityId: "issue-7",
      userId: "user-2",
      locale: "en",
      renderEnvironment: null,
    } satisfies PluginHostContext);
  });

  it("bridges the same resolved host context onto custom elements", () => {
    const slot = createSlot();
    const hostContext = _slotContextToHostContext(
      {
        companyId: "company-3",
        companyPrefix: "TEL",
      },
      "user-3",
      "ru",
    );
    const element = {} as HTMLElement & {
      pluginSlot?: ResolvedPluginSlot;
      pluginContext?: PluginHostContext;
    };

    _applyPluginElementBridgeContext(element, slot, hostContext);

    expect(element.pluginSlot).toBe(slot);
    expect(element.pluginContext).toEqual(hostContext);
  });
});
