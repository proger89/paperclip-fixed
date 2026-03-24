import type { ReactNode } from "react";
import { Link } from "@/lib/router";
import type { IssueWorkProduct, WorkProductSummaryItem } from "@paperclipai/shared";
import {
  BadgeCheck,
  ExternalLink,
  Eye,
  FileText,
  GitBranch,
  GitCommitHorizontal,
  GitPullRequestArrow,
  Globe,
  Package2,
  TriangleAlert,
} from "lucide-react";
import { timeAgo } from "../lib/timeAgo";
import { cn } from "../lib/utils";

type WorkProductLike = IssueWorkProduct | WorkProductSummaryItem;

const TYPE_LABELS: Record<string, string> = {
  preview_url: "Preview",
  runtime_service: "Runtime",
  pull_request: "Pull Request",
  branch: "Branch",
  commit: "Commit",
  artifact: "Artifact",
  document: "Document",
};

const TYPE_ICONS = {
  preview_url: Eye,
  runtime_service: Globe,
  pull_request: GitPullRequestArrow,
  branch: GitBranch,
  commit: GitCommitHorizontal,
  artifact: Package2,
  document: FileText,
} as const;

function badgeTone(value: string | null | undefined) {
  if (!value) return "border-border/70 bg-muted/40 text-muted-foreground";
  if (value === "approved" || value === "merged" || value === "healthy") {
    return "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
  }
  if (value === "ready_for_review") {
    return "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300";
  }
  if (value === "changes_requested" || value === "failed" || value === "unhealthy") {
    return "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300";
  }
  if (value === "active") {
    return "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300";
  }
  return "border-border/70 bg-muted/40 text-muted-foreground";
}

function prettyLabel(value: string) {
  return value.replaceAll("_", " ");
}

function isOpenableUrl(value: string | null | undefined) {
  if (!value) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function WorkProductBadge({ label, tone }: { label: string; tone?: string }) {
  return (
    <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium", tone)}>
      {label}
    </span>
  );
}

export function WorkProductCard({
  product,
  compact = false,
  showIssueLink = false,
  showProjectName = false,
  actions,
}: {
  product: WorkProductLike;
  compact?: boolean;
  showIssueLink?: boolean;
  showProjectName?: boolean;
  actions?: ReactNode;
}) {
  const Icon = TYPE_ICONS[product.type] ?? Package2;
  const openable = isOpenableUrl(product.url);

  return (
    <div
      className={cn(
        "rounded-xl border border-border/70 bg-card",
        compact ? "p-3" : "p-4",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-2">
          <div className="flex items-center gap-2">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border/70 bg-muted/30">
              <Icon className="h-4 w-4 text-muted-foreground" />
            </span>
            <div className="min-w-0">
              <div className="truncate text-sm font-medium">{product.title}</div>
              <div className="text-xs text-muted-foreground">
                {TYPE_LABELS[product.type] ?? prettyLabel(product.type)}
                {" · "}
                updated {timeAgo(product.updatedAt)}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-1.5">
            <WorkProductBadge
              label={TYPE_LABELS[product.type] ?? prettyLabel(product.type)}
            />
            <WorkProductBadge
              label={prettyLabel(product.status)}
              tone={badgeTone(product.status)}
            />
            {product.reviewState !== "none" ? (
              <WorkProductBadge
                label={`Review: ${prettyLabel(product.reviewState)}`}
                tone={badgeTone(product.reviewState)}
              />
            ) : null}
            {product.healthStatus !== "unknown" ? (
              <WorkProductBadge
                label={product.healthStatus === "healthy" ? "Healthy" : "Needs attention"}
                tone={badgeTone(product.healthStatus)}
              />
            ) : null}
            {product.isPrimary ? (
              <WorkProductBadge label="Primary" />
            ) : null}
          </div>

          {product.summary ? (
            <p className={cn("text-sm text-muted-foreground", compact && "text-xs")}>
              {product.summary}
            </p>
          ) : null}

          {(showIssueLink || showProjectName) && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              {showIssueLink && "issueIdentifier" in product && product.issueIdentifier ? (
                <Link
                  to={`/issues/${product.issueIdentifier ?? product.issueId}`}
                  className="hover:text-foreground hover:underline"
                >
                  {product.issueIdentifier}: {product.issueTitle}
                </Link>
              ) : null}
              {showProjectName && "projectName" in product && product.projectName ? (
                <span>{product.projectName}</span>
              ) : null}
            </div>
          )}
        </div>

        {openable ? (
          <a
            href={product.url!}
            target="_blank"
            rel="noreferrer"
            className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border/70 px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:border-border hover:text-foreground"
          >
            Open
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        ) : null}
      </div>

      {actions ? (
        <div className={cn("mt-3 border-t border-border/70 pt-3", compact && "mt-2 pt-2")}>
          {actions}
        </div>
      ) : null}
    </div>
  );
}

export function WorkProductReviewSummary({
  pendingCount,
  missingReviewerCount = 0,
}: {
  pendingCount: number;
  missingReviewerCount?: number;
}) {
  if (pendingCount <= 0 && missingReviewerCount <= 0) return null;
  return (
    <div className="rounded-xl border border-amber-500/25 bg-amber-500/8 px-4 py-3 text-sm text-amber-900 dark:text-amber-100">
      <div className="flex items-start gap-2">
        <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-300" />
        <div className="space-y-1">
          {pendingCount > 0 ? (
            <div>
              <span className="font-medium">{pendingCount}</span> issues are waiting for review.
            </div>
          ) : null}
          {missingReviewerCount > 0 ? (
            <div>
              <span className="font-medium">{missingReviewerCount}</span> review-gated issues still have no reviewer.
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function WorkProductStatusSummary({
  activePreviews,
  readyForReview,
  failed,
}: {
  activePreviews: number;
  readyForReview: number;
  failed: number;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <div className="rounded-xl border border-border/70 bg-card px-4 py-3">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">Active previews</div>
        <div className="mt-1 text-2xl font-semibold">{activePreviews}</div>
      </div>
      <div className="rounded-xl border border-border/70 bg-card px-4 py-3">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">Ready for review</div>
        <div className="mt-1 text-2xl font-semibold">{readyForReview}</div>
      </div>
      <div className="rounded-xl border border-border/70 bg-card px-4 py-3">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">Failed outputs</div>
        <div className="mt-1 flex items-center gap-2 text-2xl font-semibold">
          {failed}
          {failed > 0 ? <TriangleAlert className="h-5 w-5 text-red-500" /> : <BadgeCheck className="h-5 w-5 text-emerald-500" />}
        </div>
      </div>
    </div>
  );
}
