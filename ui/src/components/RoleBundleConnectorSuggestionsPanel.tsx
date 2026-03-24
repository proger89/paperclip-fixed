import { Link } from "@/lib/router";
import { Button } from "@/components/ui/button";
import { cn } from "../lib/utils";
import { buildInstallApprovalPrefillPath } from "../lib/install-approval-prefill";
import type { RoleBundleConnectorSuggestionItem } from "../lib/role-bundle-connector-suggestions";

interface RoleBundleConnectorSuggestionsPanelProps {
  suggestions: RoleBundleConnectorSuggestionItem[];
  title: string;
  description?: string;
  emptyMessage?: string;
  showInstalled?: boolean;
  limit?: number;
  className?: string;
}

export function RoleBundleConnectorSuggestionsPanel({
  suggestions,
  title,
  description,
  emptyMessage = "No connector suggestions right now.",
  showInstalled = false,
  limit,
  className,
}: RoleBundleConnectorSuggestionsPanelProps) {
  const visible = (showInstalled
    ? suggestions
    : suggestions.filter((item) => item.status !== "installed"))
    .slice(0, limit);

  return (
    <div className={cn("space-y-3", className)}>
      <div>
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
          {title}
        </h3>
        {description ? (
          <p className="mt-1 text-xs text-muted-foreground">{description}</p>
        ) : null}
      </div>

      {visible.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border/70 p-4 text-sm text-muted-foreground">
          {emptyMessage}
        </div>
      ) : (
        <div className="space-y-3">
          {visible.map((item) => (
            <div
              key={`${item.bundleKey}:${item.requirement.key}`}
              className="rounded-xl border border-border/70 bg-card p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-medium">{item.requirement.displayName}</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {item.bundleLabel} · {item.bundleTitle}
                  </div>
                </div>
                {item.status === "installed" ? (
                  <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-300">
                    Installed
                  </span>
                ) : item.status === "approval_open" ? (
                  <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-300">
                    Approval open
                  </span>
                ) : (
                  <span className="rounded-full border border-border px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                    Suggested
                  </span>
                )}
              </div>

              {item.requirement.description ? (
                <p className="mt-3 text-sm text-muted-foreground">
                  {item.requirement.description}
                </p>
              ) : null}

              {item.requirement.reason ? (
                <p className="mt-2 text-xs text-muted-foreground">{item.requirement.reason}</p>
              ) : null}

              {item.requirement.categories && item.requirement.categories.length > 0 ? (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {item.requirement.categories.map((category) => (
                    <span
                      key={`${item.bundleKey}:${item.requirement.key}:${category}`}
                      className="rounded-full border border-border px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] text-muted-foreground"
                    >
                      {category}
                    </span>
                  ))}
                </div>
              ) : null}

              {item.status === "installed" ? null : (
                <div className="mt-3 flex justify-end">
                  {item.status === "approval_open" && item.openApproval ? (
                    <Button size="sm" variant="outline" asChild>
                      <Link to={`/approvals/${item.openApproval.id}`}>Open approval</Link>
                    </Button>
                  ) : (
                    <Button size="sm" variant="outline" asChild>
                      <Link
                        to={buildInstallApprovalPrefillPath({
                          kind: "connector",
                          mode: item.requirement.source === "npm" ? "npm" : "local_path",
                          packageName: item.requirement.packageName ?? null,
                          localPath: item.requirement.localPath ?? null,
                          pluginKey: item.requirement.pluginKey ?? item.requirement.key,
                          name: item.requirement.displayName,
                          version: item.requirement.version ?? null,
                          roleBundleKey: item.bundleKey,
                          reason: item.requirement.reason ?? `Suggested for ${item.bundleLabel} role bundle`,
                        })}
                      >
                        Request install
                      </Link>
                    </Button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
