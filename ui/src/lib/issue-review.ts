import {
  REVIEW_POLICY_LABELS,
  reviewableWorkProductTypesForPolicy,
  type Issue,
  type IssueWorkProduct,
  type IssueWorkProductType,
} from "@paperclipai/shared";

const WORK_PRODUCT_TYPE_LABELS: Record<IssueWorkProductType, string> = {
  preview_url: "Preview",
  runtime_service: "Runtime",
  pull_request: "Pull Request",
  branch: "Branch",
  commit: "Commit",
  artifact: "Artifact",
  document: "Document",
};

export type IssueReviewStage =
  | "not_required"
  | "missing_setup"
  | "ready_for_handoff"
  | "awaiting_approval"
  | "changes_requested"
  | "approved";

export interface IssueReviewSummary {
  reviewRequired: boolean;
  reviewPolicyKey: string | null;
  reviewPolicyLabel: string | null;
  reviewerAssigned: boolean;
  reviewableTypes: readonly string[];
  reviewableTypeLabels: string[];
  reviewableProducts: IssueWorkProduct[];
  approvedProducts: IssueWorkProduct[];
  readyProducts: IssueWorkProduct[];
  changesRequestedProducts: IssueWorkProduct[];
  unhealthyProducts: IssueWorkProduct[];
  stage: IssueReviewStage;
  blockers: string[];
  warnings: string[];
  summary: string;
  detail: string;
  canMoveToDone: boolean;
  shouldSuggestInReview: boolean;
}

function hasApprovedReview(product: IssueWorkProduct) {
  return product.reviewState === "approved" || product.status === "approved";
}

function needsBoardReview(product: IssueWorkProduct) {
  return product.reviewState === "needs_board_review" || product.status === "ready_for_review";
}

function hasChangesRequested(product: IssueWorkProduct) {
  return product.reviewState === "changes_requested" || product.status === "changes_requested";
}

function needsAttention(product: IssueWorkProduct) {
  return product.healthStatus === "unhealthy" || product.status === "failed";
}

export function parseAcceptanceChecklistDraft(input: string) {
  return input
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter((line, index, items) => line.length > 0 && items.indexOf(line) === index);
}

export function getIssueReviewSummary(
  issue: Pick<Issue, "status" | "reviewPolicyKey" | "reviewerAgentId" | "reviewerUserId">,
  workProducts: IssueWorkProduct[],
): IssueReviewSummary {
  const reviewPolicyKey = issue.reviewPolicyKey ?? null;
  if (!reviewPolicyKey) {
    return {
      reviewRequired: false,
      reviewPolicyKey: null,
      reviewPolicyLabel: null,
      reviewerAssigned: false,
      reviewableTypes: [],
      reviewableTypeLabels: [],
      reviewableProducts: [],
      approvedProducts: [],
      readyProducts: [],
      changesRequestedProducts: [],
      unhealthyProducts: [],
      stage: "not_required",
      blockers: [],
      warnings: [],
      summary: "Review gate is not configured for this issue.",
      detail: "Outputs can still be attached, but completion is not blocked by a reviewer.",
      canMoveToDone: true,
      shouldSuggestInReview: false,
    };
  }

  const reviewableTypes = reviewableWorkProductTypesForPolicy(reviewPolicyKey);
  const reviewableProducts = workProducts.filter((product) => reviewableTypes.includes(product.type));
  const approvedProducts = reviewableProducts.filter(hasApprovedReview);
  const readyProducts = reviewableProducts.filter(needsBoardReview);
  const changesRequestedProducts = reviewableProducts.filter(hasChangesRequested);
  const unhealthyProducts = reviewableProducts.filter(needsAttention);
  const reviewerAssigned = Boolean(issue.reviewerAgentId || issue.reviewerUserId);
  const reviewableTypeLabels = reviewableTypes.map((type) =>
    WORK_PRODUCT_TYPE_LABELS[type as IssueWorkProductType] ?? type.replaceAll("_", " "),
  );

  const blockers: string[] = [];
  const warnings: string[] = [];
  if (!reviewerAssigned) {
    blockers.push("Assign a reviewer before closing this issue.");
  }
  if (reviewableProducts.length === 0) {
    blockers.push(`Attach at least one reviewable output: ${reviewableTypeLabels.join(", ")}.`);
  } else if (approvedProducts.length === 0) {
    blockers.push("At least one reviewable output must be approved before this issue can move to done.");
  }
  if (changesRequestedProducts.length > 0) {
    warnings.push("A reviewable output has changes requested. Publish an updated result before calling this review complete.");
  }
  if (unhealthyProducts.length > 0) {
    warnings.push("One or more reviewable outputs report failed or unhealthy status.");
  }

  let stage: IssueReviewStage = "awaiting_approval";
  let summary = "Review handoff is still in progress.";
  let detail = "Assign a reviewer, attach reviewable outputs, and collect approval before closing the issue.";

  if (!reviewerAssigned || reviewableProducts.length === 0) {
    stage = "missing_setup";
    summary = "Review gate is missing required setup.";
    detail = "This issue needs a reviewer and at least one accepted output type before review can complete.";
  } else if (approvedProducts.length > 0) {
    stage = "approved";
    summary = "Review gate is satisfied.";
    detail = "At least one reviewable output is approved, so this issue can move to done when the rest of the work is complete.";
  } else if (changesRequestedProducts.length > 0) {
    stage = "changes_requested";
    summary = "Review feedback is waiting on changes.";
    detail = "A reviewer or output status requested changes. Refresh the output and hand it back for review.";
  } else if (readyProducts.length > 0) {
    stage = "ready_for_handoff";
    summary = "Outputs are ready for reviewer handoff.";
    detail = "Move the issue into in review and make sure the reviewer knows which output to validate.";
  }

  return {
    reviewRequired: true,
    reviewPolicyKey,
    reviewPolicyLabel:
      REVIEW_POLICY_LABELS[reviewPolicyKey as keyof typeof REVIEW_POLICY_LABELS]
      ?? reviewPolicyKey.replaceAll("_", " "),
    reviewerAssigned,
    reviewableTypes,
    reviewableTypeLabels,
    reviewableProducts,
    approvedProducts,
    readyProducts,
    changesRequestedProducts,
    unhealthyProducts,
    stage,
    blockers,
    warnings,
    summary,
    detail,
    canMoveToDone: blockers.length === 0,
    shouldSuggestInReview:
      issue.status !== "in_review"
      && issue.status !== "done"
      && issue.status !== "cancelled"
      && reviewableProducts.length > 0,
  };
}
