import type {
  AgentRole,
  RoleBundleCatalogEntry,
  ReviewPolicyKey,
  RoleBundleKey,
} from "@paperclipai/shared";

export interface RoleBundleConnectorRequirement {
  key: string;
  displayName: string;
  pluginKey?: string;
  packageName?: string;
  version?: string;
  source?: "npm" | "local_path";
  localPath?: string;
  reason?: string;
}

export interface RoleBundleDefinition {
  key: RoleBundleKey;
  label: string;
  agentRole: AgentRole;
  title: string;
  requestedSkillRefs: string[];
  requiredConnectorPlugins: RoleBundleConnectorRequirement[];
  managedInstructions: string[];
  managedInstructionOverlays: Partial<Record<string, string>>;
  defaultReviewPolicyKey: ReviewPolicyKey | null;
  defaultReviewerRole: AgentRole | string | null;
}

// Use flexible skill refs here: canonical keys, slugs, or common names all work.
// The hire flow resolves these against installed company skills by key/slug/name,
// so specialist bundles can snap to bundled Paperclip skills and skills.sh imports
// without hard-coding a single provenance scheme.
const CORE_MEMORY_SKILLS = [
  "paperclip",
  "para-memory-files",
];

const BROWSER_WORKFLOW_SKILLS = [
  "playwright",
  "playwright-interactive",
  "screenshot",
];

const DESIGN_SYSTEM_SKILLS = [
  "web-design-guidelines",
  "frontend-skill",
];

const MANAGERIAL_SKILLS = [
  "paperclip-create-agent",
  "doc-maintenance",
  "pr-report",
];

const QA_VALIDATION_SKILLS = [
  "playwright",
  "playwright-interactive",
  "screenshot",
  "security-best-practices",
  "web-design-guidelines",
];

function dedupe(values: string[]) {
  return Array.from(new Set(values));
}

function buildRoleFocusOverlay(title: string, bullets: string[]) {
  return [
    "## Role Focus",
    "",
    title,
    "",
    ...bullets.map((line) => `- ${line}`),
  ].join("\n");
}

function appendOverlay(baseContent: string | undefined, overlayContent: string) {
  const normalizedBase = (baseContent ?? "").replace(/\r\n/g, "\n").trimEnd();
  if (!normalizedBase) return `${overlayContent}\n`;
  return `${normalizedBase}\n\n${overlayContent}\n`;
}

export const ROLE_BUNDLES: Record<RoleBundleKey, RoleBundleDefinition> = {
  general_specialist: {
    key: "general_specialist",
    label: "General Specialist",
    agentRole: "general",
    title: "General Specialist",
    requestedSkillRefs: dedupe([
      ...CORE_MEMORY_SKILLS,
      ...BROWSER_WORKFLOW_SKILLS,
    ]),
    requiredConnectorPlugins: [],
    managedInstructions: ["AGENTS.md"],
    managedInstructionOverlays: {
      "AGENTS.md": buildRoleFocusOverlay(
        "You are the default cross-functional operator when the task does not clearly belong to a specialist yet.",
        [
          "Prefer existing company skills, connectors, and runtime services before inventing a new workflow.",
          "When the work becomes clearly specialist, reassign or request a specialist instead of pushing through with weak output.",
          "Always leave the next person with a runnable link, artifact, or concrete status comment.",
        ],
      ),
    },
    defaultReviewPolicyKey: null,
    defaultReviewerRole: null,
  },
  designer: {
    key: "designer",
    label: "Designer",
    agentRole: "designer",
    title: "Product Designer",
    requestedSkillRefs: dedupe([
      ...DESIGN_SYSTEM_SKILLS,
      ...BROWSER_WORKFLOW_SKILLS,
      ...CORE_MEMORY_SKILLS,
    ]),
    requiredConnectorPlugins: [],
    managedInstructions: ["AGENTS.md"],
    managedInstructionOverlays: {
      "AGENTS.md": buildRoleFocusOverlay(
        "You own product UX quality and visible polish.",
        [
          "Start from the user journey and information hierarchy, not isolated component tweaks.",
          "Use the design and browser skills that are already installed before improvising a layout.",
          "Attach primary previews, runtime links, artifacts, or docs so reviewers can inspect the actual output.",
          "Do not call design work done until the result is clear on desktop and mobile and design review can approve it.",
        ],
      ),
    },
    defaultReviewPolicyKey: "design_review",
    defaultReviewerRole: "pm",
  },
  qa: {
    key: "qa",
    label: "QA",
    agentRole: "qa",
    title: "QA Reviewer",
    requestedSkillRefs: dedupe([
      ...QA_VALIDATION_SKILLS,
      ...CORE_MEMORY_SKILLS,
    ]),
    requiredConnectorPlugins: [],
    managedInstructions: ["AGENTS.md"],
    managedInstructionOverlays: {
      "AGENTS.md": buildRoleFocusOverlay(
        "You are responsible for acceptance, regression detection, and explicit risk reporting.",
        [
          "Reproduce the flow in the running product when possible instead of reasoning from code alone.",
          "Attach proof of testing as work products, screenshots, or comments that point to the tested output.",
          "Record pass or fail checks and unresolved risk clearly before asking for review or completion.",
          "If review fails, request changes instead of quietly moving the issue forward.",
        ],
      ),
    },
    defaultReviewPolicyKey: "qa_review",
    defaultReviewerRole: "qa",
  },
  pm: {
    key: "pm",
    label: "PM",
    agentRole: "pm",
    title: "Project Manager",
    requestedSkillRefs: dedupe([
      ...MANAGERIAL_SKILLS,
      ...BROWSER_WORKFLOW_SKILLS,
      ...CORE_MEMORY_SKILLS,
    ]),
    requiredConnectorPlugins: [],
    managedInstructions: ["AGENTS.md"],
    managedInstructionOverlays: {
      "AGENTS.md": buildRoleFocusOverlay(
        "You keep staffing, scope, and review loops healthy.",
        [
          "Before hiring or escalating, check existing company skills, connectors, and runtime services.",
          "Break large asks into follow-up issues with acceptance criteria, work products, and named reviewers.",
          "Route design and UI work to designers, validation to QA, and avoid leaving specialist work on generic engineers by default.",
          "Keep project links, previews, and output artifacts obvious inside the issue.",
        ],
      ),
    },
    defaultReviewPolicyKey: null,
    defaultReviewerRole: null,
  },
  frontend_engineer: {
    key: "frontend_engineer",
    label: "Frontend Engineer",
    agentRole: "engineer",
    title: "Frontend Engineer",
    requestedSkillRefs: dedupe([
      ...DESIGN_SYSTEM_SKILLS,
      ...BROWSER_WORKFLOW_SKILLS,
      ...QA_VALIDATION_SKILLS,
      ...CORE_MEMORY_SKILLS,
    ]),
    requiredConnectorPlugins: [],
    managedInstructions: ["AGENTS.md"],
    managedInstructionOverlays: {
      "AGENTS.md": buildRoleFocusOverlay(
        "You deliver implementation quality for product surfaces, not just code completion.",
        [
          "Treat visual hierarchy, responsive behavior, and task clarity as part of the implementation.",
          "When the work affects UI, attach a preview or runtime link before handoff.",
          "If the design direction is weak or missing, pull in designer or PM review early instead of guessing.",
          "Do not close review-gated work until the reviewer can inspect the actual output.",
        ],
      ),
    },
    defaultReviewPolicyKey: "design_review",
    defaultReviewerRole: "designer",
  },
  content_operator: {
    key: "content_operator",
    label: "Content Operator",
    agentRole: "general",
    title: "Content Operator",
    requestedSkillRefs: dedupe([
      ...BROWSER_WORKFLOW_SKILLS,
      ...CORE_MEMORY_SKILLS,
      "doc-maintenance",
      "pr-report",
    ]),
    requiredConnectorPlugins: [],
    managedInstructions: ["AGENTS.md"],
    managedInstructionOverlays: {
      "AGENTS.md": buildRoleFocusOverlay(
        "You own draft quality, publication readiness, and channel-specific handoff.",
        [
          "Keep source material, drafts, and publication artifacts linked on the issue as first-class outputs.",
          "Make publication and review approvals explicit before shipping governed content.",
          "If a request depends on a new distribution channel or connector, ask for the install approval instead of faking the integration.",
        ],
      ),
    },
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

export function listRoleBundleCatalog(
  agentRole?: string | null,
): RoleBundleCatalogEntry[] {
  return Object.values(ROLE_BUNDLES)
    .filter((bundle) => !agentRole || bundle.agentRole === agentRole)
    .map((bundle) => ({
      key: bundle.key,
      label: bundle.label,
      agentRole: bundle.agentRole,
      title: bundle.title,
      requestedSkillRefs: [...bundle.requestedSkillRefs],
      requiredConnectorPlugins: bundle.requiredConnectorPlugins.map((requirement) => ({
        key: requirement.key,
        displayName: requirement.displayName,
        pluginKey: requirement.pluginKey ?? null,
        packageName: requirement.packageName ?? null,
        reason: requirement.reason ?? null,
      })),
      defaultReviewPolicyKey: bundle.defaultReviewPolicyKey,
      defaultReviewerRole: bundle.defaultReviewerRole,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

export function applyRoleBundleManagedInstructions(
  files: Record<string, string>,
  roleBundleKey: string | null | undefined,
  agentRole: string | null | undefined,
): Record<string, string> {
  if (agentRole === "ceo") return files;
  const roleBundle = resolveRoleBundle(roleBundleKey, agentRole);
  const nextFiles = { ...files };

  for (const relativePath of roleBundle.managedInstructions) {
    const overlay = roleBundle.managedInstructionOverlays[relativePath];
    if (!overlay) continue;
    nextFiles[relativePath] = appendOverlay(nextFiles[relativePath], overlay);
  }

  return nextFiles;
}
