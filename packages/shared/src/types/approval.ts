import type { ApprovalStatus, ApprovalType } from "../constants.js";

export interface PublishContentApprovalPayload {
  channel?: string;
  destinationLabel?: string;
  publishAt?: string;
  authorVoice?: string;
  sourceSummary?: string;
  draftExcerpt?: string;
  finalDocumentId?: string;
  draftDocumentId?: string;
  sourceDocumentId?: string;
  riskFlags?: string[];
  safetyChecks?: string[];
}

export interface Approval {
  id: string;
  companyId: string;
  type: ApprovalType;
  requestedByAgentId: string | null;
  requestedByUserId: string | null;
  status: ApprovalStatus;
  payload: Record<string, unknown>;
  decisionNote: string | null;
  decidedByUserId: string | null;
  decidedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ApprovalComment {
  id: string;
  companyId: string;
  approvalId: string;
  authorAgentId: string | null;
  authorUserId: string | null;
  body: string;
  createdAt: Date;
  updatedAt: Date;
}
