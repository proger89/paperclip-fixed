import { describe, expect, it } from "vitest";
import { resolveRoleBundle } from "../services/role-bundles.js";

describe("role bundles", () => {
  it("loads design-focused skills for designer and frontend roles", () => {
    const designer = resolveRoleBundle("designer", null);
    const frontend = resolveRoleBundle("frontend_engineer", null);

    expect(designer.requestedSkillRefs).toEqual(expect.arrayContaining([
      "design-guide",
      "frontend-design",
      "web-design-guidelines",
      "ui-ux-pro-max",
    ]));
    expect(frontend.requestedSkillRefs).toEqual(expect.arrayContaining([
      "design-guide",
      "frontend-design",
      "web-design-guidelines",
      "agent-browser",
    ]));
  });

  it("gives PM bundles hiring and continuity skills", () => {
    const pm = resolveRoleBundle("pm", null);

    expect(pm.requestedSkillRefs).toEqual(expect.arrayContaining([
      "paperclip-create-agent",
      "para-memory-files",
    ]));
  });

  it("falls back by agent role when no explicit bundle key is provided", () => {
    const bundle = resolveRoleBundle(null, "engineer");

    expect(bundle.key).toBe("frontend_engineer");
    expect(bundle.defaultReviewerRole).toBe("designer");
  });
});
