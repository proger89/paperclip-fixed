// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
  INSTALL_APPROVAL_PREFILL_SEARCH_PARAM,
  buildInstallApprovalPrefillPath,
  decodeInstallApprovalPrefill,
  encodeInstallApprovalPrefill,
} from "./install-approval-prefill";

describe("install approval prefill", () => {
  it("round-trips skill install prefills", () => {
    const encoded = encodeInstallApprovalPrefill({
      kind: "skill",
      mode: "import",
      source: "D:/new-projects/paperclip/skills/playwright",
      requestedRef: "playwright",
      roleBundleKey: "designer",
      reason: "Required for Designer role bundle",
    });

    expect(decodeInstallApprovalPrefill(encoded)).toEqual({
      kind: "skill",
      mode: "import",
      source: "D:/new-projects/paperclip/skills/playwright",
      skillId: null,
      requestedRef: "playwright",
      name: null,
      roleBundleKey: "designer",
      requiredByAgentId: null,
      reason: "Required for Designer role bundle",
    });
  });

  it("round-trips connector install prefills", () => {
    const encoded = encodeInstallApprovalPrefill({
      kind: "connector",
      mode: "local_path",
      localPath: "D:/new-projects/paperclip/packages/plugins/examples/plugin-authoring-smoke-example",
      pluginKey: "paperclipai.plugin-authoring-smoke-example",
      roleBundleKey: "pm",
    });

    expect(decodeInstallApprovalPrefill(encoded)).toEqual({
      kind: "connector",
      mode: "local_path",
      packageName: null,
      localPath: "D:/new-projects/paperclip/packages/plugins/examples/plugin-authoring-smoke-example",
      pluginKey: "paperclipai.plugin-authoring-smoke-example",
      name: null,
      version: null,
      roleBundleKey: "pm",
      requiredByAgentId: null,
      reason: null,
    });
  });

  it("returns null for invalid payloads", () => {
    expect(decodeInstallApprovalPrefill("{not-json")).toBeNull();
    expect(decodeInstallApprovalPrefill(JSON.stringify({ kind: "unknown" }))).toBeNull();
  });

  it("builds approvals links with encoded prefill payload", () => {
    const path = buildInstallApprovalPrefillPath({
      kind: "connector",
      mode: "npm",
      packageName: "@paperclip/plugin-linear",
      pluginKey: "@paperclip/plugin-linear",
    });

    expect(path.startsWith("/approvals/pending?")).toBe(true);
    const [, search = ""] = path.split("?");
    const params = new URLSearchParams(search);
    expect(params.get(INSTALL_APPROVAL_PREFILL_SEARCH_PARAM)).toBeTruthy();
    expect(
      decodeInstallApprovalPrefill(params.get(INSTALL_APPROVAL_PREFILL_SEARCH_PARAM)),
    ).toMatchObject({
      kind: "connector",
      mode: "npm",
      packageName: "@paperclip/plugin-linear",
    });
  });
});
