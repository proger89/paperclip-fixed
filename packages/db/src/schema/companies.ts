import { sql } from "drizzle-orm";
import { pgTable, uuid, text, integer, timestamp, boolean, uniqueIndex, jsonb } from "drizzle-orm/pg-core";

export const companies = pgTable(
  "companies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    description: text("description"),
    status: text("status").notNull().default("active"),
    pauseReason: text("pause_reason"),
    pausedAt: timestamp("paused_at", { withTimezone: true }),
    companyArchetype: text("company_archetype").notNull().default("general_company"),
    toolInstallPolicy: text("tool_install_policy").notNull().default("approval_gated"),
    autoAssignApprovedHires: boolean("auto_assign_approved_hires").notNull().default(true),
    requiredReviewByRole: jsonb("required_review_by_role")
      .$type<Record<string, { reviewPolicyKey: string; reviewerRole?: string | null }>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    issuePrefix: text("issue_prefix").notNull().default("PAP"),
    issueCounter: integer("issue_counter").notNull().default(0),
    budgetMonthlyCents: integer("budget_monthly_cents").notNull().default(0),
    spentMonthlyCents: integer("spent_monthly_cents").notNull().default(0),
    requireBoardApprovalForNewAgents: boolean("require_board_approval_for_new_agents")
      .notNull()
      .default(true),
    brandColor: text("brand_color"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    issuePrefixUniqueIdx: uniqueIndex("companies_issue_prefix_idx").on(table.issuePrefix),
  }),
);
