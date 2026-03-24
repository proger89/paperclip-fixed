import type {
  AgentRole,
  CompanyRequiredReviewByRole,
  CompanyRequiredReviewRule,
} from "@paperclipai/shared";

export const DEFAULT_COMPANY_ARCHETYPE = "general_company";
export const DEFAULT_TOOL_INSTALL_POLICY = "approval_gated";

export const DEFAULT_REQUIRED_REVIEW_BY_ROLE: CompanyRequiredReviewByRole = {
  designer: {
    reviewPolicyKey: "design_review",
    reviewerRole: "pm",
  },
  frontend_engineer: {
    reviewPolicyKey: "design_review",
    reviewerRole: "designer",
  },
  qa: {
    reviewPolicyKey: "qa_review",
    reviewerRole: "qa",
  },
  content_operator: {
    reviewPolicyKey: "content_review",
    reviewerRole: "pm",
  },
};

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeRule(value: unknown): CompanyRequiredReviewRule | null {
  if (!isPlainRecord(value)) return null;
  const reviewPolicyKey =
    typeof value.reviewPolicyKey === "string" && value.reviewPolicyKey.trim().length > 0
      ? value.reviewPolicyKey.trim()
      : null;
  if (!reviewPolicyKey) return null;
  const reviewerRole =
    typeof value.reviewerRole === "string" && value.reviewerRole.trim().length > 0
      ? value.reviewerRole.trim()
      : null;
  return {
    reviewPolicyKey,
    reviewerRole,
  };
}

export function normalizeRequiredReviewByRole(
  value: unknown,
  fallback: CompanyRequiredReviewByRole = DEFAULT_REQUIRED_REVIEW_BY_ROLE,
): CompanyRequiredReviewByRole {
  const normalized: CompanyRequiredReviewByRole = { ...fallback };
  if (!isPlainRecord(value)) return normalized;

  for (const [key, rawRule] of Object.entries(value)) {
    const rule = normalizeRule(rawRule);
    if (!rule) continue;
    normalized[key] = rule;
  }

  return normalized;
}

export function resolveReviewRuleForRole(
  reviewByRole: unknown,
  roleKey: string | null | undefined,
): CompanyRequiredReviewRule | null {
  if (!roleKey) return null;
  const normalized = normalizeRequiredReviewByRole(reviewByRole);
  return normalized[roleKey] ?? null;
}

export function normalizeCompanyAutonomySettings<
  T extends object,
>(company: T & {
  companyArchetype?: string | null;
  toolInstallPolicy?: string | null;
  autoAssignApprovedHires?: boolean | null;
  requiredReviewByRole?: unknown;
}): T & {
  companyArchetype: string;
  toolInstallPolicy: string;
  autoAssignApprovedHires: boolean;
  requiredReviewByRole: CompanyRequiredReviewByRole;
} {
  return {
    ...company,
    companyArchetype:
      typeof company.companyArchetype === "string" && company.companyArchetype.trim().length > 0
        ? company.companyArchetype
        : DEFAULT_COMPANY_ARCHETYPE,
    toolInstallPolicy:
      typeof company.toolInstallPolicy === "string" && company.toolInstallPolicy.trim().length > 0
        ? company.toolInstallPolicy
        : DEFAULT_TOOL_INSTALL_POLICY,
    autoAssignApprovedHires: company.autoAssignApprovedHires !== false,
    requiredReviewByRole: normalizeRequiredReviewByRole(company.requiredReviewByRole),
  };
}

export function normalizeReviewerRole(value: unknown): AgentRole | string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
