import { and, eq, inArray, notInArray } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { agents, companies, issues } from "@paperclipai/db";
import { logActivity } from "./activity-log.js";
import { issueService } from "./issues.js";
import { queueIssueAssignmentWakeup } from "./issue-assignment-wakeup.js";
import { normalizeCompanyAutonomySettings, resolveReviewRuleForRole } from "./autonomy-policy.js";
import { resolveRoleBundle } from "./role-bundles.js";
import { notFound } from "../errors.js";

type FollowUpAction =
  | "auto"
  | "assign_source_issue"
  | "assign_existing_issue"
  | "create_follow_up_issue"
  | "none";

export interface HireFollowUpInput {
  companyId: string;
  agentId: string;
  agentName: string;
  role: string;
  roleBundleKey?: string | null;
  reportsTo?: string | null;
  staffingReason?: string | null;
  requestedByAgentId?: string | null;
  requestedByUserId?: string | null;
  sourceIssueIds?: string[];
  followUpIssueId?: string | null;
  followUpAction?: FollowUpAction | null;
  approvalId?: string | null;
  sourceId?: string | null;
}

export interface HireFollowUpResult {
  issueId: string | null;
  issueIds: string[];
  message: string;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function dedupe(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))));
}

function buildChecklist(reviewPolicyKey: string | null): string[] | null {
  if (reviewPolicyKey === "design_review") {
    return [
      "Attach a primary preview, runtime, artifact, or document work product.",
      "Polish hierarchy, spacing, and visual clarity across desktop and mobile.",
      "Make navigation, primary actions, and project links obvious at a glance.",
      "Do not mark the task done until design review is approved.",
    ];
  }
  if (reviewPolicyKey === "qa_review") {
    return [
      "Capture the tested output or runtime entry point as a work product.",
      "List pass/fail checks and unresolved risks before asking for review.",
    ];
  }
  if (reviewPolicyKey === "content_review") {
    return [
      "Attach the draft or publication artifact as a work product.",
      "Do not mark the task done until editorial review is approved.",
    ];
  }
  return null;
}

function buildCreatedIssueTitle(input: {
  roleBundleLabel: string;
  staffingReason: string | null;
  sourceIssueTitle: string | null;
}) {
  if (input.staffingReason) return input.staffingReason;
  if (input.sourceIssueTitle) return `${input.roleBundleLabel}: ${input.sourceIssueTitle}`;
  return `${input.roleBundleLabel} follow-up`;
}

function buildCreatedIssueDescription(input: {
  agentName: string;
  staffingReason: string | null;
  sourceIssueIdentifier: string | null;
  sourceIssueTitle: string | null;
  reviewPolicyKey: string | null;
}) {
  const parts = [
    `Auto-created after hiring ${input.agentName}.`,
    input.staffingReason ? `Reason: ${input.staffingReason}` : null,
    input.sourceIssueIdentifier || input.sourceIssueTitle
      ? `Source issue: ${input.sourceIssueIdentifier ?? ""} ${input.sourceIssueTitle ?? ""}`.trim()
      : null,
    input.reviewPolicyKey
      ? `Review policy: ${input.reviewPolicyKey}. Attach reviewable work products before completion.`
      : "Attach clear work products so the result is easy to review and open.",
  ].filter((value): value is string => Boolean(value));

  return parts.join("\n\n");
}

async function resolveReviewerAssignment(db: Db, input: {
  companyId: string;
  hireAgentId: string;
  preferredReviewerRole: string | null;
  reportsTo?: string | null;
  requestedByAgentId?: string | null;
  requestedByUserId?: string | null;
}) {
  const preferred = dedupe([
    input.reportsTo ?? null,
    input.requestedByAgentId ?? null,
  ]);
  if (input.preferredReviewerRole) {
    const preferredMatches = await db
      .select({ id: agents.id, role: agents.role })
      .from(agents)
      .where(
        and(
          eq(agents.companyId, input.companyId),
          eq(agents.role, input.preferredReviewerRole),
          notInArray(agents.status, ["terminated", "pending_approval"]),
          notInArray(agents.id, [input.hireAgentId]),
        ),
      );
    for (const preferredId of preferred) {
      const match = preferredMatches.find((agent) => agent.id === preferredId);
      if (match) {
        return { reviewerAgentId: match.id, reviewerUserId: null };
      }
    }
    if (preferredMatches[0]) {
      return { reviewerAgentId: preferredMatches[0].id, reviewerUserId: null };
    }
  }

  if (preferred[0]) {
    return { reviewerAgentId: preferred[0], reviewerUserId: null };
  }

  return {
    reviewerAgentId: null,
    reviewerUserId: input.requestedByUserId ?? null,
  };
}

function canReassignExistingIssue(issue: typeof issues.$inferSelect, input: HireFollowUpInput) {
  if (issue.status === "done" || issue.status === "cancelled") return false;
  if (!issue.assigneeAgentId && !issue.assigneeUserId) return true;
  if (input.requestedByAgentId && issue.assigneeAgentId === input.requestedByAgentId) return true;
  if (input.requestedByUserId && issue.assigneeUserId === input.requestedByUserId) return true;
  return false;
}

export async function completeHireFollowUp(
  db: Db,
  heartbeat: { wakeup: Parameters<typeof queueIssueAssignmentWakeup>[0]["heartbeat"]["wakeup"] },
  input: HireFollowUpInput,
): Promise<HireFollowUpResult> {
  const issuesSvc = issueService(db);
  const companyRow = await db
    .select()
    .from(companies)
    .where(eq(companies.id, input.companyId))
    .then((rows) => rows[0] ?? null);
  if (!companyRow) throw notFound("Company not found");
  const company = normalizeCompanyAutonomySettings(companyRow);

  if (!company.autoAssignApprovedHires) {
    return {
      issueId: null,
      issueIds: [],
      message: "Your hire was approved. Automatic follow-up assignment is disabled for this company, so a board operator should assign the first issue.",
    };
  }

  const roleBundle = resolveRoleBundle(input.roleBundleKey, input.role);
  const reviewRule =
    resolveReviewRuleForRole(company.requiredReviewByRole, roleBundle.key)
    ?? (roleBundle.defaultReviewPolicyKey
      ? {
          reviewPolicyKey: roleBundle.defaultReviewPolicyKey,
          reviewerRole: roleBundle.defaultReviewerRole,
        }
      : null);
  const reviewerAssignment = await resolveReviewerAssignment(db, {
    companyId: input.companyId,
    hireAgentId: input.agentId,
    preferredReviewerRole: reviewRule?.reviewerRole ?? null,
    reportsTo: input.reportsTo ?? null,
    requestedByAgentId: input.requestedByAgentId ?? null,
    requestedByUserId: input.requestedByUserId ?? null,
  });
  const acceptanceChecklistJson = buildChecklist(reviewRule?.reviewPolicyKey ?? null);

  const sourceIssueIds = dedupe([
    input.followUpIssueId ?? null,
    ...(input.sourceIssueIds ?? []),
  ]);
  const sourceIssues = sourceIssueIds.length > 0
    ? await db
        .select()
        .from(issues)
        .where(and(eq(issues.companyId, input.companyId), inArray(issues.id, sourceIssueIds)))
    : [];
  const issueById = new Map(sourceIssues.map((issue) => [issue.id, issue]));
  const explicitFollowUpIssue =
    input.followUpIssueId && issueById.has(input.followUpIssueId)
      ? issueById.get(input.followUpIssueId) ?? null
      : null;
  const firstSourceIssue = sourceIssues[0] ?? null;

  const preferredExistingIssue =
    explicitFollowUpIssue
    ?? (input.followUpAction !== "create_follow_up_issue" ? firstSourceIssue : null);

  let targetIssue = null as Awaited<ReturnType<typeof issuesSvc.getById>> | null;
  let createdIssue = false;

  if (
    preferredExistingIssue
    && input.followUpAction !== "none"
    && (input.followUpAction === "assign_existing_issue"
      || input.followUpAction === "assign_source_issue"
      || input.followUpAction === "auto")
    && canReassignExistingIssue(preferredExistingIssue, input)
  ) {
    const nextStatus =
      preferredExistingIssue.status === "backlog" ? "todo" : preferredExistingIssue.status;
    targetIssue = await issuesSvc.update(preferredExistingIssue.id, {
      assigneeAgentId: input.agentId,
      assigneeUserId: null,
      status: nextStatus,
      reviewerAgentId: reviewerAssignment.reviewerAgentId,
      reviewerUserId: reviewerAssignment.reviewerUserId,
      reviewPolicyKey: reviewRule?.reviewPolicyKey ?? null,
      acceptanceChecklistJson,
    });
    if (targetIssue) {
      await issuesSvc.addComment(
        targetIssue.id,
        `Auto-assigned to ${input.agentName} after hire approval.${input.staffingReason ? `\n\nReason: ${input.staffingReason}` : ""}`,
        {},
      );
      await logActivity(db, {
        companyId: input.companyId,
        actorType: "system",
        actorId: "hire_follow_up",
        action: "issue.updated",
        entityType: "issue",
        entityId: targetIssue.id,
        details: {
          assigneeAgentId: input.agentId,
          reviewerAgentId: reviewerAssignment.reviewerAgentId,
          reviewerUserId: reviewerAssignment.reviewerUserId,
          reviewPolicyKey: reviewRule?.reviewPolicyKey ?? null,
          source: "hire_follow_up",
        },
      });
    }
  }

  if (!targetIssue && input.followUpAction !== "none") {
    const sourceIssue = explicitFollowUpIssue ?? firstSourceIssue;
    targetIssue = await issuesSvc.create(input.companyId, {
      projectId: sourceIssue?.projectId ?? null,
      goalId: sourceIssue?.goalId ?? null,
      parentId: sourceIssue?.id ?? null,
      title: buildCreatedIssueTitle({
        roleBundleLabel: roleBundle.label,
        staffingReason: input.staffingReason ?? null,
        sourceIssueTitle: sourceIssue?.title ?? null,
      }),
      description: buildCreatedIssueDescription({
        agentName: input.agentName,
        staffingReason: input.staffingReason ?? null,
        sourceIssueIdentifier: sourceIssue?.identifier ?? null,
        sourceIssueTitle: sourceIssue?.title ?? null,
        reviewPolicyKey: reviewRule?.reviewPolicyKey ?? null,
      }),
      status: "todo",
      assigneeAgentId: input.agentId,
      assigneeUserId: null,
      reviewerAgentId: reviewerAssignment.reviewerAgentId,
      reviewerUserId: reviewerAssignment.reviewerUserId,
      reviewPolicyKey: reviewRule?.reviewPolicyKey ?? null,
      acceptanceChecklistJson,
      createdByAgentId: input.requestedByAgentId ?? null,
      createdByUserId: input.requestedByUserId ?? null,
    });
    createdIssue = Boolean(targetIssue);
    if (targetIssue && sourceIssue) {
      await issuesSvc.addComment(
        sourceIssue.id,
        `Created follow-up issue ${targetIssue.identifier ?? targetIssue.id.slice(0, 8)} for ${input.agentName}.`,
        {},
      );
    }
    if (targetIssue) {
      await logActivity(db, {
        companyId: input.companyId,
        actorType: "system",
        actorId: "hire_follow_up",
        action: "issue.created",
        entityType: "issue",
        entityId: targetIssue.id,
        details: {
          title: targetIssue.title,
          identifier: targetIssue.identifier,
          source: "hire_follow_up",
          hiredAgentId: input.agentId,
        },
      });
    }
  }

  if (!targetIssue) {
    return {
      issueId: null,
      issueIds: [],
      message: "Your hire was approved. No follow-up issue was assigned automatically.",
    };
  }

  void queueIssueAssignmentWakeup({
    heartbeat,
    issue: targetIssue,
    reason: "hire_follow_up_ready",
    mutation: createdIssue ? "create" : "update",
    contextSource: "hire.follow_up",
    requestedByActorType: input.requestedByAgentId || input.requestedByUserId ? "system" : "system",
    requestedByActorId: input.approvalId ?? input.sourceId ?? "hire_follow_up",
  });

  if (input.requestedByAgentId && input.requestedByAgentId !== input.agentId) {
    void heartbeat.wakeup(input.requestedByAgentId, {
      source: "automation",
      triggerDetail: "system",
      reason: "hire_follow_up_ready",
      payload: {
        agentId: input.agentId,
        issueId: targetIssue.id,
        approvalId: input.approvalId ?? null,
      },
      requestedByActorType: "system",
      requestedByActorId: input.approvalId ?? input.sourceId ?? "hire_follow_up",
      contextSnapshot: {
        source: "hire.follow_up",
        hiredAgentId: input.agentId,
        issueId: targetIssue.id,
        approvalId: input.approvalId ?? null,
      },
    }).catch(() => null);
  }

  return {
    issueId: targetIssue.id,
    issueIds: [targetIssue.id],
    message: `Your hire was approved. Start with issue ${targetIssue.identifier ?? targetIssue.id.slice(0, 8)}.`,
  };
}
