import { and, asc, eq, inArray } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { approvalComments, approvals } from "@paperclipai/db";
import { notFound, unprocessable } from "../errors.js";
import { redactCurrentUserText } from "../log-redaction.js";
import { agentService } from "./agents.js";
import { budgetService } from "./budgets.js";
import { companySkillService } from "./company-skills.js";
import { heartbeatService } from "./heartbeat.js";
import { completeHireFollowUp } from "./hire-follow-up.js";
import { notifyHireApproved } from "./hire-hook.js";
import { instanceSettingsService } from "./instance-settings.js";
import type { ManagedPluginInstallRequest } from "./plugin-installs.js";

export interface ApprovalServiceOptions {
  installConnectorPlugin?: (input: ManagedPluginInstallRequest) => Promise<unknown>;
}

export function approvalService(db: Db, options: ApprovalServiceOptions = {}) {
  const agentsSvc = agentService(db);
  const budgets = budgetService(db);
  const companySkills = companySkillService(db);
  const heartbeat = heartbeatService(db);
  const instanceSettings = instanceSettingsService(db);
  const canResolveStatuses = new Set(["pending", "revision_requested"]);
  const resolvableStatuses = Array.from(canResolveStatuses);
  type ApprovalRecord = typeof approvals.$inferSelect;
  type ResolutionResult = {
    approval: ApprovalRecord;
    applied: boolean;
    followUpIssueId?: string | null;
    followUpIssueIds?: string[];
  };

  function redactApprovalComment<T extends { body: string }>(comment: T, censorUsernameInLogs: boolean): T {
    return {
      ...comment,
      body: redactCurrentUserText(comment.body, { enabled: censorUsernameInLogs }),
    };
  }

  function firstNonEmptyString(...values: unknown[]) {
    for (const value of values) {
      if (typeof value === "string" && value.trim().length > 0) {
        return value.trim();
      }
    }
    return null;
  }

  async function getExistingApproval(id: string) {
    const existing = await db
      .select()
      .from(approvals)
      .where(eq(approvals.id, id))
      .then((rows) => rows[0] ?? null);
    if (!existing) throw notFound("Approval not found");
    return existing;
  }

  async function resolveApproval(
    id: string,
    targetStatus: "approved" | "rejected",
    decidedByUserId: string,
    decisionNote: string | null | undefined,
  ): Promise<ResolutionResult> {
    const existing = await getExistingApproval(id);
    if (!canResolveStatuses.has(existing.status)) {
      if (existing.status === targetStatus) {
        return { approval: existing, applied: false };
      }
      throw unprocessable(
        `Only pending or revision requested approvals can be ${targetStatus === "approved" ? "approved" : "rejected"}`,
      );
    }

    const now = new Date();
    const updated = await db
      .update(approvals)
      .set({
        status: targetStatus,
        decidedByUserId,
        decisionNote: decisionNote ?? null,
        decidedAt: now,
        updatedAt: now,
      })
      .where(and(eq(approvals.id, id), inArray(approvals.status, resolvableStatuses)))
      .returning()
      .then((rows) => rows[0] ?? null);

    if (updated) {
      return { approval: updated, applied: true };
    }

    const latest = await getExistingApproval(id);
    if (latest.status === targetStatus) {
      return { approval: latest, applied: false };
    }

    throw unprocessable(
      `Only pending or revision requested approvals can be ${targetStatus === "approved" ? "approved" : "rejected"}`,
    );
  }

  return {
    list: (companyId: string, status?: string) => {
      const conditions = [eq(approvals.companyId, companyId)];
      if (status) conditions.push(eq(approvals.status, status));
      return db.select().from(approvals).where(and(...conditions));
    },

    getById: (id: string) =>
      db
        .select()
        .from(approvals)
        .where(eq(approvals.id, id))
        .then((rows) => rows[0] ?? null),

    create: (companyId: string, data: Omit<typeof approvals.$inferInsert, "companyId">) =>
      db
        .insert(approvals)
        .values({ ...data, companyId })
        .returning()
        .then((rows) => rows[0]),

    approve: async (id: string, decidedByUserId: string, decisionNote?: string | null) => {
      const { approval: updated, applied } = await resolveApproval(
        id,
        "approved",
        decidedByUserId,
        decisionNote,
      );

      let hireApprovedAgentId: string | null = null;
      let followUpIssueId: string | null = null;
      let followUpIssueIds: string[] = [];
      const now = new Date();
      if (applied && updated.type === "hire_agent") {
        const payload = updated.payload as Record<string, unknown>;
        const payloadAgentId = typeof payload.agentId === "string" ? payload.agentId : null;
        if (payloadAgentId) {
          await agentsSvc.activatePendingApproval(payloadAgentId);
          hireApprovedAgentId = payloadAgentId;
        } else {
          const created = await agentsSvc.create(updated.companyId, {
            name: String(payload.name ?? "New Agent"),
            role: String(payload.role ?? "general"),
            title: typeof payload.title === "string" ? payload.title : null,
            reportsTo: typeof payload.reportsTo === "string" ? payload.reportsTo : null,
            capabilities: typeof payload.capabilities === "string" ? payload.capabilities : null,
            adapterType: String(payload.adapterType ?? "process"),
            adapterConfig:
              typeof payload.adapterConfig === "object" && payload.adapterConfig !== null
                ? (payload.adapterConfig as Record<string, unknown>)
                : {},
            budgetMonthlyCents:
              typeof payload.budgetMonthlyCents === "number" ? payload.budgetMonthlyCents : 0,
            metadata:
              typeof payload.metadata === "object" && payload.metadata !== null
                ? (payload.metadata as Record<string, unknown>)
                : null,
            status: "idle",
            spentMonthlyCents: 0,
            permissions: undefined,
            lastHeartbeatAt: null,
          });
          hireApprovedAgentId = created?.id ?? null;
        }
        if (hireApprovedAgentId) {
          const budgetMonthlyCents =
            typeof payload.budgetMonthlyCents === "number" ? payload.budgetMonthlyCents : 0;
          if (budgetMonthlyCents > 0) {
            await budgets.upsertPolicy(
              updated.companyId,
              {
                scopeType: "agent",
                scopeId: hireApprovedAgentId,
                amount: budgetMonthlyCents,
                windowKind: "calendar_month_utc",
              },
              decidedByUserId,
            );
          }
          let followUp = {
            issueId: null as string | null,
            issueIds: [] as string[],
            message: "Your hire was approved. Wait for a manager to assign your first task.",
          };
          try {
            followUp = await completeHireFollowUp(db, heartbeat, {
              companyId: updated.companyId,
              agentId: hireApprovedAgentId,
              agentName:
                typeof payload.name === "string" && payload.name.trim().length > 0
                  ? payload.name
                  : "New Agent",
              role:
                typeof payload.role === "string" && payload.role.trim().length > 0
                  ? payload.role
                  : "general",
              roleBundleKey:
                typeof payload.roleBundleKey === "string" && payload.roleBundleKey.trim().length > 0
                  ? payload.roleBundleKey
                  : null,
              reportsTo:
                typeof payload.reportsTo === "string" && payload.reportsTo.trim().length > 0
                  ? payload.reportsTo
                  : null,
              staffingReason:
                typeof payload.staffingReason === "string" && payload.staffingReason.trim().length > 0
                  ? payload.staffingReason
                  : null,
              requestedByAgentId:
                typeof updated.requestedByAgentId === "string" && updated.requestedByAgentId.trim().length > 0
                  ? updated.requestedByAgentId
                  : null,
              requestedByUserId:
                typeof updated.requestedByUserId === "string" && updated.requestedByUserId.trim().length > 0
                  ? updated.requestedByUserId
                  : null,
              sourceIssueIds: Array.isArray(payload.sourceIssueIds)
                ? payload.sourceIssueIds.filter((value): value is string => typeof value === "string" && value.length > 0)
                : [],
              followUpIssueId:
                typeof payload.followUpIssueId === "string" && payload.followUpIssueId.trim().length > 0
                  ? payload.followUpIssueId
                  : null,
              followUpAction:
                typeof payload.followUpAction === "string" && payload.followUpAction.trim().length > 0
                  ? payload.followUpAction as "auto" | "assign_source_issue" | "assign_existing_issue" | "create_follow_up_issue" | "none"
                  : null,
              approvalId: updated.id,
              sourceId: id,
            });
          } catch {
            // Approval resolution should still succeed if automatic follow-up assignment cannot be prepared.
          }
          followUpIssueId = followUp.issueId;
          followUpIssueIds = followUp.issueIds;
          void notifyHireApproved(db, {
            companyId: updated.companyId,
            agentId: hireApprovedAgentId,
            source: "approval",
            sourceId: id,
            approvedAt: now,
            message: followUp.message,
            issueId: followUp.issueId,
            issueIds: followUp.issueIds,
          }).catch(() => {});
        }
        return { approval: updated, applied, followUpIssueId, followUpIssueIds };
      }

      if (applied && updated.type === "install_company_skill") {
        const payload = updated.payload as Record<string, unknown>;
        const skillId = typeof payload.skillId === "string" ? payload.skillId : null;
        const source = typeof payload.source === "string" ? payload.source : null;
        if (skillId) {
          await companySkills.installUpdate(updated.companyId, skillId);
        } else if (source) {
          await companySkills.importFromSource(updated.companyId, source);
        }
      }

      if (applied && updated.type === "install_connector_plugin") {
        if (!options.installConnectorPlugin) {
          throw new Error("Connector plugin installation is not enabled");
        }

        const payload = updated.payload as Record<string, unknown>;
        await options.installConnectorPlugin({
          packageName: firstNonEmptyString(
            payload.packageName,
            payload.pluginPackageName,
            payload.pluginPackage,
            payload.localPath,
            payload.source,
          ) ?? "",
          version: firstNonEmptyString(payload.version) ?? undefined,
          isLocalPath:
            payload.isLocalPath === true
            || typeof payload.localPath === "string",
          source:
            payload.isLocalPath === true || typeof payload.localPath === "string"
              ? "local_path"
              : "npm",
        });
      }

      return { approval: updated, applied };
    },

    reject: async (id: string, decidedByUserId: string, decisionNote?: string | null) => {
      const { approval: updated, applied } = await resolveApproval(
        id,
        "rejected",
        decidedByUserId,
        decisionNote,
      );

      if (applied && updated.type === "hire_agent") {
        const payload = updated.payload as Record<string, unknown>;
        const payloadAgentId = typeof payload.agentId === "string" ? payload.agentId : null;
        if (payloadAgentId) {
          await agentsSvc.terminate(payloadAgentId);
        }
      }

      return { approval: updated, applied };
    },

    requestRevision: async (id: string, decidedByUserId: string, decisionNote?: string | null) => {
      const existing = await getExistingApproval(id);
      if (existing.status !== "pending") {
        throw unprocessable("Only pending approvals can request revision");
      }

      const now = new Date();
      return db
        .update(approvals)
        .set({
          status: "revision_requested",
          decidedByUserId,
          decisionNote: decisionNote ?? null,
          decidedAt: now,
          updatedAt: now,
        })
        .where(eq(approvals.id, id))
        .returning()
        .then((rows) => rows[0]);
    },

    resubmit: async (id: string, payload?: Record<string, unknown>) => {
      const existing = await getExistingApproval(id);
      if (existing.status !== "revision_requested") {
        throw unprocessable("Only revision requested approvals can be resubmitted");
      }

      const now = new Date();
      return db
        .update(approvals)
        .set({
          status: "pending",
          payload: payload ?? existing.payload,
          decisionNote: null,
          decidedByUserId: null,
          decidedAt: null,
          updatedAt: now,
        })
        .where(eq(approvals.id, id))
        .returning()
        .then((rows) => rows[0]);
    },

    listComments: async (approvalId: string) => {
      const existing = await getExistingApproval(approvalId);
      const { censorUsernameInLogs } = await instanceSettings.getGeneral();
      return db
        .select()
        .from(approvalComments)
        .where(
          and(
            eq(approvalComments.approvalId, approvalId),
            eq(approvalComments.companyId, existing.companyId),
          ),
        )
        .orderBy(asc(approvalComments.createdAt))
        .then((comments) => comments.map((comment) => redactApprovalComment(comment, censorUsernameInLogs)));
    },

    addComment: async (
      approvalId: string,
      body: string,
      actor: { agentId?: string; userId?: string },
    ) => {
      const existing = await getExistingApproval(approvalId);
      const currentUserRedactionOptions = {
        enabled: (await instanceSettings.getGeneral()).censorUsernameInLogs,
      };
      const redactedBody = redactCurrentUserText(body, currentUserRedactionOptions);
      return db
        .insert(approvalComments)
        .values({
          companyId: existing.companyId,
          approvalId,
          authorAgentId: actor.agentId ?? null,
          authorUserId: actor.userId ?? null,
          body: redactedBody,
        })
        .returning()
        .then((rows) => redactApprovalComment(rows[0], currentUserRedactionOptions.enabled));
    },
  };
}
