import type {
  AgentRole,
  CompanyArchetype,
  CompanyStatus,
  PauseReason,
  ToolInstallPolicy,
} from "../constants.js";

export interface CompanyRequiredReviewRule {
  reviewPolicyKey: string;
  reviewerRole?: AgentRole | string | null;
}

export type CompanyRequiredReviewByRole = Record<string, CompanyRequiredReviewRule>;

export interface Company {
  id: string;
  name: string;
  description: string | null;
  status: CompanyStatus;
  pauseReason: PauseReason | null;
  pausedAt: Date | null;
  companyArchetype?: CompanyArchetype;
  toolInstallPolicy?: ToolInstallPolicy;
  autoAssignApprovedHires?: boolean;
  requiredReviewByRole?: CompanyRequiredReviewByRole | null;
  issuePrefix: string;
  issueCounter: number;
  budgetMonthlyCents: number;
  spentMonthlyCents: number;
  requireBoardApprovalForNewAgents: boolean;
  brandColor: string | null;
  logoAssetId: string | null;
  logoUrl: string | null;
  createdAt: Date;
  updatedAt: Date;
}
