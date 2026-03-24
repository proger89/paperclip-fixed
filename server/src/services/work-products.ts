import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { issueWorkProducts, issues, projects } from "@paperclipai/db";
import type { IssuePrimaryWorkProducts, IssueWorkProduct, WorkProductSummaryItem } from "@paperclipai/shared";

type IssueWorkProductRow = typeof issueWorkProducts.$inferSelect;
type WorkProductSummaryRow = IssueWorkProductRow & {
  issueIdentifier: string | null;
  issueTitle: string;
  projectName: string | null;
};

const workProductSummarySelection = {
  id: issueWorkProducts.id,
  companyId: issueWorkProducts.companyId,
  projectId: issueWorkProducts.projectId,
  issueId: issueWorkProducts.issueId,
  executionWorkspaceId: issueWorkProducts.executionWorkspaceId,
  runtimeServiceId: issueWorkProducts.runtimeServiceId,
  type: issueWorkProducts.type,
  provider: issueWorkProducts.provider,
  externalId: issueWorkProducts.externalId,
  title: issueWorkProducts.title,
  url: issueWorkProducts.url,
  status: issueWorkProducts.status,
  reviewState: issueWorkProducts.reviewState,
  isPrimary: issueWorkProducts.isPrimary,
  healthStatus: issueWorkProducts.healthStatus,
  summary: issueWorkProducts.summary,
  metadata: issueWorkProducts.metadata,
  createdByRunId: issueWorkProducts.createdByRunId,
  createdAt: issueWorkProducts.createdAt,
  updatedAt: issueWorkProducts.updatedAt,
  issueIdentifier: issues.identifier,
  issueTitle: issues.title,
  projectName: projects.name,
} as const;

function toIssueWorkProduct(row: IssueWorkProductRow): IssueWorkProduct {
  return {
    id: row.id,
    companyId: row.companyId,
    projectId: row.projectId ?? null,
    issueId: row.issueId,
    executionWorkspaceId: row.executionWorkspaceId ?? null,
    runtimeServiceId: row.runtimeServiceId ?? null,
    type: row.type as IssueWorkProduct["type"],
    provider: row.provider,
    externalId: row.externalId ?? null,
    title: row.title,
    url: row.url ?? null,
    status: row.status,
    reviewState: row.reviewState as IssueWorkProduct["reviewState"],
    isPrimary: row.isPrimary,
    healthStatus: row.healthStatus as IssueWorkProduct["healthStatus"],
    summary: row.summary ?? null,
    metadata: (row.metadata as Record<string, unknown> | null) ?? null,
    createdByRunId: row.createdByRunId ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toWorkProductSummary(row: WorkProductSummaryRow): WorkProductSummaryItem {
  return {
    ...toIssueWorkProduct(row),
    issueIdentifier: row.issueIdentifier,
    issueTitle: row.issueTitle,
    projectName: row.projectName,
  };
}

export function buildPrimaryWorkProducts(workProducts: IssueWorkProduct[]): IssuePrimaryWorkProducts {
  return workProducts.reduce<IssuePrimaryWorkProducts>((acc, product) => {
    if (!acc[product.type] || product.isPrimary) {
      acc[product.type] = product;
    }
    return acc;
  }, {});
}

export function workProductService(db: Db) {
  return {
    listForIssue: async (issueId: string) => {
      const rows = await db
        .select()
        .from(issueWorkProducts)
        .where(eq(issueWorkProducts.issueId, issueId))
        .orderBy(desc(issueWorkProducts.isPrimary), desc(issueWorkProducts.updatedAt));
      return rows.map(toIssueWorkProduct);
    },

    listProjectOutputs: async (projectId: string, limit = 8) => {
      const rows = await db
        .select(workProductSummarySelection)
        .from(issueWorkProducts)
        .innerJoin(issues, eq(issues.id, issueWorkProducts.issueId))
        .leftJoin(projects, eq(projects.id, issueWorkProducts.projectId))
        .where(eq(issueWorkProducts.projectId, projectId))
        .orderBy(desc(issueWorkProducts.isPrimary), desc(issueWorkProducts.updatedAt))
        .limit(limit);
      return rows.map((row) => toWorkProductSummary(row as WorkProductSummaryRow));
    },

    summarizeForDashboard: async (companyId: string, options?: { recentLimit?: number; byProjectLimit?: number }) => {
      const recentLimit = options?.recentLimit ?? 8;
      const byProjectLimit = options?.byProjectLimit ?? 6;
      const [countRow] = await db
        .select({
          activePreviews: sql<number>`count(*) filter (
            where ${issueWorkProducts.type} = 'preview_url'
            and ${issueWorkProducts.status} = 'active'
          )::int`,
          readyForReview: sql<number>`count(*) filter (
            where ${issueWorkProducts.status} = 'ready_for_review'
            or ${issueWorkProducts.reviewState} = 'needs_board_review'
          )::int`,
          failed: sql<number>`count(*) filter (
            where ${issueWorkProducts.type} in ('preview_url', 'runtime_service')
            and (${issueWorkProducts.status} = 'failed' or ${issueWorkProducts.healthStatus} = 'unhealthy')
          )::int`,
        })
        .from(issueWorkProducts)
        .where(eq(issueWorkProducts.companyId, companyId));

      const candidateRows = await db
        .select(workProductSummarySelection)
        .from(issueWorkProducts)
        .innerJoin(issues, eq(issues.id, issueWorkProducts.issueId))
        .leftJoin(projects, eq(projects.id, issueWorkProducts.projectId))
        .where(
          and(
            eq(issueWorkProducts.companyId, companyId),
            or(
              eq(issueWorkProducts.isPrimary, true),
              inArray(issueWorkProducts.type, ["preview_url", "runtime_service", "pull_request", "artifact", "document"]),
            ),
          ),
        )
        .orderBy(desc(issueWorkProducts.isPrimary), desc(issueWorkProducts.updatedAt))
        .limit(Math.max(recentLimit * 3, byProjectLimit * 6, 18));

      const summaries = candidateRows.map((row) => toWorkProductSummary(row as WorkProductSummaryRow));
      const byProject: WorkProductSummaryItem[] = [];
      const seenProjects = new Set<string>();
      for (const item of summaries) {
        const key = item.projectId ?? item.issueId;
        if (seenProjects.has(key)) continue;
        seenProjects.add(key);
        byProject.push(item);
        if (byProject.length >= byProjectLimit) break;
      }

      return {
        activePreviews: Number(countRow?.activePreviews ?? 0),
        readyForReview: Number(countRow?.readyForReview ?? 0),
        failed: Number(countRow?.failed ?? 0),
        recent: summaries.slice(0, recentLimit),
        byProject,
      };
    },

    getById: async (id: string) => {
      const row = await db
        .select()
        .from(issueWorkProducts)
        .where(eq(issueWorkProducts.id, id))
        .then((rows) => rows[0] ?? null);
      return row ? toIssueWorkProduct(row) : null;
    },

    createForIssue: async (issueId: string, companyId: string, data: Omit<typeof issueWorkProducts.$inferInsert, "issueId" | "companyId">) => {
      const row = await db.transaction(async (tx) => {
        if (data.isPrimary) {
          await tx
            .update(issueWorkProducts)
            .set({ isPrimary: false, updatedAt: new Date() })
            .where(
              and(
                eq(issueWorkProducts.companyId, companyId),
                eq(issueWorkProducts.issueId, issueId),
                eq(issueWorkProducts.type, data.type),
              ),
            );
        }
        return await tx
          .insert(issueWorkProducts)
          .values({
            ...data,
            companyId,
            issueId,
          })
          .returning()
          .then((rows) => rows[0] ?? null);
      });
      return row ? toIssueWorkProduct(row) : null;
    },

    update: async (id: string, patch: Partial<typeof issueWorkProducts.$inferInsert>) => {
      const row = await db.transaction(async (tx) => {
        const existing = await tx
          .select()
          .from(issueWorkProducts)
          .where(eq(issueWorkProducts.id, id))
          .then((rows) => rows[0] ?? null);
        if (!existing) return null;

        if (patch.isPrimary === true) {
          await tx
            .update(issueWorkProducts)
            .set({ isPrimary: false, updatedAt: new Date() })
            .where(
              and(
                eq(issueWorkProducts.companyId, existing.companyId),
                eq(issueWorkProducts.issueId, existing.issueId),
                eq(issueWorkProducts.type, existing.type),
              ),
            );
        }

        return await tx
          .update(issueWorkProducts)
          .set({ ...patch, updatedAt: new Date() })
          .where(eq(issueWorkProducts.id, id))
          .returning()
          .then((rows) => rows[0] ?? null);
      });
      return row ? toIssueWorkProduct(row) : null;
    },

    remove: async (id: string) => {
      const row = await db
        .delete(issueWorkProducts)
        .where(eq(issueWorkProducts.id, id))
        .returning()
        .then((rows) => rows[0] ?? null);
      return row ? toIssueWorkProduct(row) : null;
    },
  };
}

export { toIssueWorkProduct };
