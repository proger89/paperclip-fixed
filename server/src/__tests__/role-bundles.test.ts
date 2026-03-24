import { describe, expect, it } from "vitest";
import { applyRoleBundleManagedInstructions, resolveRoleBundle } from "../services/role-bundles.js";

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
  ]);

  it("loads design-focused skills for designer and frontend roles", () => {
    const designer = resolveRoleBundle("designer", null);
    const frontend = resolveRoleBundle("frontend_engineer", null);

    expect(designer.requestedSkillRefs).toEqual(expect.arrayContaining([
      "web-design-guidelines",
      "frontend-skill",
      "playwright",
      "screenshot",
    ]));
    expect(frontend.requestedSkillRefs).toEqual(expect.arrayContaining([
      "web-design-guidelines",
      "frontend-skill",
      "playwright",
      "security-best-practices",
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
    ]));
    expect(pm.suggestedConnectorPlugins).toEqual(expect.arrayContaining([
      expect.objectContaining({
        key: "paperclip-kitchen-sink-example",
        source: "local_path",
      }),
      expect.objectContaining({
        key: "paperclipai.plugin-authoring-smoke-example",
        source: "local_path",
      }),
    ]));
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
});
