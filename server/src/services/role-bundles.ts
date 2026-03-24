import type { AgentRole, RoleBundleKey } from "@paperclipai/shared";

export interface RoleBundleDefinition {
  key: RoleBundleKey;
  label: string;
  agentRole: AgentRole;
  title: string;
  requestedSkillRefs: string[];
  requiredConnectorPlugins: string[];
  managedInstructions: string[];
  defaultReviewPolicyKey: string | null;
  defaultReviewerRole: AgentRole | string | null;
}

export const ROLE_BUNDLES: Record<RoleBundleKey, RoleBundleDefinition> = {
  general_specialist: {
    key: "general_specialist",
    label: "General Specialist",
    agentRole: "general",
    title: "General Specialist",
    requestedSkillRefs: [],
    requiredConnectorPlugins: [],
    managedInstructions: ["AGENTS.md"],
    defaultReviewPolicyKey: null,
    defaultReviewerRole: null,
  },
  designer: {
    key: "designer",
    label: "Designer",
    agentRole: "designer",
    title: "Product Designer",
    requestedSkillRefs: [],
    requiredConnectorPlugins: [],
    managedInstructions: ["AGENTS.md"],
    defaultReviewPolicyKey: "design_review",
    defaultReviewerRole: "pm",
  },
  qa: {
    key: "qa",
    label: "QA",
    agentRole: "qa",
    title: "QA Reviewer",
    requestedSkillRefs: [],
    requiredConnectorPlugins: [],
    managedInstructions: ["AGENTS.md"],
    defaultReviewPolicyKey: "qa_review",
    defaultReviewerRole: "qa",
  },
  pm: {
    key: "pm",
    label: "PM",
    agentRole: "pm",
    title: "Project Manager",
    requestedSkillRefs: [],
    requiredConnectorPlugins: [],
    managedInstructions: ["AGENTS.md"],
    defaultReviewPolicyKey: null,
    defaultReviewerRole: null,
  },
  frontend_engineer: {
    key: "frontend_engineer",
    label: "Frontend Engineer",
    agentRole: "engineer",
    title: "Frontend Engineer",
    requestedSkillRefs: [],
    requiredConnectorPlugins: [],
    managedInstructions: ["AGENTS.md"],
    defaultReviewPolicyKey: "design_review",
    defaultReviewerRole: "designer",
  },
  content_operator: {
    key: "content_operator",
    label: "Content Operator",
    agentRole: "general",
    title: "Content Operator",
    requestedSkillRefs: [],
    requiredConnectorPlugins: [],
    managedInstructions: ["AGENTS.md"],
    defaultReviewPolicyKey: "content_review",
    defaultReviewerRole: "pm",
  },
};

const FALLBACK_ROLE_BUNDLE_BY_AGENT_ROLE: Partial<Record<AgentRole, RoleBundleKey>> = {
  designer: "designer",
  qa: "qa",
  pm: "pm",
  engineer: "frontend_engineer",
  general: "general_specialist",
};

export function resolveRoleBundleKey(
  roleBundleKey: string | null | undefined,
  agentRole: string | null | undefined,
): RoleBundleKey {
  if (roleBundleKey && roleBundleKey in ROLE_BUNDLES) {
    return roleBundleKey as RoleBundleKey;
  }
  if (agentRole && agentRole in FALLBACK_ROLE_BUNDLE_BY_AGENT_ROLE) {
    return FALLBACK_ROLE_BUNDLE_BY_AGENT_ROLE[agentRole as AgentRole] ?? "general_specialist";
  }
  return "general_specialist";
}

export function resolveRoleBundle(
  roleBundleKey: string | null | undefined,
  agentRole: string | null | undefined,
): RoleBundleDefinition {
  return ROLE_BUNDLES[resolveRoleBundleKey(roleBundleKey, agentRole)];
}
