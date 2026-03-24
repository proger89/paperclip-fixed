export interface AgentHireToastPlan {
  title: string;
  body?: string;
  tone: "success" | "warn";
  action?: {
    label: string;
    href: string;
  };
}

interface BuildAgentHireToastPlanInput {
  hasHireApproval: boolean;
  skillApprovalCount: number;
  connectorApprovalCount: number;
}

function formatApprovalCount(count: number, label: string) {
  return `${count} ${label}${count === 1 ? "" : "s"}`;
}

function joinApprovalParts(parts: string[]) {
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0]!;
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(", ")}, and ${parts.at(-1)}`;
}

export function buildAgentHireToastPlan(
  input: BuildAgentHireToastPlanInput,
): AgentHireToastPlan {
  const approvalParts = [
    input.hasHireApproval ? formatApprovalCount(1, "hire approval") : null,
    input.skillApprovalCount > 0
      ? formatApprovalCount(input.skillApprovalCount, "skill approval")
      : null,
    input.connectorApprovalCount > 0
      ? formatApprovalCount(input.connectorApprovalCount, "connector approval")
      : null,
  ].filter((value): value is string => Boolean(value));

  if (approvalParts.length === 0) {
    return {
      title: "Agent created",
      body: "The new hire is ready for work.",
      tone: "success",
    };
  }

  const includesHireApproval = input.hasHireApproval;
  const approvalSummary = joinApprovalParts(approvalParts);

  return {
    title: includesHireApproval
      ? "Agent created with pending approvals"
      : "Agent created with follow-up approvals",
    body: includesHireApproval
      ? `${approvalSummary} ${approvalParts.length === 1 ? "was" : "were"} queued. Review them before the hire can proceed.`
      : `${approvalSummary} ${approvalParts.length === 1 ? "was" : "were"} queued so the role bundle can install missing capabilities.`,
    tone: "warn",
    action: {
      label: "Open approvals",
      href: "/approvals",
    },
  };
}
