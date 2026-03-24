// @vitest-environment node

import { describe, expect, it } from "vitest";
import type { Issue, IssueWorkProduct } from "@paperclipai/shared";
import { getIssueReviewSummary, parseAcceptanceChecklistDraft } from "./issue-review";

function makeIssue(overrides: Partial<Issue> = {}): Pick<
  Issue,
  "status" | "reviewPolicyKey" | "reviewerAgentId" | "reviewerUserId"
> {
  return {
    status: "todo",
    reviewPolicyKey: null,
    reviewerAgentId: null,
    reviewerUserId: null,
    ...overrides,
  };
}

function makeProduct(overrides: Partial<IssueWorkProduct> = {}): IssueWorkProduct {
  return {
    id: "product-1",
    companyId: "company-1",
    projectId: null,
    issueId: "issue-1",
    executionWorkspaceId: null,
    runtimeServiceId: null,
    type: "preview_url",
    provider: "paperclip",
    externalId: null,
    title: "Preview",
    url: "https://example.com",
    status: "draft",
    reviewState: "none",
    isPrimary: true,
    healthStatus: "unknown",
    summary: null,
    metadata: null,
    createdByRunId: null,
    createdAt: new Date("2026-03-24T00:00:00.000Z"),
    updatedAt: new Date("2026-03-24T00:00:00.000Z"),
    ...overrides,
  };
}

describe("issue review helpers", () => {
  it("treats missing reviewer and missing outputs as completion blockers", () => {
    const result = getIssueReviewSummary(
      makeIssue({ reviewPolicyKey: "design_review" }),
      [],
    );

    expect(result.reviewRequired).toBe(true);
    expect(result.stage).toBe("missing_setup");
    expect(result.blockers).toEqual([
      "Assign a reviewer before closing this issue.",
      "Attach at least one reviewable output: Preview, Runtime, Artifact, Document.",
    ]);
    expect(result.canMoveToDone).toBe(false);
  });

  it("recognizes approved review outputs as satisfying the completion gate", () => {
    const result = getIssueReviewSummary(
      makeIssue({ reviewPolicyKey: "design_review", reviewerAgentId: "agent-1" }),
      [makeProduct({ status: "approved" })],
    );

    expect(result.stage).toBe("approved");
    expect(result.blockers).toEqual([]);
    expect(result.canMoveToDone).toBe(true);
  });

  it("keeps changes requested as a warning when an approved output already exists", () => {
    const result = getIssueReviewSummary(
      makeIssue({ reviewPolicyKey: "design_review", reviewerAgentId: "agent-1" }),
      [
        makeProduct({ id: "approved", status: "approved" }),
        makeProduct({ id: "changes", status: "changes_requested" }),
      ],
    );

    expect(result.stage).toBe("approved");
    expect(result.blockers).toEqual([]);
    expect(result.warnings).toContain(
      "A reviewable output has changes requested. Publish an updated result before calling this review complete.",
    );
  });

  it("parses checklist drafts as trimmed unique lines", () => {
    expect(parseAcceptanceChecklistDraft(" Ship it \n\nShip it\nOpen preview \r\n")).toEqual([
      "Ship it",
      "Open preview",
    ]);
  });
});
