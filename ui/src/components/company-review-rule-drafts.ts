import {
  REVIEW_POLICY_KEYS,
  ROLE_BUNDLE_KEYS,
  type CompanyRequiredReviewByRole,
} from "@paperclipai/shared";

export type ReviewRuleDraft = {
  id: string;
  roleKey: string;
  reviewPolicyKey: string;
  reviewerRole: string;
  keyMode: "preset" | "custom";
};

export const DEFAULT_REQUIRED_REVIEW_BY_ROLE: CompanyRequiredReviewByRole = {
  designer: {
    reviewPolicyKey: "design_review",
    reviewerRole: "pm",
  },
  frontend_engineer: {
    reviewPolicyKey: "design_review",
    reviewerRole: "designer",
  },
  qa: {
    reviewPolicyKey: "qa_review",
    reviewerRole: "qa",
  },
  content_operator: {
    reviewPolicyKey: "content_review",
    reviewerRole: "pm",
  },
};

function createDraftId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `rule-${Math.random().toString(36).slice(2, 10)}`;
}

function sortDrafts(a: ReviewRuleDraft, b: ReviewRuleDraft) {
  const aPresetIndex = ROLE_BUNDLE_KEYS.indexOf(a.roleKey as (typeof ROLE_BUNDLE_KEYS)[number]);
  const bPresetIndex = ROLE_BUNDLE_KEYS.indexOf(b.roleKey as (typeof ROLE_BUNDLE_KEYS)[number]);
  const aRank = aPresetIndex === -1 ? Number.MAX_SAFE_INTEGER : aPresetIndex;
  const bRank = bPresetIndex === -1 ? Number.MAX_SAFE_INTEGER : bPresetIndex;
  if (aRank !== bRank) return aRank - bRank;
  return a.roleKey.localeCompare(b.roleKey);
}

export function sortReviewRuleDrafts(drafts: ReviewRuleDraft[]) {
  return [...drafts].sort(sortDrafts);
}

export function buildReviewRuleDrafts(
  value: CompanyRequiredReviewByRole | null | undefined,
): ReviewRuleDraft[] {
  return sortReviewRuleDrafts(
    Object.entries(value ?? {}).map(([
      roleKey,
      rule,
    ]): ReviewRuleDraft => ({
      id: createDraftId(),
      roleKey,
      reviewPolicyKey: rule.reviewPolicyKey,
      reviewerRole: rule.reviewerRole ?? "",
      keyMode: ROLE_BUNDLE_KEYS.includes(roleKey as (typeof ROLE_BUNDLE_KEYS)[number]) ? "preset" : "custom",
    })),
  );
}

export function buildRequiredReviewByRole(
  drafts: ReviewRuleDraft[],
): { value: CompanyRequiredReviewByRole; error: string | null } {
  const next: CompanyRequiredReviewByRole = {};
  for (const draft of drafts) {
    const roleKey = draft.roleKey.trim();
    if (!roleKey) {
      return { value: next, error: "Every review rule needs a role bundle key." };
    }
    if (next[roleKey]) {
      return { value: next, error: `Duplicate review rule for \"${roleKey}\".` };
    }
    const reviewPolicyKey = draft.reviewPolicyKey.trim();
    if (!reviewPolicyKey) {
      return { value: next, error: `Rule \"${roleKey}\" is missing a review policy.` };
    }
    next[roleKey] = {
      reviewPolicyKey,
      reviewerRole: draft.reviewerRole.trim() || null,
    };
  }
  return { value: next, error: null };
}

export function buildPresetReviewRuleDraft(roleKey: string): ReviewRuleDraft {
  const defaultRule = DEFAULT_REQUIRED_REVIEW_BY_ROLE[roleKey];
  return {
    id: createDraftId(),
    roleKey,
    reviewPolicyKey: defaultRule?.reviewPolicyKey ?? REVIEW_POLICY_KEYS[0],
    reviewerRole: defaultRule?.reviewerRole ?? "",
    keyMode: "preset",
  };
}

export function buildCustomReviewRuleDraft(): ReviewRuleDraft {
  return {
    id: createDraftId(),
    roleKey: "",
    reviewPolicyKey: REVIEW_POLICY_KEYS[0],
    reviewerRole: "",
    keyMode: "custom",
  };
}
