import { UserPlus, Lightbulb, ShieldAlert, ShieldCheck, Send, PlugZap, Workflow } from "lucide-react";
import { formatCents } from "../lib/utils";

export const typeLabel: Record<string, string> = {
  hire_agent: "Hire Agent",
  approve_ceo_strategy: "CEO Strategy",
  budget_override_required: "Budget Override",
  publish_content: "Content Publication",
  install_company_skill: "Install Skill",
  install_connector_plugin: "Install Connector",
};

/** Build a contextual label for an approval, e.g. "Hire Agent: Designer" */
export function approvalLabel(type: string, payload?: Record<string, unknown> | null): string {
  const base = typeLabel[type] ?? type;
  if (type === "hire_agent" && payload?.name) {
    return `${base}: ${String(payload.name)}`;
  }
  if (type === "publish_content") {
    const channel = typeof payload?.channel === "string" ? payload.channel.trim() : "";
    const destination =
      typeof payload?.destinationLabel === "string"
        ? payload.destinationLabel.trim()
        : typeof payload?.target === "string"
          ? payload.target.trim()
          : "";
    if (channel && destination) {
      return `${base}: ${channel} -> ${destination}`;
    }
    if (channel) {
      return `${base}: ${channel}`;
    }
  }
  return base;
}

export const typeIcon: Record<string, typeof UserPlus> = {
  hire_agent: UserPlus,
  approve_ceo_strategy: Lightbulb,
  budget_override_required: ShieldAlert,
  publish_content: Send,
  install_company_skill: Workflow,
  install_connector_plugin: PlugZap,
};

export const defaultTypeIcon = ShieldCheck;

function PayloadField({ label, value }: { label: string; value: unknown }) {
  if (!value) return null;
  return (
    <div className="flex items-center gap-2">
      <span className="text-muted-foreground w-20 sm:w-24 shrink-0 text-xs">{label}</span>
      <span>{String(value)}</span>
    </div>
  );
}

function SkillList({ values }: { values: unknown }) {
  if (!Array.isArray(values)) return null;
  const items = values
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim())
    .filter(Boolean);
  if (items.length === 0) return null;

  return (
    <div className="flex items-start gap-2">
      <span className="text-muted-foreground w-20 sm:w-24 shrink-0 text-xs pt-0.5">Skills</span>
      <div className="flex flex-wrap gap-1.5">
        {items.map((item) => (
          <span
            key={item}
            className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground"
          >
            {item}
          </span>
        ))}
      </div>
    </div>
  );
}

function StringList({ label, values }: { label: string; values: unknown }) {
  if (!Array.isArray(values)) return null;
  const items = values
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim())
    .filter(Boolean);
  if (items.length === 0) return null;

  return (
    <div className="flex items-start gap-2">
      <span className="text-muted-foreground w-20 sm:w-24 shrink-0 text-xs pt-0.5">{label}</span>
      <div className="flex flex-wrap gap-1.5">
        {items.map((item) => (
          <span
            key={`${label}:${item}`}
            className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground"
          >
            {item}
          </span>
        ))}
      </div>
    </div>
  );
}

function ConnectorList({ label, values }: { label: string; values: unknown }) {
  if (!Array.isArray(values)) return null;
  const items = values
    .map((value) => {
      if (typeof value === "string") return value.trim();
      if (!value || typeof value !== "object") return "";
      const record = value as Record<string, unknown>;
      return [
        record.displayName,
        record.name,
        record.pluginKey,
        record.pluginId,
        record.packageName,
        record.localPath,
        record.key,
      ]
        .find((candidate) => typeof candidate === "string" && candidate.trim().length > 0)?.toString().trim() ?? "";
    })
    .filter(Boolean);
  if (items.length === 0) return null;

  return <StringList label={label} values={items} />;
}

export function HireAgentPayload({ payload }: { payload: Record<string, unknown> }) {
  return (
    <div className="mt-3 space-y-1.5 text-sm">
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground w-20 sm:w-24 shrink-0 text-xs">Name</span>
        <span className="font-medium">{String(payload.name ?? "—")}</span>
      </div>
      <PayloadField label="Role" value={payload.role} />
      <PayloadField label="Title" value={payload.title} />
      <PayloadField label="Icon" value={payload.icon} />
      {!!payload.capabilities && (
        <div className="flex items-start gap-2">
          <span className="text-muted-foreground w-20 sm:w-24 shrink-0 text-xs pt-0.5">Capabilities</span>
          <span className="text-muted-foreground">{String(payload.capabilities)}</span>
        </div>
      )}
      {!!payload.adapterType && (
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground w-20 sm:w-24 shrink-0 text-xs">Adapter</span>
          <span className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">
            {String(payload.adapterType)}
          </span>
        </div>
      )}
      <PayloadField label="Bundle" value={payload.roleBundleKey} />
      <PayloadField label="Bundle source" value={payload.roleBundleSelectionSource} />
      <PayloadField label="Bundle why" value={payload.roleBundleSelectionReason} />
      <PayloadField label="Reason" value={payload.staffingReason} />
      <PayloadField label="Follow-up" value={payload.followUpAction} />
      <PayloadField label="Issue" value={payload.followUpIssueId} />
      <SkillList values={payload.desiredSkills} />
      <StringList label="Requests" values={payload.requestedSkills} />
      <StringList label="Missing skills" values={payload.missingRequestedSkillDisplayNames ?? payload.missingRequestedSkillRefs} />
      <ConnectorList label="Connectors" values={payload.missingConnectorPlugins} />
      <StringList label="Connectors" values={payload.missingConnectorPluginDisplayNames} />
    </div>
  );
}

export function InstallSkillPayload({ payload }: { payload: Record<string, unknown> }) {
  return (
    <div className="mt-3 space-y-1.5 text-sm">
      <PayloadField label="Skill" value={payload.name ?? payload.skillId ?? payload.slug} />
      <PayloadField label="Ref" value={payload.requestedRef ?? payload.slug} />
      <PayloadField label="Source" value={payload.source} />
      <PayloadField label="Bundle" value={payload.roleBundleLabel ?? payload.roleBundleKey} />
      <PayloadField label="Agent" value={payload.requiredByAgentName ?? payload.requiredByAgentId} />
      <PayloadField label="Reason" value={payload.reason} />
    </div>
  );
}

export function InstallConnectorPayload({ payload }: { payload: Record<string, unknown> }) {
  return (
    <div className="mt-3 space-y-1.5 text-sm">
      <PayloadField label="Plugin" value={payload.name ?? payload.pluginId ?? payload.pluginSlug} />
      <PayloadField label="Key" value={payload.pluginKey ?? payload.pluginId ?? payload.pluginSlug} />
      <PayloadField label="Package" value={payload.packageName ?? payload.localPath} />
      <PayloadField label="Source" value={payload.source} />
      <PayloadField label="Bundle" value={payload.roleBundleLabel ?? payload.roleBundleKey} />
      <PayloadField label="Agent" value={payload.requiredByAgentName ?? payload.requiredByAgentId} />
      <PayloadField label="Reason" value={payload.reason} />
    </div>
  );
}

export function CeoStrategyPayload({ payload }: { payload: Record<string, unknown> }) {
  const plan = payload.plan ?? payload.description ?? payload.strategy ?? payload.text;
  return (
    <div className="mt-3 space-y-1.5 text-sm">
      <PayloadField label="Title" value={payload.title} />
      {!!plan && (
        <div className="mt-2 rounded-md bg-muted/40 px-3 py-2 text-sm text-muted-foreground whitespace-pre-wrap font-mono text-xs max-h-48 overflow-y-auto">
          {String(plan)}
        </div>
      )}
      {!plan && (
        <pre className="mt-2 rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground overflow-x-auto max-h-48">
          {JSON.stringify(payload, null, 2)}
        </pre>
      )}
    </div>
  );
}

export function BudgetOverridePayload({ payload }: { payload: Record<string, unknown> }) {
  const budgetAmount = typeof payload.budgetAmount === "number" ? payload.budgetAmount : null;
  const observedAmount = typeof payload.observedAmount === "number" ? payload.observedAmount : null;
  return (
    <div className="mt-3 space-y-1.5 text-sm">
      <PayloadField label="Scope" value={payload.scopeName ?? payload.scopeType} />
      <PayloadField label="Window" value={payload.windowKind} />
      <PayloadField label="Metric" value={payload.metric} />
      {(budgetAmount !== null || observedAmount !== null) ? (
        <div className="rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          Limit {budgetAmount !== null ? formatCents(budgetAmount) : "—"} · Observed {observedAmount !== null ? formatCents(observedAmount) : "—"}
        </div>
      ) : null}
      {!!payload.guidance && (
        <p className="text-muted-foreground">{String(payload.guidance)}</p>
      )}
    </div>
  );
}

export function PublishContentPayload({ payload }: { payload: Record<string, unknown> }) {
  const publishAt =
    typeof payload.publishAt === "string"
      ? payload.publishAt
      : typeof payload.scheduledFor === "string"
        ? payload.scheduledFor
        : null;
  const summary =
    typeof payload.sourceSummary === "string"
      ? payload.sourceSummary
      : typeof payload.summary === "string"
        ? payload.summary
        : null;
  const excerpt =
    typeof payload.draftExcerpt === "string"
      ? payload.draftExcerpt
      : typeof payload.finalExcerpt === "string"
        ? payload.finalExcerpt
        : typeof payload.body === "string"
          ? payload.body
          : null;

  return (
    <div className="mt-3 space-y-1.5 text-sm">
      <PayloadField label="Channel" value={payload.channel} />
      <PayloadField label="Target" value={payload.destinationLabel ?? payload.target} />
      <PayloadField label="Voice" value={payload.authorVoice ?? payload.styleProfile} />
      <PayloadField label="Publish at" value={publishAt} />
      <PayloadField label="Source doc" value={payload.sourceDocumentId} />
      <PayloadField label="Draft doc" value={payload.draftDocumentId} />
      <PayloadField label="Final doc" value={payload.finalDocumentId} />
      {summary ? (
        <div className="mt-2 rounded-md bg-muted/40 px-3 py-2 text-sm text-muted-foreground whitespace-pre-wrap">
          {summary}
        </div>
      ) : null}
      {excerpt ? (
        <div className="mt-2 rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground whitespace-pre-wrap font-mono max-h-48 overflow-y-auto">
          {excerpt}
        </div>
      ) : null}
      <StringList label="Risks" values={payload.riskFlags} />
      <StringList label="Checks" values={payload.safetyChecks} />
    </div>
  );
}

export function ApprovalPayloadRenderer({ type, payload }: { type: string; payload: Record<string, unknown> }) {
  if (type === "hire_agent") return <HireAgentPayload payload={payload} />;
  if (type === "budget_override_required") return <BudgetOverridePayload payload={payload} />;
  if (type === "publish_content") return <PublishContentPayload payload={payload} />;
  if (type === "install_company_skill") return <InstallSkillPayload payload={payload} />;
  if (type === "install_connector_plugin") return <InstallConnectorPayload payload={payload} />;
  return <CeoStrategyPayload payload={payload} />;
}
