import { describe, expect, it } from "vitest";
import {
  applyRoleBundleManagedInstructions,
  resolveRoleBundle,
  resolveRoleBundleSelectionForHire,
} from "../services/role-bundles.js";

describe("role bundles", () => {
  const knownSkillRefs = new Set([
    "paperclip",
    "para-memory-files",
    "playwright",
    "playwright-interactive",
    "screenshot",
    "web-design-guidelines",
    "frontend-skill",
    "security-best-practices",
    "paperclip-create-agent",
    "doc-maintenance",
    "pr-report",
    "rknall/claude-skills/web-design-builder",
    "jackspace/claudeskillz/playwright-browser-automation",
    "anthropics/knowledge-work-plugins/source-management",
    "rickydwilson-dcs/claude-skills/content-creator",
  ]);

  it("loads design-focused skills for designer and frontend roles", () => {
    const designer = resolveRoleBundle("designer", null);
    const frontend = resolveRoleBundle("frontend_engineer", null);

    expect(designer.requestedSkillRefs).toEqual(expect.arrayContaining([
      "web-design-guidelines",
      "frontend-skill",
      "playwright",
      "screenshot",
      "rknall/claude-skills/web-design-builder",
    ]));
    expect(frontend.requestedSkillRefs).toEqual(expect.arrayContaining([
      "web-design-guidelines",
      "frontend-skill",
      "playwright",
      "security-best-practices",
      "rknall/claude-skills/web-design-builder",
    ]));
  });

  it("gives PM bundles hiring and continuity skills", () => {
    const pm = resolveRoleBundle("pm", null);

    expect(pm.requestedSkillRefs).toEqual(expect.arrayContaining([
      "paperclip-create-agent",
      "para-memory-files",
      "doc-maintenance",
      "pr-report",
      "playwright",
      "anthropics/knowledge-work-plugins/source-management",
    ]));
    expect(pm.suggestedConnectorPlugins).toEqual(expect.arrayContaining([
      expect.objectContaining({
        key: "paperclip-kitchen-sink-example",
        source: "local_path",
      }),
      expect.objectContaining({
        key: "paperclip.telegram-channel-connector",
        source: "local_path",
      }),
      expect.objectContaining({
        key: "paperclipai.plugin-authoring-smoke-example",
        source: "local_path",
      }),
    ]));
  });

  it("requires the Telegram connector for content workflows", () => {
    const content = resolveRoleBundle("content_operator", null);

    expect(content.requiredConnectorPlugins).toEqual([
      expect.objectContaining({
        key: "paperclip.telegram-channel-connector",
        source: "local_path",
      }),
    ]);
  });

  it("uses only curated skill refs that can be resolved by the install flow", () => {
    const bundleKeys = [
      "general_specialist",
      "designer",
      "qa",
      "pm",
      "frontend_engineer",
      "content_operator",
    ] as const;

    for (const bundleKey of bundleKeys) {
      const bundle = resolveRoleBundle(bundleKey, null);
      for (const ref of bundle.requestedSkillRefs) {
        expect(knownSkillRefs.has(ref)).toBe(true);
      }
    }
  });

  it("appends role-specific managed instructions for specialist bundles", () => {
    const files = applyRoleBundleManagedInstructions(
      {
        "AGENTS.md": "Base instructions.",
      },
      "designer",
      "designer",
    );

    expect(files["AGENTS.md"]).toContain("## Role Focus");
    expect(files["AGENTS.md"]).toContain("You own product UX quality and visible polish.");
    expect(files["AGENTS.md"]).toContain("Attach primary previews, runtime links, artifacts, or docs");
  });

  it("falls back by agent role when no explicit bundle key is provided", () => {
    const bundle = resolveRoleBundle(null, "engineer");

    expect(bundle.key).toBe("frontend_engineer");
    expect(bundle.defaultReviewerRole).toBe("designer");
  });

  it("infers specialist bundles for generic hires when the task signals design work", () => {
    const selection = resolveRoleBundleSelectionForHire({
      agentRole: "engineer",
      staffingReason: "Design a beautiful dashboard UI with stronger visual polish and layout clarity.",
    });

    expect(selection.roleBundle.key).toBe("designer");
    expect(selection.source).toBe("capability_inferred");
    expect(selection.matchedTerms).toEqual(expect.arrayContaining(["design", "polish"]));
  });

  it("infers content operator bundles for Telegram and publishing workflows", () => {
    const selection = resolveRoleBundleSelectionForHire({
      agentRole: "general",
      staffingReason: "Build the Telegram channel workflow and publishing handoff for weekly posts.",
    });

    expect(selection.roleBundle.key).toBe("content_operator");
    expect(selection.source).toBe("capability_inferred");
    expect(selection.matchedTerms).toEqual(expect.arrayContaining(["telegram", "channel", "publishing"]));
  });

  it("does not override an explicit specialist bundle", () => {
    const selection = resolveRoleBundleSelectionForHire({
      roleBundleKey: "frontend_engineer",
      agentRole: "engineer",
      staffingReason: "Design a beautiful landing page.",
    });

    expect(selection.roleBundle.key).toBe("frontend_engineer");
    expect(selection.source).toBe("explicit");
  });
});
