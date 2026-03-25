import { reviewableWorkProductTypesForPolicy } from "@paperclipai/shared";
import { unprocessable } from "../errors.js";
import type { workProductService } from "./work-products.js";

type CompletionGateIssue = {
  id: string;
  reviewerAgentId?: string | null;
  reviewerUserId?: string | null;
  reviewPolicyKey?: string | null;
};

type CompletionGatePatch = {
  status?: string;
  reviewerAgentId?: string | null;
  reviewerUserId?: string | null;
  reviewPolicyKey?: string | null;
};

export async function assertIssueCanCompleteWithReviewGate(
  workProductsSvc: ReturnType<typeof workProductService>,
  existing: CompletionGateIssue,
  patch: CompletionGatePatch,
) {
  const nextStatus = patch.status ?? null;
  const nextReviewPolicyKey =
    patch.reviewPolicyKey !== undefined ? patch.reviewPolicyKey : (existing.reviewPolicyKey ?? null);
  if (nextStatus !== "done" || !nextReviewPolicyKey) return;

  const nextReviewerAgentId =
    patch.reviewerAgentId !== undefined ? patch.reviewerAgentId : (existing.reviewerAgentId ?? null);
  const nextReviewerUserId =
    patch.reviewerUserId !== undefined ? patch.reviewerUserId : (existing.reviewerUserId ?? null);
  if (!nextReviewerAgentId && !nextReviewerUserId) {
    throw unprocessable("This issue requires a reviewer before it can be marked done");
  }

  const workProducts = (await workProductsSvc.listForIssue(existing.id)) ?? [];
  const reviewableTypes = reviewableWorkProductTypesForPolicy(nextReviewPolicyKey);
  const reviewableProducts = workProducts.filter((product) => reviewableTypes.includes(product.type));
  if (reviewableProducts.length === 0) {
    throw unprocessable("This issue requires a reviewable work product before it can be marked done");
  }

  const hasApprovedReview = reviewableProducts.some((product) =>
    product.reviewState === "approved" || product.status === "approved",
  );
  if (!hasApprovedReview) {
    throw unprocessable("This issue cannot be marked done until review is approved");
  }
}
