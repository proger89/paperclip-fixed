import type { Project, WorkProductSummaryItem } from "@paperclipai/shared";
import { ExternalLink, Github, Link as LinkIcon, FolderOpen, RadioTower } from "lucide-react";
import { WorkProductCard } from "./WorkProductCard";

function isSafeExternalUrl(value: string | null | undefined) {
  if (!value) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function formatRepoUrl(value: string) {
  try {
    const parsed = new URL(value);
    const segments = parsed.pathname.split("/").filter(Boolean);
    if (segments.length < 2) return parsed.host;
    return `${parsed.host}/${segments[0]}/${segments[1]?.replace(/\.git$/i, "") ?? ""}`.replace(/\/$/, "");
  } catch {
    return value;
  }
}

export function ProjectCodeOutputsPanel({
  project,
  outputs,
}: {
  project: Project;
  outputs: WorkProductSummaryItem[];
}) {
  const runtimeServices = project.primaryWorkspace?.runtimeServices ?? [];

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border/70 bg-card p-4">
        <div className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Code & Outputs
        </div>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
          <div className="space-y-3">
            <div className="rounded-lg border border-border/70 bg-muted/20 p-3">
              <div className="mb-2 text-[11px] uppercase tracking-wide text-muted-foreground">Code</div>
              <div className="space-y-2 text-sm">
                {project.codebase.repoUrl ? (
                  <div className="flex items-center gap-2">
                    <Github className="h-4 w-4 text-muted-foreground" />
                    {isSafeExternalUrl(project.codebase.repoUrl) ? (
                      <a
                        href={project.codebase.repoUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex min-w-0 items-center gap-1.5 hover:underline"
                      >
                        <span className="truncate">{formatRepoUrl(project.codebase.repoUrl)}</span>
                        <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                      </a>
                    ) : (
                      <span className="truncate">{project.codebase.repoUrl}</span>
                    )}
                  </div>
                ) : (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Github className="h-4 w-4" />
                    Repo not set
                  </div>
                )}

                <div className="flex items-center gap-2 text-muted-foreground">
                  <FolderOpen className="h-4 w-4" />
                  <span className="truncate">{project.codebase.effectiveLocalFolder || "Local folder not set"}</span>
                </div>
              </div>
            </div>

            <div className="rounded-lg border border-border/70 bg-muted/20 p-3">
              <div className="mb-2 text-[11px] uppercase tracking-wide text-muted-foreground">Runtime services</div>
              {runtimeServices.length === 0 ? (
                <div className="text-sm text-muted-foreground">No runtime services published yet.</div>
              ) : (
                <div className="space-y-2">
                  {runtimeServices.slice(0, 4).map((service) => (
                    <div key={service.id} className="flex items-start justify-between gap-3 rounded-md border border-border/70 bg-background/80 p-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 text-sm font-medium">
                          <RadioTower className="h-4 w-4 text-muted-foreground" />
                          <span className="truncate">{service.serviceName}</span>
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          {service.lifecycle} · {service.status}
                        </div>
                      </div>
                      {service.url ? (
                        <a
                          href={service.url}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border/70 px-2 py-1 text-xs hover:text-foreground"
                        >
                          Open
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      ) : null}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex items-center gap-2 text-[11px] uppercase tracking-wide text-muted-foreground">
              <LinkIcon className="h-3.5 w-3.5" />
              Recent outputs
            </div>
            {outputs.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border/70 p-4 text-sm text-muted-foreground">
                Outputs will appear here once agents publish previews, runtime links, artifacts, or docs.
              </div>
            ) : (
              <div className="space-y-3">
                {outputs.slice(0, 4).map((product) => (
                  <WorkProductCard
                    key={product.id}
                    product={product}
                    compact
                    showIssueLink
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
