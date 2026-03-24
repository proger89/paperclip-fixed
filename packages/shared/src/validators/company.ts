import { z } from "zod";
import { COMPANY_ARCHETYPES, COMPANY_STATUSES, TOOL_INSTALL_POLICIES } from "../constants.js";

const logoAssetIdSchema = z.string().uuid().nullable().optional();
const brandColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional();
export const companyRequiredReviewRuleSchema = z.object({
  reviewPolicyKey: z.string().trim().min(1),
  reviewerRole: z.string().trim().min(1).nullable().optional(),
});
export const companyRequiredReviewByRoleSchema = z.record(companyRequiredReviewRuleSchema);

export const createCompanySchema = z.object({
  name: z.string().min(1),
  description: z.string().optional().nullable(),
  budgetMonthlyCents: z.number().int().nonnegative().optional().default(0),
  companyArchetype: z.enum(COMPANY_ARCHETYPES).optional().default("general_company"),
  toolInstallPolicy: z.enum(TOOL_INSTALL_POLICIES).optional().default("approval_gated"),
  autoAssignApprovedHires: z.boolean().optional().default(true),
  requiredReviewByRole: companyRequiredReviewByRoleSchema.optional().nullable(),
});

export type CreateCompany = z.infer<typeof createCompanySchema>;

export const updateCompanySchema = createCompanySchema
  .partial()
  .extend({
    status: z.enum(COMPANY_STATUSES).optional(),
    spentMonthlyCents: z.number().int().nonnegative().optional(),
    requireBoardApprovalForNewAgents: z.boolean().optional(),
    companyArchetype: z.enum(COMPANY_ARCHETYPES).optional(),
    toolInstallPolicy: z.enum(TOOL_INSTALL_POLICIES).optional(),
    autoAssignApprovedHires: z.boolean().optional(),
    requiredReviewByRole: companyRequiredReviewByRoleSchema.optional().nullable(),
    brandColor: brandColorSchema,
    logoAssetId: logoAssetIdSchema,
  });

export type UpdateCompany = z.infer<typeof updateCompanySchema>;

export const updateCompanyBrandingSchema = z
  .object({
    name: z.string().min(1).optional(),
    description: z.string().nullable().optional(),
    brandColor: brandColorSchema,
    logoAssetId: logoAssetIdSchema,
  })
  .strict()
  .refine(
    (value) =>
      value.name !== undefined
      || value.description !== undefined
      || value.brandColor !== undefined
      || value.logoAssetId !== undefined,
    "At least one branding field must be provided",
  );

export type UpdateCompanyBranding = z.infer<typeof updateCompanyBrandingSchema>;
