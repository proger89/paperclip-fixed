import { useState, useEffect, useMemo, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "@/lib/router";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { useToast } from "../context/ToastContext";
import { agentsApi } from "../api/agents";
import { approvalsApi } from "../api/approvals";
import { companySkillsApi } from "../api/companySkills";
import { instanceSettingsApi } from "../api/instanceSettings";
import { pluginsApi } from "../api/plugins";
import { queryKeys } from "../lib/queryKeys";
import { buildAgentHireToastPlan } from "../lib/agent-hire-feedback";
import { buildInstallApprovalPrefillPath } from "../lib/install-approval-prefill";
import {
  findInstalledConnector,
  findOpenConnectorInstallApproval,
  findOpenSkillInstallApproval,
} from "../lib/install-approval-drafts";
import { AGENT_ROLES, REVIEW_POLICY_LABELS } from "@paperclipai/shared";
import { getRoleBundleReadiness } from "../lib/role-bundle-readiness";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Layers3, Shield, User } from "lucide-react";
import { cn, agentUrl } from "../lib/utils";
import { roleLabels } from "../components/agent-config-primitives";
import { AgentConfigForm, type CreateConfigValues } from "../components/AgentConfigForm";
import { defaultCreateValues } from "../components/agent-config-defaults";
import { getUIAdapter } from "../adapters";
import { AgentIcon } from "../components/AgentIconPicker";
import {
  DEFAULT_CODEX_LOCAL_BYPASS_APPROVALS_AND_SANDBOX,
  DEFAULT_CODEX_LOCAL_MODEL,
} from "@paperclipai/adapter-codex-local";
import { DEFAULT_CURSOR_LOCAL_MODEL } from "@paperclipai/adapter-cursor-local";
import { DEFAULT_GEMINI_LOCAL_MODEL } from "@paperclipai/adapter-gemini-local";

const SUPPORTED_ADVANCED_ADAPTER_TYPES = new Set<CreateConfigValues["adapterType"]>([
  "claude_local",
  "codex_local",
  "gemini_local",
  "opencode_local",
  "pi_local",
  "cursor",
  "openclaw_gateway",
]);

function createValuesForAdapterType(
  adapterType: CreateConfigValues["adapterType"],
  executionLocation = defaultCreateValues.executionLocation,
): CreateConfigValues {
  const { adapterType: _discard, ...defaults } = defaultCreateValues;
  const nextValues: CreateConfigValues = { ...defaults, adapterType, executionLocation };
  if (adapterType === "codex_local") {
    nextValues.model = DEFAULT_CODEX_LOCAL_MODEL;
    nextValues.dangerouslyBypassSandbox =
      DEFAULT_CODEX_LOCAL_BYPASS_APPROVALS_AND_SANDBOX;
  } else if (adapterType === "gemini_local") {
    nextValues.model = DEFAULT_GEMINI_LOCAL_MODEL;
  } else if (adapterType === "cursor") {
    nextValues.model = DEFAULT_CURSOR_LOCAL_MODEL;
  } else if (adapterType === "opencode_local") {
    nextValues.model = "";
  }
  return nextValues;
}

export function NewAgent() {
  const { selectedCompanyId, selectedCompany } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { pushToast } = useToast();
  const [searchParams] = useSearchParams();
  const presetAdapterType = searchParams.get("adapterType");

  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const [role, setRole] = useState("general");
  const [reportsTo, setReportsTo] = useState("");
  const [configValues, setConfigValues] = useState<CreateConfigValues>(defaultCreateValues);
  const [selectedSkillKeys, setSelectedSkillKeys] = useState<string[]>([]);
  const [roleBundleKey, setRoleBundleKey] = useState("");
  const [roleOpen, setRoleOpen] = useState(false);
  const [roleBundleOpen, setRoleBundleOpen] = useState(false);
  const [reportsToOpen, setReportsToOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const executionLocationTouchedRef = useRef(false);

  const { data: agents } = useQuery({
    queryKey: queryKeys.agents.list(selectedCompanyId!),
    queryFn: () => agentsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const {
    data: adapterModels,
    error: adapterModelsError,
    isLoading: adapterModelsLoading,
    isFetching: adapterModelsFetching,
  } = useQuery({
    queryKey: selectedCompanyId
      ? queryKeys.agents.adapterModels(selectedCompanyId, configValues.adapterType)
      : ["agents", "none", "adapter-models", configValues.adapterType],
    queryFn: () => agentsApi.adapterModels(selectedCompanyId!, configValues.adapterType),
    enabled: Boolean(selectedCompanyId),
  });

  const { data: companySkills } = useQuery({
    queryKey: queryKeys.companySkills.list(selectedCompanyId ?? ""),
    queryFn: () => companySkillsApi.list(selectedCompanyId!),
    enabled: Boolean(selectedCompanyId),
  });

  const generalSettingsQuery = useQuery({
    queryKey: queryKeys.instance.generalSettings,
    queryFn: () => instanceSettingsApi.getGeneral(),
    retry: false,
  });
  const defaultExecutionLocation =
    generalSettingsQuery.data?.defaultLocalExecutionLocation ?? defaultCreateValues.executionLocation;

  const isFirstAgent = !agents || agents.length === 0;
  const effectiveRole = isFirstAgent ? "ceo" : role;

  const {
    data: roleBundles,
    error: roleBundlesError,
  } = useQuery({
    queryKey: selectedCompanyId
      ? queryKeys.agents.roleBundles(selectedCompanyId, effectiveRole)
      : ["agents", "none", "role-bundles", effectiveRole],
    queryFn: () => agentsApi.roleBundles(selectedCompanyId!, effectiveRole),
    enabled: Boolean(selectedCompanyId) && effectiveRole !== "ceo",
  });

  useEffect(() => {
    setBreadcrumbs([
      { label: "Agents", href: "/agents" },
      { label: "New Agent" },
    ]);
  }, [setBreadcrumbs]);

  useEffect(() => {
    if (isFirstAgent) {
      if (!name) setName("CEO");
      if (!title) setTitle("CEO");
    }
  }, [isFirstAgent]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const requested = presetAdapterType;
    if (!requested) return;
    if (!SUPPORTED_ADVANCED_ADAPTER_TYPES.has(requested as CreateConfigValues["adapterType"])) {
      return;
    }
    setConfigValues((prev) => {
      if (prev.adapterType === requested) return prev;
      return createValuesForAdapterType(
        requested as CreateConfigValues["adapterType"],
        prev.executionLocation || defaultExecutionLocation,
      );
    });
  }, [defaultExecutionLocation, presetAdapterType]);

  useEffect(() => {
    if (executionLocationTouchedRef.current) return;
    setConfigValues((prev) =>
      prev.executionLocation === defaultExecutionLocation
        ? prev
        : { ...prev, executionLocation: defaultExecutionLocation },
    );
  }, [defaultExecutionLocation]);

  const availableRoleBundles = useMemo(
    () => roleBundles ?? [],
    [roleBundles],
  );
  const selectedRoleBundle = useMemo(
    () => availableRoleBundles.find((bundle) => bundle.key === roleBundleKey) ?? availableRoleBundles[0] ?? null,
    [availableRoleBundles, roleBundleKey],
  );
  const toolInstallPolicy = selectedCompany?.toolInstallPolicy ?? "approval_gated";

  const {
    data: installedPlugins,
    error: installedPluginsError,
  } = useQuery({
    queryKey: queryKeys.plugins.all,
    queryFn: () => pluginsApi.list(),
    enabled: Boolean(
      (selectedRoleBundle?.requiredConnectorPlugins.length ?? 0)
      || (selectedRoleBundle?.suggestedConnectorPlugins.length ?? 0),
    ),
  });
  const { data: approvals } = useQuery({
    queryKey: queryKeys.approvals.list(selectedCompanyId!),
    queryFn: () => approvalsApi.list(selectedCompanyId!),
    enabled: Boolean(selectedCompanyId && selectedRoleBundle),
  });

  const roleBundleReadiness = useMemo(
    () =>
      selectedRoleBundle
        ? getRoleBundleReadiness({
            bundle: selectedRoleBundle,
            companySkills: companySkills ?? [],
            installedPlugins: installedPlugins ?? [],
            toolInstallPolicy,
          })
        : null,
    [companySkills, installedPlugins, selectedRoleBundle, toolInstallPolicy],
  );
  const bundleIncludedSkillKeys = useMemo(
    () =>
      Array.from(
        new Set(
          roleBundleReadiness?.installedSkills.map((entry) => entry.skill.key) ?? [],
        ),
      ).sort(),
    [roleBundleReadiness],
  );

  useEffect(() => {
    if (effectiveRole === "ceo" || availableRoleBundles.length === 0) {
      setRoleBundleKey("");
      setRoleBundleOpen(false);
      return;
    }
    setRoleBundleKey((current) =>
      availableRoleBundles.some((bundle) => bundle.key === current)
        ? current
        : availableRoleBundles[0]!.key,
    );
  }, [availableRoleBundles, effectiveRole]);

  useEffect(() => {
    if (bundleIncludedSkillKeys.length === 0) return;
    const includedKeys = new Set(bundleIncludedSkillKeys);
    setSelectedSkillKeys((prev) => {
      const next = prev.filter((key) => !includedKeys.has(key));
      return next.length === prev.length ? prev : next;
    });
  }, [bundleIncludedSkillKeys]);

  const createAgent = useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      agentsApi.hire(selectedCompanyId!, data),
    onSuccess: async (result) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.agents.list(selectedCompanyId!) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.approvals.list(selectedCompanyId!) }),
      ]);
      pushToast(
        buildAgentHireToastPlan({
          hasHireApproval: Boolean(result.approval),
          skillApprovalCount: result.skillApprovals?.length ?? 0,
          connectorApprovalCount: result.connectorApprovals?.length ?? 0,
        }),
      );
      navigate(agentUrl(result.agent));
    },
    onError: (error) => {
      setFormError(error instanceof Error ? error.message : "Failed to create agent");
    },
  });

  function buildAdapterConfig() {
    const adapter = getUIAdapter(configValues.adapterType);
    return adapter.buildAdapterConfig(configValues);
  }

  function handleSubmit() {
    if (!selectedCompanyId || !name.trim()) return;
    setFormError(null);
    if (configValues.adapterType === "opencode_local") {
      const selectedModel = configValues.model.trim();
      if (!selectedModel) {
        setFormError("OpenCode requires an explicit model in provider/model format.");
        return;
      }
      if (adapterModelsError) {
        setFormError(
          adapterModelsError instanceof Error
            ? adapterModelsError.message
            : "Failed to load OpenCode models.",
        );
        return;
      }
      if (adapterModelsLoading || adapterModelsFetching) {
        setFormError("OpenCode models are still loading. Please wait and try again.");
        return;
      }
      const discovered = adapterModels ?? [];
      if (!discovered.some((entry) => entry.id === selectedModel)) {
        setFormError(
          discovered.length === 0
            ? "No OpenCode models discovered. Run `opencode models` and authenticate providers."
            : `Configured OpenCode model is unavailable: ${selectedModel}`,
        );
        return;
      }
    }
    createAgent.mutate({
      name: name.trim(),
      role: effectiveRole,
      ...(selectedRoleBundle ? { roleBundleKey: selectedRoleBundle.key } : {}),
      ...(title.trim() ? { title: title.trim() } : {}),
      ...(reportsTo ? { reportsTo } : {}),
      ...(selectedSkillKeys.length > 0 ? { desiredSkills: selectedSkillKeys } : {}),
      adapterType: configValues.adapterType,
      adapterConfig: buildAdapterConfig(),
      runtimeConfig: {
        heartbeat: {
          enabled: configValues.heartbeatEnabled,
          intervalSec: configValues.intervalSec,
          wakeOnDemand: true,
          cooldownSec: 10,
          maxConcurrentRuns: 1,
        },
      },
      budgetMonthlyCents: 0,
    });
  }

  const currentReportsTo = (agents ?? []).find((a) => a.id === reportsTo);
  const availableSkills = (companySkills ?? []).filter((skill) => !skill.key.startsWith("paperclipai/paperclip/"));
  const bundleCoverageCount =
    (roleBundleReadiness?.installedSkills.length ?? 0) +
    (roleBundleReadiness?.installedConnectors.length ?? 0);
  const bundleApprovalCount =
    (roleBundleReadiness?.pendingApprovalSkillRefs.length ?? 0) +
    (roleBundleReadiness?.pendingApprovalConnectors.length ?? 0);
  const bundleManualGapCount =
    (roleBundleReadiness?.manualSkillRefs.length ?? 0) +
    (roleBundleReadiness?.manualConnectorRequirements.length ?? 0);
  const readinessHeadline = roleBundleReadiness
    ? bundleApprovalCount > 0
      ? `${bundleApprovalCount} ${bundleApprovalCount === 1 ? "bundle capability needs" : "bundle capabilities need"} install approval${bundleApprovalCount === 1 ? "" : "s"} on hire.`
      : bundleManualGapCount > 0
        ? `${bundleManualGapCount} ${bundleManualGapCount === 1 ? "bundle capability still needs" : "bundle capabilities still need"} manual setup before this role is fully ready.`
        : "This role bundle is fully covered by the current company setup."
    : null;
  const readinessDetail = roleBundleReadiness
    ? bundleApprovalCount > 0
      ? "Paperclip will queue follow-up approvals for the missing role-bundle installs."
      : bundleManualGapCount > 0
        ? "This company is configured for manual installs, or the missing connector lacks an install package."
        : `Covered now: ${bundleCoverageCount} ${bundleCoverageCount === 1 ? "capability" : "capabilities"}.`
    : null;
  const missingApprovalSkillRequirements = useMemo(
    () =>
      (selectedRoleBundle?.requestedSkillRequirements ?? []).filter((requirement) =>
        roleBundleReadiness?.pendingApprovalSkillRefs.includes(requirement.reference),
      ),
    [roleBundleReadiness, selectedRoleBundle],
  );
  const missingManualSkillRequirements = useMemo(
    () =>
      (selectedRoleBundle?.requestedSkillRequirements ?? []).filter((requirement) =>
        roleBundleReadiness?.manualSkillRefs.includes(requirement.reference),
      ),
    [roleBundleReadiness, selectedRoleBundle],
  );
  const missingApprovalConnectorRequirements = useMemo(
    () =>
      (selectedRoleBundle?.requiredConnectorPlugins ?? []).filter((requirement) =>
        roleBundleReadiness?.pendingApprovalConnectors.some((entry) => entry.key === requirement.key),
      ),
    [roleBundleReadiness, selectedRoleBundle],
  );
  const roleBundleSkillRequirements = useMemo(
    () =>
      selectedRoleBundle
        ? selectedRoleBundle.requestedSkillRequirements.length > 0
          ? selectedRoleBundle.requestedSkillRequirements
          : selectedRoleBundle.requestedSkillRefs.map((reference) => ({
              reference,
              displayName: reference,
              source: null,
              sourceType: null,
            }))
        : [],
    [selectedRoleBundle],
  );
  const suggestedConnectorRecommendations = useMemo(() => {
    if (!selectedRoleBundle) return [];
    const requiredKeys = new Set(selectedRoleBundle.requiredConnectorPlugins.map((entry) => entry.key));
    return selectedRoleBundle.suggestedConnectorPlugins
      .filter((requirement) => !requiredKeys.has(requirement.key))
      .map((requirement) => ({
        requirement,
        installedConnector:
          findInstalledConnector(installedPlugins ?? [], {
            pluginKey: requirement.pluginKey ?? requirement.key,
            packageName: requirement.packageName ?? null,
            localPath: requirement.localPath ?? null,
          }) ?? null,
        openApproval:
          findOpenConnectorInstallApproval(approvals ?? [], {
            pluginKey: requirement.pluginKey ?? requirement.key,
            packageName: requirement.packageName ?? null,
            localPath: requirement.localPath ?? null,
          }) ?? null,
      }));
  }, [approvals, installedPlugins, selectedRoleBundle]);
  const pendingSkillInstallApprovals = useMemo(
    () =>
      missingApprovalSkillRequirements
        .map((requirement) => ({
          requirement,
          approval:
            findOpenSkillInstallApproval(approvals ?? [], {
              requestedRef: requirement.reference,
              source: requirement.source,
              name: requirement.displayName,
            }) ?? null,
        }))
        .filter(
          (entry): entry is { requirement: typeof entry.requirement; approval: NonNullable<typeof entry.approval> } =>
            entry.approval !== null,
        ),
    [approvals, missingApprovalSkillRequirements],
  );
  const requestableSkillRequirements = useMemo(() => {
    const blocked = new Set(
      pendingSkillInstallApprovals.map((entry) => entry.requirement.reference),
    );
    return missingApprovalSkillRequirements.filter((requirement) => !blocked.has(requirement.reference));
  }, [missingApprovalSkillRequirements, pendingSkillInstallApprovals]);
  const pendingConnectorInstallApprovals = useMemo(
    () =>
      missingApprovalConnectorRequirements
        .map((requirement) => ({
          requirement,
          approval:
            findOpenConnectorInstallApproval(approvals ?? [], {
              pluginKey: requirement.pluginKey ?? requirement.key,
              packageName: requirement.packageName ?? null,
              localPath: requirement.localPath ?? null,
            }) ?? null,
        }))
        .filter(
          (entry): entry is { requirement: typeof entry.requirement; approval: NonNullable<typeof entry.approval> } =>
            entry.approval !== null,
        ),
    [approvals, missingApprovalConnectorRequirements],
  );
  const requestableConnectorRequirements = useMemo(() => {
    const blocked = new Set(
      pendingConnectorInstallApprovals.map((entry) => entry.requirement.key),
    );
    return missingApprovalConnectorRequirements.filter((requirement) => !blocked.has(requirement.key));
  }, [missingApprovalConnectorRequirements, pendingConnectorInstallApprovals]);
  const existingBundleApprovalCount =
    pendingSkillInstallApprovals.length + pendingConnectorInstallApprovals.length;
  const requestableBundleApprovalCount =
    requestableSkillRequirements.length + requestableConnectorRequirements.length;
  const readinessSupplement =
    existingBundleApprovalCount > 0
      ? `${existingBundleApprovalCount} ${existingBundleApprovalCount === 1 ? "install approval is already open" : "install approvals are already open"} for this bundle and will not be duplicated on hire.`
      : null;
  const resolvedReadinessHeadline = roleBundleReadiness
    ? requestableBundleApprovalCount > 0
      ? `${requestableBundleApprovalCount} ${requestableBundleApprovalCount === 1 ? "bundle capability needs" : "bundle capabilities need"} install approval${requestableBundleApprovalCount === 1 ? "" : "s"} before this role is fully ready.`
      : existingBundleApprovalCount > 0
        ? `${existingBundleApprovalCount} ${existingBundleApprovalCount === 1 ? "bundle capability is already waiting on" : "bundle capabilities are already waiting on"} open install approval${existingBundleApprovalCount === 1 ? "" : "s"}.`
        : readinessHeadline
    : readinessHeadline;
  const resolvedReadinessDetail = roleBundleReadiness
    ? requestableBundleApprovalCount > 0
      ? existingBundleApprovalCount > 0
        ? "Some bundle installs already have approvals in queue; the remaining gaps can be requested now or will be queued on hire."
        : readinessDetail
      : existingBundleApprovalCount > 0
        ? "Open approvals already cover the installable bundle gaps."
        : readinessDetail
    : readinessDetail;

  function toggleSkill(key: string, checked: boolean) {
    setSelectedSkillKeys((prev) => {
      if (checked) {
        return prev.includes(key) ? prev : [...prev, key];
      }
      return prev.filter((value) => value !== key);
    });
  }

  function openSkillInstallDraft(reference: {
    displayName: string;
    reference: string;
    source?: string | null;
  }) {
    if (!reference.source || !selectedRoleBundle) return;
    navigate(
      buildInstallApprovalPrefillPath({
        kind: "skill",
        mode: "import",
        source: reference.source,
        requestedRef: reference.reference,
        name: reference.displayName,
        roleBundleKey: selectedRoleBundle.key,
        reason: `Required for ${selectedRoleBundle.label} role bundle`,
      }),
    );
  }

  function openConnectorInstallDraft(requirement: {
    key: string;
    displayName: string;
    pluginKey?: string | null;
    packageName?: string | null;
    localPath?: string | null;
    source?: "npm" | "local_path" | null;
    version?: string | null;
    reason?: string | null;
  }) {
    if (!selectedRoleBundle) return;
    navigate(
      buildInstallApprovalPrefillPath({
        kind: "connector",
        mode: requirement.source === "npm" ? "npm" : "local_path",
        packageName: requirement.packageName ?? null,
        localPath: requirement.localPath ?? null,
        pluginKey: requirement.pluginKey ?? requirement.key,
        name: requirement.displayName,
        version: requirement.version ?? null,
        roleBundleKey: selectedRoleBundle.key,
        reason: requirement.reason ?? `Required for ${selectedRoleBundle.label} role bundle`,
      }),
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-lg font-semibold">New Agent</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Advanced agent configuration
        </p>
      </div>

      <div className="border border-border">
        {/* Name */}
        <div className="px-4 pt-4 pb-2">
          <input
            className="w-full text-lg font-semibold bg-transparent outline-none placeholder:text-muted-foreground/50"
            placeholder="Agent name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        {/* Title */}
        <div className="px-4 pb-2">
          <input
            className="w-full bg-transparent outline-none text-sm text-muted-foreground placeholder:text-muted-foreground/40"
            placeholder="Title (e.g. VP of Engineering)"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>

        {/* Property chips: Role + Reports To */}
        <div className="flex items-center gap-1.5 px-4 py-2 border-t border-border flex-wrap">
          <Popover open={roleOpen} onOpenChange={setRoleOpen}>
            <PopoverTrigger asChild>
              <button
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs hover:bg-accent/50 transition-colors",
                  isFirstAgent && "opacity-60 cursor-not-allowed"
                )}
                disabled={isFirstAgent}
              >
                <Shield className="h-3 w-3 text-muted-foreground" />
                {roleLabels[effectiveRole] ?? effectiveRole}
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-36 p-1" align="start">
              {AGENT_ROLES.map((r) => (
                <button
                  key={r}
                  className={cn(
                    "flex items-center gap-2 w-full px-2 py-1.5 text-xs rounded hover:bg-accent/50",
                    r === role && "bg-accent"
                  )}
                  onClick={() => { setRole(r); setRoleOpen(false); }}
                >
                  {roleLabels[r] ?? r}
                </button>
              ))}
            </PopoverContent>
          </Popover>

          <Popover open={reportsToOpen} onOpenChange={setReportsToOpen}>
            <PopoverTrigger asChild>
              <button
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs hover:bg-accent/50 transition-colors",
                  isFirstAgent && "opacity-60 cursor-not-allowed"
                )}
                disabled={isFirstAgent}
              >
                {currentReportsTo ? (
                  <>
                    <AgentIcon icon={currentReportsTo.icon} className="h-3 w-3 text-muted-foreground" />
                    {`Reports to ${currentReportsTo.name}`}
                  </>
                ) : (
                  <>
                    <User className="h-3 w-3 text-muted-foreground" />
                    {isFirstAgent ? "Reports to: N/A (CEO)" : "Reports to..."}
                  </>
                )}
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-48 p-1" align="start">
              <button
                className={cn(
                  "flex items-center gap-2 w-full px-2 py-1.5 text-xs rounded hover:bg-accent/50",
                  !reportsTo && "bg-accent"
                )}
                onClick={() => { setReportsTo(""); setReportsToOpen(false); }}
              >
                No manager
              </button>
              {(agents ?? []).map((a) => (
                <button
                  key={a.id}
                  className={cn(
                    "flex items-center gap-2 w-full px-2 py-1.5 text-xs rounded hover:bg-accent/50 truncate",
                    a.id === reportsTo && "bg-accent"
                  )}
                  onClick={() => { setReportsTo(a.id); setReportsToOpen(false); }}
                >
                  <AgentIcon icon={a.icon} className="shrink-0 h-3 w-3 text-muted-foreground" />
                  {a.name}
                  <span className="text-muted-foreground ml-auto">{roleLabels[a.role] ?? a.role}</span>
                </button>
              ))}
            </PopoverContent>
          </Popover>

          {!isFirstAgent && availableRoleBundles.length > 0 && (
            <Popover open={roleBundleOpen} onOpenChange={setRoleBundleOpen}>
              <PopoverTrigger asChild>
                <button
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs hover:bg-accent/50 transition-colors",
                    availableRoleBundles.length === 1 && "cursor-default"
                  )}
                  disabled={availableRoleBundles.length === 1}
                >
                  <Layers3 className="h-3 w-3 text-muted-foreground" />
                  {selectedRoleBundle?.label ?? "Role bundle"}
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-56 p-1" align="start">
                {availableRoleBundles.map((bundle) => (
                  <button
                    key={bundle.key}
                    className={cn(
                      "flex w-full flex-col items-start gap-1 rounded px-2 py-2 text-left hover:bg-accent/50",
                      bundle.key === selectedRoleBundle?.key && "bg-accent",
                    )}
                    onClick={() => {
                      setRoleBundleKey(bundle.key);
                      setRoleBundleOpen(false);
                    }}
                  >
                    <span className="text-xs font-medium">{bundle.label}</span>
                    <span className="text-[11px] text-muted-foreground">{bundle.title}</span>
                  </button>
                ))}
              </PopoverContent>
            </Popover>
          )}
        </div>

        {!isFirstAgent && selectedRoleBundle && (
          <div className="border-t border-border px-4 py-4">
            <div className="space-y-3 rounded-lg border border-border/70 bg-muted/20 p-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                    Role bundle
                  </p>
                  <p className="mt-1 text-sm font-medium">{selectedRoleBundle.label}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{selectedRoleBundle.title}</p>
                </div>
                <div className="text-right text-xs text-muted-foreground">
                  {selectedRoleBundle.defaultReviewPolicyKey ? (
                    <>
                      <div>{REVIEW_POLICY_LABELS[selectedRoleBundle.defaultReviewPolicyKey]}</div>
                      <div>
                        Reviewer:{" "}
                        {selectedRoleBundle.defaultReviewerRole
                          ? (roleLabels[selectedRoleBundle.defaultReviewerRole] ?? selectedRoleBundle.defaultReviewerRole)
                          : "Unassigned"}
                      </div>
                    </>
                  ) : (
                    <div>No default review gate</div>
                  )}
                </div>
              </div>

              {roleBundleReadiness ? (
                <div className="rounded-md border border-border/70 bg-background/80 p-3">
                  <p className="text-sm font-medium">{resolvedReadinessHeadline}</p>
                  {resolvedReadinessDetail ? (
                    <p className="mt-1 text-xs text-muted-foreground">{resolvedReadinessDetail}</p>
                  ) : null}
                  {readinessSupplement ? (
                    <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">
                      {readinessSupplement}
                    </p>
                  ) : null}
                </div>
              ) : null}

              <div className="space-y-2">
                <div>
                  <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                    Auto skills
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {roleBundleSkillRequirements.map((requirement) => {
                      const installedByCompany = roleBundleReadiness?.installedSkills.some(
                        (entry) => entry.reference === requirement.reference,
                      );
                      const queuedForApproval = roleBundleReadiness?.pendingApprovalSkillRefs.includes(
                        requirement.reference,
                      );
                      return (
                        <span
                          key={requirement.reference}
                          title={requirement.reference}
                          className={cn(
                            "rounded-full border px-2 py-0.5 font-mono text-[10px]",
                            installedByCompany
                              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                              : queuedForApproval
                                ? "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300"
                                : "border-border bg-background text-muted-foreground",
                          )}
                        >
                          {requirement.displayName}
                        </span>
                      );
                    })}
                  </div>
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    Green means the skill is already installed in the company library. Amber means the hire will queue an install approval.
                    {toolInstallPolicy === "manual_only"
                      ? " Neutral chips still need manual setup."
                      : " Neutral chips still need manual setup or a cataloged install source."}
                  </p>
                  {requestableSkillRequirements.length > 0 ? (
                    <div className="mt-3 space-y-1.5">
                      {requestableSkillRequirements.map((requirement) => (
                        <div
                          key={requirement.reference}
                          className="flex items-center justify-between gap-3 rounded-md border border-amber-500/20 bg-amber-500/5 px-3 py-2"
                        >
                          <div className="min-w-0">
                            <div className="text-xs font-medium text-foreground">
                              {requirement.displayName}
                            </div>
                            <div className="text-[11px] text-amber-700 dark:text-amber-300">
                              Install approval required
                            </div>
                            <div className="truncate text-[11px] text-muted-foreground">
                              {requirement.sourceType === "skills_sh" ? "skills.sh" : "Cataloged import"}:{" "}
                              {requirement.source ?? requirement.reference}
                            </div>
                          </div>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => openSkillInstallDraft(requirement)}
                          >
                            Request now
                          </Button>
                        </div>
                      ))}
                    </div>
                  ) : null}
                  {pendingSkillInstallApprovals.length > 0 ? (
                    <div className="mt-3 space-y-1.5">
                      {pendingSkillInstallApprovals.map(({ requirement, approval }) => (
                        <div
                          key={`${requirement.reference}-${approval.id}`}
                          className="flex items-center justify-between gap-3 rounded-md border border-amber-500/20 bg-amber-500/5 px-3 py-2"
                        >
                          <div className="min-w-0">
                            <div className="text-xs font-medium text-foreground">
                              {requirement.displayName}
                            </div>
                            <div className="text-[11px] text-amber-700 dark:text-amber-300">
                              Approval already open
                            </div>
                            <div className="truncate text-[11px] text-muted-foreground">
                              {approval.status === "revision_requested"
                                ? "Needs revision before install can continue."
                                : "Install request is already waiting in the approvals queue."}
                            </div>
                          </div>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => navigate(`/approvals/${approval.id}`)}
                          >
                            Open approval
                          </Button>
                        </div>
                      ))}
                    </div>
                  ) : null}
                  {missingManualSkillRequirements.length > 0 ? (
                    <div className="mt-3 space-y-1.5">
                      {missingManualSkillRequirements.map((requirement) => (
                        <div
                          key={requirement.reference}
                          className="rounded-md border border-border/70 bg-background/70 px-3 py-2"
                        >
                          <div className="text-xs font-medium text-foreground">
                            {requirement.displayName}
                          </div>
                          <div className="text-[11px] text-muted-foreground">
                            Install source not cataloged. Manual setup required before this role bundle is fully ready.
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>

                <div>
                  <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                    Connector requirements
                  </p>
                  {selectedRoleBundle.requiredConnectorPlugins.length > 0 ? (
                    <div className="mt-2 space-y-1.5">
                      {selectedRoleBundle.requiredConnectorPlugins.map((requirement) => {
                        const installedConnector = roleBundleReadiness?.installedConnectors.find(
                          (entry) => entry.requirement.key === requirement.key,
                        );
                        const openApproval = pendingConnectorInstallApprovals.find(
                          (entry) => entry.requirement.key === requirement.key,
                        )?.approval;
                        const needsApproval = requestableConnectorRequirements.some(
                          (entry) => entry.key === requirement.key,
                        );
                        const needsManualSetup = roleBundleReadiness?.manualConnectorRequirements.some(
                          (entry) => entry.key === requirement.key,
                        );
                        return (
                          <div
                            key={requirement.key}
                            className="flex items-center justify-between gap-3 rounded-md border border-border/70 bg-background/70 px-3 py-2"
                          >
                            <div className="min-w-0 text-xs text-muted-foreground">
                              <div className="font-medium text-foreground">{requirement.displayName}</div>
                              {installedConnector ? (
                                <div className="text-emerald-700 dark:text-emerald-300">
                                  Installed via {installedConnector.plugin.pluginKey}
                                </div>
                              ) : openApproval ? (
                                <div className="text-amber-700 dark:text-amber-300">
                                  {openApproval.status === "revision_requested"
                                    ? "Approval open and waiting on revision"
                                    : "Approval already open"}
                                </div>
                              ) : needsApproval ? (
                                <div className="text-amber-700 dark:text-amber-300">
                                  Install approval required
                                </div>
                              ) : needsManualSetup ? (
                                <div>Manual setup required</div>
                              ) : null}
                              {requirement.reason ? (
                                <div className="truncate text-[11px] text-muted-foreground">
                                  {requirement.reason}
                                </div>
                              ) : null}
                            </div>
                            {openApproval ? (
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => navigate(`/approvals/${openApproval.id}`)}
                              >
                                Open approval
                              </Button>
                            ) : needsApproval ? (
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => openConnectorInstallDraft(requirement)}
                              >
                                Request now
                              </Button>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="mt-2 text-xs text-muted-foreground">
                      No default connector installs required for this bundle.
                    </p>
                  )}
                  {installedPluginsError instanceof Error ? (
                    <p className="mt-2 text-xs text-destructive">{installedPluginsError.message}</p>
                  ) : null}
                </div>

                {suggestedConnectorRecommendations.length > 0 ? (
                  <div>
                    <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                      Recommended connectors
                    </p>
                    <p className="mt-2 text-xs text-muted-foreground">
                      These installs do not block the hire. They are curated defaults for this role bundle based on bundled plugins that already exist in this repo.
                    </p>
                    <div className="mt-2 space-y-1.5">
                      {suggestedConnectorRecommendations.map(({ requirement, installedConnector, openApproval }) => (
                        <div
                          key={requirement.key}
                          className="flex items-center justify-between gap-3 rounded-md border border-border/70 bg-background/70 px-3 py-2"
                        >
                          <div className="min-w-0 text-xs text-muted-foreground">
                            <div className="font-medium text-foreground">{requirement.displayName}</div>
                            {requirement.description ? (
                              <div className="text-[11px] text-muted-foreground">
                                {requirement.description}
                              </div>
                            ) : null}
                            {installedConnector ? (
                              <div className="text-emerald-700 dark:text-emerald-300">
                                Installed via {installedConnector.pluginKey}
                              </div>
                            ) : openApproval ? (
                              <div className="text-amber-700 dark:text-amber-300">
                                {openApproval.status === "revision_requested"
                                  ? "Approval open and waiting on revision"
                                  : "Approval already open"}
                              </div>
                            ) : (
                              <div>Optional install</div>
                            )}
                            {requirement.reason ? (
                              <div className="truncate text-[11px] text-muted-foreground">
                                {requirement.reason}
                              </div>
                            ) : null}
                            {requirement.categories && requirement.categories.length > 0 ? (
                              <div className="mt-1 flex flex-wrap gap-1">
                                {requirement.categories.map((category) => (
                                  <span
                                    key={`${requirement.key}-${category}`}
                                    className="rounded-full border border-border px-2 py-0.5 text-[10px] uppercase tracking-[0.12em]"
                                  >
                                    {category}
                                  </span>
                                ))}
                              </div>
                            ) : null}
                          </div>
                          {installedConnector ? null : openApproval ? (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => navigate(`/approvals/${openApproval.id}`)}
                            >
                              Open approval
                            </Button>
                          ) : (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => openConnectorInstallDraft(requirement)}
                            >
                              Request now
                            </Button>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>

              <p className="text-xs text-muted-foreground">
                Paperclip will attach installed skills automatically and keep duplicate manual selections out of the hire request.
              </p>
            </div>
            {roleBundlesError instanceof Error ? (
              <p className="mt-2 text-xs text-destructive">{roleBundlesError.message}</p>
            ) : null}
          </div>
        )}

        {/* Shared config form */}
        <AgentConfigForm
          mode="create"
          values={configValues}
          onChange={(patch) => {
            if (patch.executionLocation !== undefined) {
              executionLocationTouchedRef.current = true;
            }
            setConfigValues((prev) => ({ ...prev, ...patch }));
          }}
          adapterModels={adapterModels}
        />

        <div className="border-t border-border px-4 py-4">
          <div className="space-y-3">
            <div>
              <h2 className="text-sm font-medium">Company skills</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Optional skills from the company library. Built-in Paperclip runtime skills are added automatically.
              </p>
            </div>
            {availableSkills.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No optional company skills installed yet.
              </p>
            ) : (
              <div className="space-y-3">
                {availableSkills.map((skill) => {
                  const inputId = `skill-${skill.id}`;
                  const includedViaBundle = bundleIncludedSkillKeys.includes(skill.key);
                  const checked = includedViaBundle || selectedSkillKeys.includes(skill.key);
                  return (
                    <div key={skill.id} className="flex items-start gap-3">
                      <Checkbox
                        id={inputId}
                        checked={checked}
                        disabled={includedViaBundle}
                        onCheckedChange={(next) => toggleSkill(skill.key, next === true)}
                      />
                      <label htmlFor={inputId} className="grid gap-1 leading-none">
                        <span className="text-sm font-medium">
                          {skill.name}
                          {includedViaBundle ? (
                            <span className="ml-2 text-[11px] font-normal text-emerald-700 dark:text-emerald-300">
                              Included via {selectedRoleBundle?.label ?? "role bundle"}
                            </span>
                          ) : null}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {skill.description ?? skill.key}
                        </span>
                      </label>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-border px-4 py-3">
          {isFirstAgent && (
            <p className="text-xs text-muted-foreground mb-2">This will be the CEO</p>
          )}
          {formError && (
            <p className="text-xs text-destructive mb-2">{formError}</p>
          )}
          <div className="flex items-center justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => navigate("/agents")}>
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={!name.trim() || createAgent.isPending}
              onClick={handleSubmit}
            >
              {createAgent.isPending ? "Creating..." : "Create agent"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
