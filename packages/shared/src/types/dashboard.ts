import type { WorkProductSummaryItem } from "./work-product.js";

export interface DashboardReviewItem {
  issueId: string;
  identifier: string | null;
  title: string;
  status: string;
  reviewPolicyKey: string;
  reviewerAgentId: string | null;
  reviewerUserId: string | null;
  projectId: string | null;
  projectName: string | null;
  updatedAt: Date;
}

export interface DashboardSummary {
  companyId: string;
  agents: {
    active: number;
    running: number;
    paused: number;
    error: number;
  };
  tasks: {
    open: number;
    inProgress: number;
    blocked: number;
    done: number;
  };
  costs: {
    monthSpendCents: number;
    monthBudgetCents: number;
    monthUtilizationPercent: number;
  };
  pendingApprovals: number;
  budgets: {
    activeIncidents: number;
    pendingApprovals: number;
    pausedAgents: number;
    pausedProjects: number;
  };
  outputs?: {
    activePreviews: number;
    readyForReview: number;
    failed: number;
    recent: WorkProductSummaryItem[];
    byProject: WorkProductSummaryItem[];
  };
  reviews?: {
    pending: number;
    missingReviewer: number;
    items: DashboardReviewItem[];
  };
}
