import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { agents, approvals, companies, costEvents, issues, projects } from "@paperclipai/db";
import { notFound } from "../errors.js";
import { budgetService } from "./budgets.js";
import { workProductService } from "./work-products.js";

export function dashboardService(db: Db) {
  const budgets = budgetService(db);
  const workProducts = workProductService(db);
  return {
    summary: async (companyId: string) => {
      const company = await db
        .select()
        .from(companies)
        .where(eq(companies.id, companyId))
        .then((rows) => rows[0] ?? null);

      if (!company) throw notFound("Company not found");

      const agentRows = await db
        .select({ status: agents.status, count: sql<number>`count(*)` })
        .from(agents)
        .where(eq(agents.companyId, companyId))
        .groupBy(agents.status);

      const taskRows = await db
        .select({ status: issues.status, count: sql<number>`count(*)` })
        .from(issues)
        .where(eq(issues.companyId, companyId))
        .groupBy(issues.status);

      const pendingApprovals = await db
        .select({ count: sql<number>`count(*)` })
        .from(approvals)
        .where(and(eq(approvals.companyId, companyId), eq(approvals.status, "pending")))
        .then((rows) => Number(rows[0]?.count ?? 0));

      const agentCounts: Record<string, number> = {
        active: 0,
        running: 0,
        paused: 0,
        error: 0,
      };
      for (const row of agentRows) {
        const count = Number(row.count);
        // "idle" agents are operational — count them as active
        const bucket = row.status === "idle" ? "active" : row.status;
        agentCounts[bucket] = (agentCounts[bucket] ?? 0) + count;
      }

      const taskCounts: Record<string, number> = {
        open: 0,
        inProgress: 0,
        blocked: 0,
        done: 0,
      };
      for (const row of taskRows) {
        const count = Number(row.count);
        if (row.status === "in_progress") taskCounts.inProgress += count;
        if (row.status === "blocked") taskCounts.blocked += count;
        if (row.status === "done") taskCounts.done += count;
        if (row.status !== "done" && row.status !== "cancelled") taskCounts.open += count;
      }

      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const [{ monthSpend }] = await db
        .select({
          monthSpend: sql<number>`coalesce(sum(${costEvents.costCents}), 0)::int`,
        })
        .from(costEvents)
        .where(
          and(
            eq(costEvents.companyId, companyId),
            gte(costEvents.occurredAt, monthStart),
          ),
        );

      const monthSpendCents = Number(monthSpend);
      const utilization =
        company.budgetMonthlyCents > 0
          ? (monthSpendCents / company.budgetMonthlyCents) * 100
          : 0;
      const budgetOverview = await budgets.overview(companyId);
      const [outputSummary, reviewRows] = await Promise.all([
        workProducts.summarizeForDashboard(companyId),
        db
          .select({
            issueId: issues.id,
            identifier: issues.identifier,
            title: issues.title,
            status: issues.status,
            reviewPolicyKey: issues.reviewPolicyKey,
            reviewerAgentId: issues.reviewerAgentId,
            reviewerUserId: issues.reviewerUserId,
            projectId: issues.projectId,
            projectName: projects.name,
            updatedAt: issues.updatedAt,
          })
          .from(issues)
          .leftJoin(projects, eq(projects.id, issues.projectId))
          .where(
            and(
              eq(issues.companyId, companyId),
              sql`${issues.reviewPolicyKey} is not null`,
              inArray(issues.status, ["todo", "in_progress", "in_review"]),
            ),
          )
          .orderBy(desc(issues.updatedAt))
          .limit(6),
      ]);

      return {
        companyId,
        agents: {
          active: agentCounts.active,
          running: agentCounts.running,
          paused: agentCounts.paused,
          error: agentCounts.error,
        },
        tasks: taskCounts,
        costs: {
          monthSpendCents,
          monthBudgetCents: company.budgetMonthlyCents,
          monthUtilizationPercent: Number(utilization.toFixed(2)),
        },
        pendingApprovals,
        budgets: {
          activeIncidents: budgetOverview.activeIncidents.length,
          pendingApprovals: budgetOverview.pendingApprovalCount,
          pausedAgents: budgetOverview.pausedAgentCount,
          pausedProjects: budgetOverview.pausedProjectCount,
        },
        outputs: outputSummary,
        reviews: {
          pending: reviewRows.filter((row) => row.status === "in_review").length,
          missingReviewer: reviewRows.filter((row) => !row.reviewerAgentId && !row.reviewerUserId).length,
          items: reviewRows
            .filter((row) => typeof row.reviewPolicyKey === "string" && row.reviewPolicyKey.length > 0)
            .map((row) => ({
              issueId: row.issueId,
              identifier: row.identifier,
              title: row.title,
              status: row.status,
              reviewPolicyKey: row.reviewPolicyKey!,
              reviewerAgentId: row.reviewerAgentId,
              reviewerUserId: row.reviewerUserId,
              projectId: row.projectId,
              projectName: row.projectName,
              updatedAt: row.updatedAt,
            })),
        },
      };
    },
  };
}
