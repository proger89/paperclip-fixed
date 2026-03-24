ALTER TABLE "companies" ADD COLUMN "company_archetype" text DEFAULT 'general_company' NOT NULL;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "tool_install_policy" text DEFAULT 'approval_gated' NOT NULL;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "auto_assign_approved_hires" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "required_review_by_role" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "issues" ADD COLUMN "reviewer_agent_id" uuid;--> statement-breakpoint
ALTER TABLE "issues" ADD COLUMN "reviewer_user_id" text;--> statement-breakpoint
ALTER TABLE "issues" ADD COLUMN "review_policy_key" text;--> statement-breakpoint
ALTER TABLE "issues" ADD COLUMN "acceptance_checklist_json" jsonb;--> statement-breakpoint
ALTER TABLE "issues" ADD CONSTRAINT "issues_reviewer_agent_id_agents_id_fk" FOREIGN KEY ("reviewer_agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "issues_company_review_status_idx" ON "issues" USING btree ("company_id","review_policy_key","status");
