// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
  buildRequiredReviewByRole,
  buildReviewRuleDrafts,
  type ReviewRuleDraft,
} from "./company-review-rule-drafts";

describe("CompanyReviewRulesEditor helpers", () => {
  it("round-trips required review rules through UI drafts", () => {
    const source = {
      designer: { reviewPolicyKey: "design_review", reviewerRole: "pm" },
      custom_delivery: { reviewPolicyKey: "qa_review", reviewerRole: "qa" },
    };

    const drafts = buildReviewRuleDrafts(source);
    const rebuilt = buildRequiredReviewByRole(drafts);

    expect(rebuilt.error).toBeNull();
    expect(rebuilt.value).toEqual(source);
  });

  it("rejects duplicate role bundle keys", () => {
    const drafts: ReviewRuleDraft[] = [
      {
        id: "one",
        roleKey: "designer",
        reviewPolicyKey: "design_review",
        reviewerRole: "pm",
        keyMode: "preset",
      },
      {
        id: "two",
        roleKey: "designer",
        reviewPolicyKey: "qa_review",
        reviewerRole: "qa",
        keyMode: "custom",
      },
    ];

    const rebuilt = buildRequiredReviewByRole(drafts);

    expect(rebuilt.error).toContain("Duplicate review rule");
  });
});
