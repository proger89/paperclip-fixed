export const INSTALL_APPROVAL_PREFILL_SEARCH_PARAM = "installRequest";

export interface SkillInstallApprovalPrefill {
  kind: "skill";
  mode: "import" | "update";
  source?: string | null;
  skillId?: string | null;
  requestedRef?: string | null;
  name?: string | null;
  roleBundleKey?: string | null;
  requiredByAgentId?: string | null;
  reason?: string | null;
}

export interface ConnectorInstallApprovalPrefill {
  kind: "connector";
  mode: "example" | "npm" | "local_path";
  packageName?: string | null;
  localPath?: string | null;
  pluginKey?: string | null;
  name?: string | null;
  version?: string | null;
  roleBundleKey?: string | null;
  requiredByAgentId?: string | null;
  reason?: string | null;
}

export type InstallApprovalPrefill =
  | SkillInstallApprovalPrefill
  | ConnectorInstallApprovalPrefill;

function asStringOrNull(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function encodeInstallApprovalPrefill(prefill: InstallApprovalPrefill) {
  return JSON.stringify(prefill);
}

export function decodeInstallApprovalPrefill(rawValue: string | null | undefined): InstallApprovalPrefill | null {
  if (!rawValue) return null;

  try {
    const parsed = JSON.parse(rawValue) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object") return null;

    const kind = asStringOrNull(parsed.kind);
    const mode = asStringOrNull(parsed.mode);
    if (kind === "skill" && (mode === "import" || mode === "update")) {
      return {
        kind,
        mode,
        source: asStringOrNull(parsed.source),
        skillId: asStringOrNull(parsed.skillId),
        requestedRef: asStringOrNull(parsed.requestedRef),
        name: asStringOrNull(parsed.name),
        roleBundleKey: asStringOrNull(parsed.roleBundleKey),
        requiredByAgentId: asStringOrNull(parsed.requiredByAgentId),
        reason: asStringOrNull(parsed.reason),
      };
    }

    if (kind === "connector" && (mode === "example" || mode === "npm" || mode === "local_path")) {
      return {
        kind,
        mode,
        packageName: asStringOrNull(parsed.packageName),
        localPath: asStringOrNull(parsed.localPath),
        pluginKey: asStringOrNull(parsed.pluginKey),
        name: asStringOrNull(parsed.name),
        version: asStringOrNull(parsed.version),
        roleBundleKey: asStringOrNull(parsed.roleBundleKey),
        requiredByAgentId: asStringOrNull(parsed.requiredByAgentId),
        reason: asStringOrNull(parsed.reason),
      };
    }
  } catch {
    return null;
  }

  return null;
}

export function buildInstallApprovalPrefillPath(
  prefill: InstallApprovalPrefill,
  status: "pending" | "all" = "pending",
) {
  const params = new URLSearchParams({
    [INSTALL_APPROVAL_PREFILL_SEARCH_PARAM]: encodeInstallApprovalPrefill(prefill),
  });
  return `/approvals/${status}?${params.toString()}`;
}
