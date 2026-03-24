import { useEffect, useMemo, useRef, useState } from "react";
import type {
  Agent,
  Approval,
  CompanySkillListItem,
  Issue,
  PluginRecord,
  RoleBundleCatalogEntry,
} from "@paperclipai/shared";
import { Link } from "@/lib/router";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "../lib/utils";
import type { AvailablePluginExample } from "../api/plugins";
import {
  buildInstallApprovalIssueOptions,
  findInstalledConnector,
  findInstalledSkill,
  findOpenConnectorInstallApproval,
  findOpenSkillInstallApproval,
  parseLinkedIssueIds,
} from "../lib/install-approval-drafts";
import type { InstallApprovalPrefill } from "../lib/install-approval-prefill";

type CreateInstallApprovalInput = {
  type: "install_company_skill" | "install_connector_plugin";
  payload: Record<string, unknown>;
  issueIds: string[];
};

interface InstallApprovalComposerProps {
  approvals: Approval[];
  agents: Agent[];
  roleBundles: RoleBundleCatalogEntry[];
  companySkills: CompanySkillListItem[];
  installedPlugins: PluginRecord[];
  pluginExamples: AvailablePluginExample[];
  issues: Issue[];
  prefill?: InstallApprovalPrefill | null;
  lookupsLoading?: boolean;
  isPending: boolean;
  onCreate: (input: CreateInstallApprovalInput) => void;
}

type SkillInstallMode = "import" | "update";
type ConnectorInstallMode = "example" | "npm" | "local_path";

const NONE_VALUE = "__none__";

type SkillDraft = {
  mode: SkillInstallMode;
  source: string;
  requestedRef: string;
  name: string;
  installedSkillId: string;
  roleBundleKey: string;
  requiredByAgentId: string;
  reason: string;
  selectedIssueIds: string[];
  manualIssueIds: string;
};

type ConnectorDraft = {
  mode: ConnectorInstallMode;
  exampleLocalPath: string;
  pluginKey: string;
  name: string;
  packageName: string;
  version: string;
  localPath: string;
  roleBundleKey: string;
  requiredByAgentId: string;
  reason: string;
  selectedIssueIds: string[];
  manualIssueIds: string;
};

function createEmptySkillDraft(): SkillDraft {
  return {
    mode: "import",
    source: "",
    requestedRef: "",
    name: "",
    installedSkillId: "",
    roleBundleKey: "",
    requiredByAgentId: "",
    reason: "",
    selectedIssueIds: [],
    manualIssueIds: "",
  };
}

function createEmptyConnectorDraft(): ConnectorDraft {
  return {
    mode: "example",
    exampleLocalPath: "",
    pluginKey: "",
    name: "",
    packageName: "",
    version: "",
    localPath: "",
    roleBundleKey: "",
    requiredByAgentId: "",
    reason: "",
    selectedIssueIds: [],
    manualIssueIds: "",
  };
}

function trimToNull(value: string) {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function dedupeIds(values: string[]) {
  return Array.from(new Set(values.filter((value) => value.length > 0)));
}

function issueIdsForDraft(selectedIds: string[], manualIds: string) {
  return dedupeIds([...selectedIds, ...parseLinkedIssueIds(manualIds)]);
}

function connectorNameFromPath(localPath: string | null) {
  if (!localPath) return null;
  const segments = localPath.split(/[\\/]/).filter(Boolean);
  return segments.at(-1) ?? null;
}

function roleBundleOptionLabel(bundle: RoleBundleCatalogEntry) {
  return `${bundle.label} (${bundle.title})`;
}

function issueChipClass(isSelected: boolean) {
  return cn(
    "flex items-start gap-2 rounded-md border px-3 py-2 text-left transition-colors",
    isSelected ? "border-foreground/20 bg-accent/50" : "border-border hover:bg-accent/30",
  );
}

export function InstallApprovalComposer({
  approvals,
  agents,
  roleBundles,
  companySkills,
  installedPlugins,
  pluginExamples,
  issues,
  prefill = null,
  lookupsLoading = false,
  isPending,
  onCreate,
}: InstallApprovalComposerProps) {
  const [kind, setKind] = useState<"skill" | "connector">("skill");
  const [skillDraft, setSkillDraft] = useState<SkillDraft>(() => createEmptySkillDraft());
  const [connectorDraft, setConnectorDraft] = useState<ConnectorDraft>(() => createEmptyConnectorDraft());
  const appliedPrefillSignatureRef = useRef<string | null>(null);

  const sortedAgents = useMemo(
    () => [...agents].sort((left, right) => left.name.localeCompare(right.name)),
    [agents],
  );
  const sortedBundles = useMemo(
    () => [...roleBundles].sort((left, right) => left.label.localeCompare(right.label)),
    [roleBundles],
  );
  const sortedSkills = useMemo(
    () => [...companySkills].sort((left, right) => left.name.localeCompare(right.name)),
    [companySkills],
  );
  const connectorExamples = useMemo(
    () =>
      pluginExamples
        .filter((example) => example.categories.includes("connector"))
        .sort((left, right) => left.displayName.localeCompare(right.displayName)),
    [pluginExamples],
  );
  const issueOptions = useMemo(
    () => buildInstallApprovalIssueOptions(issues),
    [issues],
  );

  useEffect(() => {
    if (connectorExamples.length === 0) return;
    setConnectorDraft((current) => {
      if (current.exampleLocalPath) return current;
      return { ...current, exampleLocalPath: connectorExamples[0]!.localPath };
    });
  }, [connectorExamples]);

  useEffect(() => {
    if (!prefill) return;
    const signature = JSON.stringify(prefill);
    if (appliedPrefillSignatureRef.current === signature) return;
    appliedPrefillSignatureRef.current = signature;

    if (prefill.kind === "skill") {
      setKind("skill");
      setSkillDraft({
        ...createEmptySkillDraft(),
        mode: prefill.mode,
        source: prefill.source ?? "",
        requestedRef: prefill.requestedRef ?? "",
        name: prefill.name ?? "",
        installedSkillId: prefill.skillId ?? "",
        roleBundleKey: prefill.roleBundleKey ?? "",
        requiredByAgentId: prefill.requiredByAgentId ?? "",
        reason: prefill.reason ?? "",
      });
      return;
    }

    setKind("connector");
    setConnectorDraft({
      ...createEmptyConnectorDraft(),
      mode: prefill.mode,
      exampleLocalPath: prefill.mode === "example" ? prefill.localPath ?? "" : "",
      pluginKey: prefill.pluginKey ?? "",
      name: prefill.name ?? "",
      packageName: prefill.packageName ?? "",
      version: prefill.version ?? "",
      localPath:
        prefill.mode === "local_path" || prefill.mode === "example"
          ? prefill.localPath ?? ""
          : "",
      roleBundleKey: prefill.roleBundleKey ?? "",
      requiredByAgentId: prefill.requiredByAgentId ?? "",
      reason: prefill.reason ?? "",
    });
  }, [prefill]);

  const selectedSkillBundle = useMemo(
    () => sortedBundles.find((bundle) => bundle.key === skillDraft.roleBundleKey) ?? null,
    [skillDraft.roleBundleKey, sortedBundles],
  );
  const selectedConnectorBundle = useMemo(
    () => sortedBundles.find((bundle) => bundle.key === connectorDraft.roleBundleKey) ?? null,
    [connectorDraft.roleBundleKey, sortedBundles],
  );
  const selectedSkillAgent = useMemo(
    () => sortedAgents.find((agent) => agent.id === skillDraft.requiredByAgentId) ?? null,
    [skillDraft.requiredByAgentId, sortedAgents],
  );
  const selectedConnectorAgent = useMemo(
    () => sortedAgents.find((agent) => agent.id === connectorDraft.requiredByAgentId) ?? null,
    [connectorDraft.requiredByAgentId, sortedAgents],
  );
  const selectedInstalledSkill = useMemo(
    () => sortedSkills.find((skill) => skill.id === skillDraft.installedSkillId) ?? null,
    [skillDraft.installedSkillId, sortedSkills],
  );
  const selectedConnectorExample = useMemo(
    () => connectorExamples.find((example) => example.localPath === connectorDraft.exampleLocalPath) ?? null,
    [connectorDraft.exampleLocalPath, connectorExamples],
  );

  const skillIssueIds = useMemo(
    () => issueIdsForDraft(skillDraft.selectedIssueIds, skillDraft.manualIssueIds),
    [skillDraft.manualIssueIds, skillDraft.selectedIssueIds],
  );
  const connectorIssueIds = useMemo(
    () => issueIdsForDraft(connectorDraft.selectedIssueIds, connectorDraft.manualIssueIds),
    [connectorDraft.manualIssueIds, connectorDraft.selectedIssueIds],
  );

  const skillInstallMatch = useMemo(
    () =>
      skillDraft.mode === "update"
        ? {
            skillId: selectedInstalledSkill?.id ?? null,
            requestedRef: selectedInstalledSkill?.key ?? selectedInstalledSkill?.slug ?? null,
            source: selectedInstalledSkill?.sourceLocator ?? null,
            name: selectedInstalledSkill?.name ?? null,
          }
        : {
            requestedRef: trimToNull(skillDraft.requestedRef),
            source: trimToNull(skillDraft.source),
            name: trimToNull(skillDraft.name),
          },
    [selectedInstalledSkill, skillDraft.mode, skillDraft.name, skillDraft.requestedRef, skillDraft.source],
  );
  const connectorInstallMatch = useMemo(
    () =>
      connectorDraft.mode === "example"
        ? {
            pluginKey: selectedConnectorExample?.pluginKey ?? null,
            localPath: selectedConnectorExample?.localPath ?? null,
          }
        : connectorDraft.mode === "local_path"
          ? {
              pluginKey: trimToNull(connectorDraft.pluginKey),
              localPath: trimToNull(connectorDraft.localPath),
            }
          : {
              pluginKey: trimToNull(connectorDraft.pluginKey),
              packageName: trimToNull(connectorDraft.packageName),
            },
    [
      connectorDraft.localPath,
      connectorDraft.mode,
      connectorDraft.packageName,
      connectorDraft.pluginKey,
      selectedConnectorExample,
    ],
  );

  const existingSkillApproval = useMemo(
    () => findOpenSkillInstallApproval(approvals, skillInstallMatch),
    [approvals, skillInstallMatch],
  );
  const existingConnectorApproval = useMemo(
    () => findOpenConnectorInstallApproval(approvals, connectorInstallMatch),
    [approvals, connectorInstallMatch],
  );
  const installedSkillMatch = useMemo(
    () =>
      skillDraft.mode === "import"
        ? findInstalledSkill(companySkills, skillInstallMatch)
        : null,
    [companySkills, skillDraft.mode, skillInstallMatch],
  );
  const installedConnectorMatch = useMemo(
    () => findInstalledConnector(installedPlugins, connectorInstallMatch),
    [connectorInstallMatch, installedPlugins],
  );

  const skillDefaultReason = useMemo(() => {
    if (selectedSkillBundle) return `Required for ${selectedSkillBundle.label} role bundle`;
    if (selectedInstalledSkill) return `Update ${selectedInstalledSkill.name} for current company workflow`;
    const requestedLabel = trimToNull(skillDraft.name) ?? trimToNull(skillDraft.requestedRef);
    if (requestedLabel) return `Install ${requestedLabel} for current company workflow`;
    return "Install missing company skill";
  }, [selectedInstalledSkill, selectedSkillBundle, skillDraft.name, skillDraft.requestedRef]);

  const connectorDefaultReason = useMemo(() => {
    if (selectedConnectorBundle) return `Required for ${selectedConnectorBundle.label} role bundle`;
    if (selectedConnectorExample) return `Install ${selectedConnectorExample.displayName} for current company workflow`;
    const requestedLabel =
      trimToNull(connectorDraft.name)
      ?? trimToNull(connectorDraft.pluginKey)
      ?? trimToNull(connectorDraft.packageName)
      ?? connectorNameFromPath(trimToNull(connectorDraft.localPath));
    if (requestedLabel) return `Install ${requestedLabel} connector for current company workflow`;
    return "Install missing connector plugin";
  }, [
    connectorDraft.localPath,
    connectorDraft.name,
    connectorDraft.packageName,
    connectorDraft.pluginKey,
    selectedConnectorBundle,
    selectedConnectorExample,
  ]);

  const skillSubmitDisabled =
    isPending
    || (skillDraft.mode === "import" && !trimToNull(skillDraft.source))
    || (skillDraft.mode === "update" && !selectedInstalledSkill)
    || Boolean(existingSkillApproval)
    || Boolean(installedSkillMatch);

  const connectorSubmitDisabled =
    isPending
    || (connectorDraft.mode === "example" && !selectedConnectorExample)
    || (connectorDraft.mode === "npm" && !trimToNull(connectorDraft.packageName))
    || (connectorDraft.mode === "local_path" && !trimToNull(connectorDraft.localPath))
    || Boolean(existingConnectorApproval)
    || Boolean(installedConnectorMatch);

  function toggleIssueId(
    selectedIds: string[],
    issueId: string,
    setter: (value: string[]) => void,
  ) {
    if (selectedIds.includes(issueId)) {
      setter(selectedIds.filter((value) => value !== issueId));
      return;
    }
    setter([...selectedIds, issueId]);
  }

  function submitSkillApproval() {
    if (skillSubmitDisabled) return;

    const reason = trimToNull(skillDraft.reason) ?? skillDefaultReason;
    const requestedRef =
      trimToNull(skillDraft.requestedRef)
      ?? selectedInstalledSkill?.key
      ?? selectedInstalledSkill?.slug
      ?? null;
    const payload: Record<string, unknown> = {
      skillId: selectedInstalledSkill?.id ?? null,
      name:
        trimToNull(skillDraft.name)
        ?? selectedInstalledSkill?.name
        ?? requestedRef
        ?? trimToNull(skillDraft.source),
      slug: requestedRef,
      requestedRef,
      source:
        skillDraft.mode === "update"
          ? selectedInstalledSkill?.sourceLocator ?? null
          : trimToNull(skillDraft.source),
      sourceType:
        skillDraft.mode === "update"
          ? selectedInstalledSkill?.sourceType ?? null
          : null,
      reason,
      roleBundleKey: selectedSkillBundle?.key ?? null,
      roleBundleLabel: selectedSkillBundle?.label ?? null,
      role: selectedSkillBundle?.agentRole ?? null,
      requiredByAgentId: selectedSkillAgent?.id ?? null,
      requiredByAgentName: selectedSkillAgent?.name ?? null,
      sourceIssueIds: skillIssueIds,
    };

    onCreate({
      type: "install_company_skill",
      payload,
      issueIds: skillIssueIds,
    });
    setSkillDraft(createEmptySkillDraft());
  }

  function submitConnectorApproval() {
    if (connectorSubmitDisabled) return;

    const isLocalPath = connectorDraft.mode !== "npm";
    const localPath =
      connectorDraft.mode === "example"
        ? selectedConnectorExample?.localPath ?? null
        : trimToNull(connectorDraft.localPath);
    const pluginKey =
      connectorDraft.mode === "example"
        ? selectedConnectorExample?.pluginKey ?? null
        : trimToNull(connectorDraft.pluginKey);
    const name =
      connectorDraft.mode === "example"
        ? selectedConnectorExample?.displayName ?? null
        : trimToNull(connectorDraft.name)
          ?? pluginKey
          ?? trimToNull(connectorDraft.packageName)
          ?? connectorNameFromPath(localPath);
    const payload: Record<string, unknown> = {
      pluginId: pluginKey,
      pluginKey,
      pluginSlug: pluginKey,
      name,
      packageName:
        connectorDraft.mode === "npm"
          ? trimToNull(connectorDraft.packageName)
          : null,
      version:
        connectorDraft.mode === "npm"
          ? trimToNull(connectorDraft.version)
          : null,
      isLocalPath,
      localPath,
      source: isLocalPath ? "local_path" : "npm",
      reason: trimToNull(connectorDraft.reason) ?? connectorDefaultReason,
      roleBundleKey: selectedConnectorBundle?.key ?? null,
      roleBundleLabel: selectedConnectorBundle?.label ?? null,
      role: selectedConnectorBundle?.agentRole ?? null,
      requiredByAgentId: selectedConnectorAgent?.id ?? null,
      requiredByAgentName: selectedConnectorAgent?.name ?? null,
      sourceIssueIds: connectorIssueIds,
    };

    onCreate({
      type: "install_connector_plugin",
      payload,
      issueIds: connectorIssueIds,
    });
    setConnectorDraft(createEmptyConnectorDraft());
  }

  function renderIssueSection(
    selectedIssueIds: string[],
    manualIssueIds: string,
    totalIssueIds: string[],
    onSelectedIssueIdsChange: (value: string[]) => void,
    onManualIssueIdsChange: (value: string) => void,
  ) {
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs font-medium text-muted-foreground">Link issue context</p>
          <span className="text-xs text-muted-foreground">{totalIssueIds.length} linked</span>
        </div>
        {issueOptions.length > 0 ? (
          <div className="grid gap-2 lg:grid-cols-2">
            {issueOptions.map((issue) => {
              const isSelected = selectedIssueIds.includes(issue.id);
              return (
                <label key={issue.id} className={issueChipClass(isSelected)}>
                  <Checkbox
                    checked={isSelected}
                    onCheckedChange={() =>
                      toggleIssueId(selectedIssueIds, issue.id, onSelectedIssueIdsChange)
                    }
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2 text-xs font-medium">
                      <span>{issue.label}</span>
                      <span className="text-muted-foreground">{issue.status}</span>
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                      {issue.title}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No active issues available for quick linking.</p>
        )}
        <Input
          value={manualIssueIds}
          onChange={(event) => onManualIssueIdsChange(event.target.value)}
          placeholder="Optional extra issue IDs, separated by commas or spaces"
        />
      </div>
    );
  }

  return (
    <Card>
      <CardHeader className="gap-3 border-b border-border">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>Request Install Approval</CardTitle>
            <CardDescription>
              Queue a governed install request when a task or hire uncovers a missing skill or connector.
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <Link className="underline-offset-4 hover:underline" to="/skills">
              Skills library
            </Link>
            <span>|</span>
            <Link className="underline-offset-4 hover:underline" to="/plugins">
              Plugin manager
            </Link>
          </div>
        </div>
        {lookupsLoading ? (
          <p className="text-xs text-muted-foreground">Loading skills, plugins, and company context...</p>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-4 pt-6">
        <Tabs value={kind} onValueChange={(value) => setKind(value as "skill" | "connector")}>
          <TabsList variant="line" className="w-full justify-start">
            <TabsTrigger value="skill">Skill Install</TabsTrigger>
            <TabsTrigger value="connector">Connector Install</TabsTrigger>
          </TabsList>

          <TabsContent value="skill" className="space-y-4">
            <div className="grid gap-4 lg:grid-cols-[12rem_minmax(0,1fr)]">
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground" htmlFor="skill-mode">
                  Request type
                </label>
                <Select
                  value={skillDraft.mode}
                  onValueChange={(value) =>
                    setSkillDraft((current) => ({ ...current, mode: value as SkillInstallMode }))
                  }
                >
                  <SelectTrigger id="skill-mode" className="w-full">
                    <SelectValue placeholder="Choose request type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="import">Import new skill</SelectItem>
                    <SelectItem value="update">Update installed skill</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                {skillDraft.mode === "import" ? (
                  <>
                    <div className="space-y-1 md:col-span-2">
                      <label className="text-xs font-medium text-muted-foreground" htmlFor="skill-source">
                        Source
                      </label>
                      <Input
                        id="skill-source"
                        value={skillDraft.source}
                        onChange={(event) =>
                          setSkillDraft((current) => ({ ...current, source: event.target.value }))
                        }
                        placeholder="skills.sh command, GitHub URL, or local path"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-muted-foreground" htmlFor="skill-ref">
                        Requested ref
                      </label>
                      <Input
                        id="skill-ref"
                        value={skillDraft.requestedRef}
                        onChange={(event) =>
                          setSkillDraft((current) => ({ ...current, requestedRef: event.target.value }))
                        }
                        placeholder="Optional ref or slug"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-muted-foreground" htmlFor="skill-name">
                        Display name
                      </label>
                      <Input
                        id="skill-name"
                        value={skillDraft.name}
                        onChange={(event) =>
                          setSkillDraft((current) => ({ ...current, name: event.target.value }))
                        }
                        placeholder="Optional label for the approval"
                      />
                    </div>
                  </>
                ) : (
                  <div className="space-y-1 md:col-span-2">
                    <label className="text-xs font-medium text-muted-foreground" htmlFor="installed-skill">
                      Installed skill
                    </label>
                    <Select
                      value={skillDraft.installedSkillId || NONE_VALUE}
                      onValueChange={(value) =>
                        setSkillDraft((current) => ({
                          ...current,
                          installedSkillId: value === NONE_VALUE ? "" : value,
                        }))
                      }
                    >
                      <SelectTrigger id="installed-skill" className="w-full">
                        <SelectValue placeholder="Select installed skill" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NONE_VALUE}>Select installed skill</SelectItem>
                        {sortedSkills.map((skill) => (
                          <SelectItem key={skill.id} value={skill.id}>
                            {skill.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground" htmlFor="skill-bundle">
                    Bundle context
                  </label>
                  <Select
                    value={skillDraft.roleBundleKey || NONE_VALUE}
                    onValueChange={(value) =>
                      setSkillDraft((current) => ({
                        ...current,
                        roleBundleKey: value === NONE_VALUE ? "" : value,
                      }))
                    }
                  >
                    <SelectTrigger id="skill-bundle" className="w-full">
                      <SelectValue placeholder="Optional role bundle" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE_VALUE}>No specific bundle</SelectItem>
                      {sortedBundles.map((bundle) => (
                        <SelectItem key={bundle.key} value={bundle.key}>
                          {roleBundleOptionLabel(bundle)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground" htmlFor="skill-agent">
                    Needed by agent
                  </label>
                  <Select
                    value={skillDraft.requiredByAgentId || NONE_VALUE}
                    onValueChange={(value) =>
                      setSkillDraft((current) => ({
                        ...current,
                        requiredByAgentId: value === NONE_VALUE ? "" : value,
                      }))
                    }
                  >
                    <SelectTrigger id="skill-agent" className="w-full">
                      <SelectValue placeholder="Optional agent" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE_VALUE}>No specific agent</SelectItem>
                      {sortedAgents.map((agent) => (
                        <SelectItem key={agent.id} value={agent.id}>
                          {agent.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1 md:col-span-2">
                  <label className="text-xs font-medium text-muted-foreground" htmlFor="skill-reason">
                    Reason
                  </label>
                  <Textarea
                    id="skill-reason"
                    value={skillDraft.reason}
                    onChange={(event) =>
                      setSkillDraft((current) => ({ ...current, reason: event.target.value }))
                    }
                    placeholder={skillDefaultReason}
                    className="min-h-24"
                  />
                </div>
              </div>
            </div>

            {existingSkillApproval ? (
              <div className="rounded-md border border-yellow-500/30 bg-yellow-500/10 px-3 py-2 text-sm text-yellow-900 dark:text-yellow-100">
                An open install approval already exists for this skill request.
                <Link className="ml-1 underline underline-offset-4" to={`/approvals/${existingSkillApproval.id}`}>
                  Open approval
                </Link>
              </div>
            ) : null}

            {installedSkillMatch ? (
              <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
                This skill already exists in the company catalog as <span className="font-medium text-foreground">{installedSkillMatch.name}</span>.
                Switch to <span className="font-medium text-foreground">Update installed skill</span> if you want to refresh it.
              </div>
            ) : null}

            {renderIssueSection(
              skillDraft.selectedIssueIds,
              skillDraft.manualIssueIds,
              skillIssueIds,
              (value) => setSkillDraft((current) => ({ ...current, selectedIssueIds: value })),
              (value) => setSkillDraft((current) => ({ ...current, manualIssueIds: value })),
            )}

            <div className="flex items-center justify-end gap-2 border-t border-border pt-4">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setSkillDraft(createEmptySkillDraft())}
                disabled={isPending}
              >
                Clear
              </Button>
              <Button size="sm" onClick={submitSkillApproval} disabled={skillSubmitDisabled}>
                {isPending ? "Requesting..." : "Request skill install"}
              </Button>
            </div>
          </TabsContent>

          <TabsContent value="connector" className="space-y-4">
            <div className="grid gap-4 lg:grid-cols-[12rem_minmax(0,1fr)]">
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground" htmlFor="connector-mode">
                  Connector source
                </label>
                <Select
                  value={connectorDraft.mode}
                  onValueChange={(value) =>
                    setConnectorDraft((current) => ({ ...current, mode: value as ConnectorInstallMode }))
                  }
                >
                  <SelectTrigger id="connector-mode" className="w-full">
                    <SelectValue placeholder="Choose source" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="example">Bundled example</SelectItem>
                    <SelectItem value="npm">npm package</SelectItem>
                    <SelectItem value="local_path">Local path</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                {connectorDraft.mode === "example" ? (
                  <div className="space-y-1 md:col-span-2">
                    <label className="text-xs font-medium text-muted-foreground" htmlFor="connector-example">
                      Bundled connector example
                    </label>
                    <Select
                      value={connectorDraft.exampleLocalPath || NONE_VALUE}
                      onValueChange={(value) =>
                        setConnectorDraft((current) => ({
                          ...current,
                          exampleLocalPath: value === NONE_VALUE ? "" : value,
                        }))
                      }
                    >
                      <SelectTrigger id="connector-example" className="w-full">
                        <SelectValue placeholder="Select bundled example" />
                      </SelectTrigger>
                      <SelectContent>
                        {connectorExamples.length === 0 ? (
                          <SelectItem value={NONE_VALUE}>No bundled connector examples</SelectItem>
                        ) : (
                          connectorExamples.map((example) => (
                            <SelectItem key={example.localPath} value={example.localPath}>
                              {example.displayName}
                            </SelectItem>
                          ))
                        )}
                      </SelectContent>
                    </Select>
                    {selectedConnectorExample ? (
                      <p className="text-xs text-muted-foreground">{selectedConnectorExample.description}</p>
                    ) : null}
                  </div>
                ) : null}

                {connectorDraft.mode === "npm" ? (
                  <>
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-muted-foreground" htmlFor="connector-package">
                        Package name
                      </label>
                      <Input
                        id="connector-package"
                        value={connectorDraft.packageName}
                        onChange={(event) =>
                          setConnectorDraft((current) => ({ ...current, packageName: event.target.value }))
                        }
                        placeholder="@paperclip/plugin-example"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-muted-foreground" htmlFor="connector-version">
                        Version
                      </label>
                      <Input
                        id="connector-version"
                        value={connectorDraft.version}
                        onChange={(event) =>
                          setConnectorDraft((current) => ({ ...current, version: event.target.value }))
                        }
                        placeholder="Optional version or tag"
                      />
                    </div>
                  </>
                ) : null}

                {connectorDraft.mode === "local_path" ? (
                  <>
                    <div className="space-y-1 md:col-span-2">
                      <label className="text-xs font-medium text-muted-foreground" htmlFor="connector-path">
                        Local path
                      </label>
                      <Input
                        id="connector-path"
                        value={connectorDraft.localPath}
                        onChange={(event) =>
                          setConnectorDraft((current) => ({ ...current, localPath: event.target.value }))
                        }
                        placeholder="D:/path/to/plugin"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-muted-foreground" htmlFor="connector-key">
                        Plugin key
                      </label>
                      <Input
                        id="connector-key"
                        value={connectorDraft.pluginKey}
                        onChange={(event) =>
                          setConnectorDraft((current) => ({ ...current, pluginKey: event.target.value }))
                        }
                        placeholder="Optional manifest key"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-muted-foreground" htmlFor="connector-name">
                        Display name
                      </label>
                      <Input
                        id="connector-name"
                        value={connectorDraft.name}
                        onChange={(event) =>
                          setConnectorDraft((current) => ({ ...current, name: event.target.value }))
                        }
                        placeholder="Optional label for the approval"
                      />
                    </div>
                  </>
                ) : null}

                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground" htmlFor="connector-bundle">
                    Bundle context
                  </label>
                  <Select
                    value={connectorDraft.roleBundleKey || NONE_VALUE}
                    onValueChange={(value) =>
                      setConnectorDraft((current) => ({
                        ...current,
                        roleBundleKey: value === NONE_VALUE ? "" : value,
                      }))
                    }
                  >
                    <SelectTrigger id="connector-bundle" className="w-full">
                      <SelectValue placeholder="Optional role bundle" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE_VALUE}>No specific bundle</SelectItem>
                      {sortedBundles.map((bundle) => (
                        <SelectItem key={bundle.key} value={bundle.key}>
                          {roleBundleOptionLabel(bundle)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground" htmlFor="connector-agent">
                    Needed by agent
                  </label>
                  <Select
                    value={connectorDraft.requiredByAgentId || NONE_VALUE}
                    onValueChange={(value) =>
                      setConnectorDraft((current) => ({
                        ...current,
                        requiredByAgentId: value === NONE_VALUE ? "" : value,
                      }))
                    }
                  >
                    <SelectTrigger id="connector-agent" className="w-full">
                      <SelectValue placeholder="Optional agent" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE_VALUE}>No specific agent</SelectItem>
                      {sortedAgents.map((agent) => (
                        <SelectItem key={agent.id} value={agent.id}>
                          {agent.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1 md:col-span-2">
                  <label className="text-xs font-medium text-muted-foreground" htmlFor="connector-reason">
                    Reason
                  </label>
                  <Textarea
                    id="connector-reason"
                    value={connectorDraft.reason}
                    onChange={(event) =>
                      setConnectorDraft((current) => ({ ...current, reason: event.target.value }))
                    }
                    placeholder={connectorDefaultReason}
                    className="min-h-24"
                  />
                </div>
              </div>
            </div>

            {existingConnectorApproval ? (
              <div className="rounded-md border border-yellow-500/30 bg-yellow-500/10 px-3 py-2 text-sm text-yellow-900 dark:text-yellow-100">
                An open install approval already exists for this connector request.
                <Link className="ml-1 underline underline-offset-4" to={`/approvals/${existingConnectorApproval.id}`}>
                  Open approval
                </Link>
              </div>
            ) : null}

            {installedConnectorMatch ? (
              <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
                This connector is already installed as <span className="font-medium text-foreground">{installedConnectorMatch.pluginKey}</span>.
                Review it in the <Link className="underline underline-offset-4" to="/plugins">Plugin manager</Link> instead of creating another install approval.
              </div>
            ) : null}

            {renderIssueSection(
              connectorDraft.selectedIssueIds,
              connectorDraft.manualIssueIds,
              connectorIssueIds,
              (value) => setConnectorDraft((current) => ({ ...current, selectedIssueIds: value })),
              (value) => setConnectorDraft((current) => ({ ...current, manualIssueIds: value })),
            )}

            <div className="flex items-center justify-end gap-2 border-t border-border pt-4">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setConnectorDraft(createEmptyConnectorDraft())}
                disabled={isPending}
              >
                Clear
              </Button>
              <Button size="sm" onClick={submitConnectorApproval} disabled={connectorSubmitDisabled}>
                {isPending ? "Requesting..." : "Request connector install"}
              </Button>
            </div>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
