import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveRoleBundleSkillCoverage } from "../services/role-bundle-skills.ts";

const mockCompanySkillService = vi.hoisted(() => ({
  listFull: vi.fn(),
}));

vi.mock("../services/company-skills.js", () => ({
  companySkillService: vi.fn(() => mockCompanySkillService),
}));

describe("role bundle skill coverage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("marks installed skills by matching key, slug, or name", async () => {
    mockCompanySkillService.listFull.mockResolvedValue([
      {
        id: "skill-1",
        companyId: "company-1",
        key: "paperclipai/paperclip/paperclip",
        slug: "paperclip",
        name: "paperclip",
      },
    ]);

    const coverage = await resolveRoleBundleSkillCoverage(
      {} as any,
      "company-1",
      ["paperclip"],
    );

    expect(coverage.installedSkillKeys).toEqual(["paperclipai/paperclip/paperclip"]);
    expect(coverage.missing).toHaveLength(0);
  });

  it("infers a local install source for repo-managed skills", async () => {
    mockCompanySkillService.listFull.mockResolvedValue([]);

    const coverage = await resolveRoleBundleSkillCoverage(
      {} as any,
      "company-1",
      ["doc-maintenance"],
    );

    expect(coverage.missing).toHaveLength(1);
    expect(coverage.missing[0]?.reference).toBe("doc-maintenance");
    expect(coverage.missing[0]?.sourceType).toBe("local_path");
    expect(coverage.missing[0]?.source).toMatch(/doc-maintenance$/);
  });

  it("uses skills.sh style refs directly as import sources", async () => {
    mockCompanySkillService.listFull.mockResolvedValue([]);

    const coverage = await resolveRoleBundleSkillCoverage(
      {} as any,
      "company-1",
      ["owner/repo/skill-name"],
    );

    expect(coverage.missing).toHaveLength(1);
    expect(coverage.missing[0]).toMatchObject({
      reference: "owner/repo/skill-name",
      source: "owner/repo/skill-name",
      sourceType: "skills_sh",
    });
  });
});
