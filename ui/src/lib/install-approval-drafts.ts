import type {
  Approval,
  CompanySkillListItem,
  Issue,
  PluginRecord,
} from "@paperclipai/shared";

export interface InstallApprovalIssueOption {
  id: string;
  label: string;
  title: string;
  status: string;
}

interface SkillInstallMatchInput {
  skillId?: string | null;
  requestedRef?: string | null;
  source?: string | null;
  name?: string | null;
}

interface ConnectorInstallMatchInput {
  pluginKey?: string | null;
  packageName?: string | null;
  localPath?: string | null;
}

function asNormalizedToken(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : null;
}

function collectTokens(values: unknown[]) {
  return new Set(
    values
      .map((value) => asNormalizedToken(value))
      .filter((value): value is string => Boolean(value)),
  );
}

function hasTokenOverlap(left: Set<string>, right: Set<string>) {
  if (left.size === 0 || right.size === 0) return false;
  for (const token of left) {
    if (right.has(token)) return true;
  }
  return false;
}

function isOpenApproval(approval: Approval) {
  return approval.status === "pending" || approval.status === "revision_requested";
}

function skillInstallTokens(input: SkillInstallMatchInput) {
  return collectTokens([input.skillId, input.requestedRef, input.source, input.name]);
}

function connectorInstallTokens(input: ConnectorInstallMatchInput) {
  return collectTokens([input.pluginKey, input.packageName, input.localPath]);
}

function approvalSkillTokens(approval: Approval) {
  const payload = approval.payload as Record<string, unknown> | null;
  return collectTokens([
    payload?.skillId,
    payload?.requestedRef,
    payload?.slug,
    payload?.source,
    payload?.name,
  ]);
}

function approvalConnectorTokens(approval: Approval) {
  const payload = approval.payload as Record<string, unknown> | null;
  return collectTokens([
    payload?.pluginKey,
    payload?.pluginId,
    payload?.pluginSlug,
    payload?.packageName,
    payload?.pluginPackageName,
    payload?.pluginPackage,
    payload?.localPath,
  ]);
}

function installedSkillTokens(skill: CompanySkillListItem) {
  return collectTokens([
    skill.id,
    skill.key,
    skill.slug,
    skill.name,
    skill.sourceLocator,
    skill.sourceLabel,
  ]);
}

function installedPluginTokens(plugin: PluginRecord) {
  return collectTokens([
    plugin.pluginKey,
    plugin.packageName,
    plugin.packagePath,
  ]);
}

export function parseLinkedIssueIds(rawValue: string) {
  return Array.from(new Set(
    rawValue
      .split(/[\s,]+/)
      .map((value) => value.trim())
      .filter((value) => value.length > 0),
  ));
}

export function buildInstallApprovalIssueOptions(issues: Issue[], limit = 6): InstallApprovalIssueOption[] {
  return issues
    .filter((issue) => issue.hiddenAt === null && issue.status !== "done" && issue.status !== "cancelled")
    .sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime())
    .slice(0, limit)
    .map((issue) => ({
      id: issue.id,
      label: issue.identifier ?? (issue.issueNumber ? `#${issue.issueNumber}` : issue.id.slice(0, 8)),
      title: issue.title,
      status: issue.status,
    }));
}

export function findOpenSkillInstallApproval(
  approvals: Approval[],
  input: SkillInstallMatchInput,
) {
  const targetTokens = skillInstallTokens(input);
  if (targetTokens.size === 0) return null;

  return approvals.find((approval) =>
    approval.type === "install_company_skill"
    && isOpenApproval(approval)
    && hasTokenOverlap(targetTokens, approvalSkillTokens(approval))) ?? null;
}

export function findOpenConnectorInstallApproval(
  approvals: Approval[],
  input: ConnectorInstallMatchInput,
) {
  const targetTokens = connectorInstallTokens(input);
  if (targetTokens.size === 0) return null;

  return approvals.find((approval) =>
    approval.type === "install_connector_plugin"
    && isOpenApproval(approval)
    && hasTokenOverlap(targetTokens, approvalConnectorTokens(approval))) ?? null;
}

export function findInstalledSkill(
  companySkills: CompanySkillListItem[],
  input: SkillInstallMatchInput,
) {
  const targetTokens = skillInstallTokens(input);
  if (targetTokens.size === 0) return null;

  return companySkills.find((skill) => hasTokenOverlap(targetTokens, installedSkillTokens(skill))) ?? null;
}

export function findInstalledConnector(
  installedPlugins: PluginRecord[],
  input: ConnectorInstallMatchInput,
) {
  const targetTokens = connectorInstallTokens(input);
  if (targetTokens.size === 0) return null;

  return installedPlugins.find((plugin) => hasTokenOverlap(targetTokens, installedPluginTokens(plugin))) ?? null;
}
