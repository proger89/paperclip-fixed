import { useEffect, useMemo, useState } from "react";
import type { Agent, Issue } from "@paperclipai/shared";
import { CheckCircle2, ClipboardList, ShieldAlert, Sparkles, UserRoundCheck } from "lucide-react";
import { useToast } from "../context/ToastContext";
import { cn } from "../lib/utils";
import { getIssueReviewSummary, parseAcceptanceChecklistDraft } from "../lib/issue-review";
import { Button } from "./ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { Textarea } from "./ui/textarea";

function reviewerSelectionFromIssue(issue: Pick<Issue, "reviewerAgentId" | "reviewerUserId">) {
  if (issue.reviewerAgentId) return `agent:${issue.reviewerAgentId}`;
  if (issue.reviewerUserId) return `user:${issue.reviewerUserId}`;
  return "unassigned";
}

function sameChecklist(a: string[] | null | undefined, b: string[]) {
  const left = a ?? [];
  if (left.length !== b.length) return false;
  return left.every((item, index) => item === b[index]);
}

export function IssueReviewHandoffCard({
  issue,
  agents,
  currentUserId,
  onUpdate,
  isUpdating = false,
}: {
  issue: Issue;
  agents: Agent[];
  currentUserId: string | null;
  onUpdate: (data: Record<string, unknown>) => Promise<unknown>;
  isUpdating?: boolean;
}) {
  const { pushToast } = useToast();
  const reviewSummary = useMemo(
    () => getIssueReviewSummary(issue, issue.workProducts ?? []),
    [issue],
  );
  const [reviewerSelection, setReviewerSelection] = useState(reviewerSelectionFromIssue(issue));
  const [checklistDraft, setChecklistDraft] = useState((issue.acceptanceChecklistJson ?? []).join("\n"));

  useEffect(() => {
    setReviewerSelection(reviewerSelectionFromIssue(issue));
  }, [issue.reviewerAgentId, issue.reviewerUserId]);

  useEffect(() => {
    setChecklistDraft((issue.acceptanceChecklistJson ?? []).join("\n"));
  }, [issue.acceptanceChecklistJson]);

  const activeAgents = useMemo(
    () => [...agents]
      .filter((agent) => agent.status !== "terminated")
      .sort((a, b) => a.name.localeCompare(b.name)),
    [agents],
  );

  const reviewerOptions = useMemo(() => {
    const options = [{ value: "unassigned", label: "No reviewer" }];
    if (currentUserId) {
      options.push({
        value: `user:${currentUserId}`,
        label: issue.reviewerUserId === currentUserId ? "Board reviewer (me)" : "Assign me as board reviewer",
      });
    } else if (issue.reviewerUserId) {
      options.push({
        value: `user:${issue.reviewerUserId}`,
        label: "Board reviewer",
      });
    }
    if (issue.reviewerUserId && currentUserId && issue.reviewerUserId !== currentUserId) {
      options.push({
        value: `user:${issue.reviewerUserId}`,
        label: "Current board reviewer",
      });
    }
    for (const agent of activeAgents) {
      options.push({
        value: `agent:${agent.id}`,
        label: `${agent.name} (${agent.role.replaceAll("_", " ")})`,
      });
    }
    if (
      issue.reviewerAgentId
      && !activeAgents.some((agent) => agent.id === issue.reviewerAgentId)
    ) {
      options.push({
        value: `agent:${issue.reviewerAgentId}`,
        label: `Current reviewer (${issue.reviewerAgentId.slice(0, 8)})`,
      });
    }
    return options;
  }, [activeAgents, currentUserId, issue.reviewerAgentId, issue.reviewerUserId]);

  const checklistItems = parseAcceptanceChecklistDraft(checklistDraft);
  const checklistChanged = !sameChecklist(issue.acceptanceChecklistJson, checklistItems);
  const reviewerChanged = reviewerSelection !== reviewerSelectionFromIssue(issue);

  const toneClasses = {
    approved: "border-emerald-500/30 bg-emerald-500/10 text-emerald-900 dark:text-emerald-100",
    changes_requested: "border-red-500/30 bg-red-500/10 text-red-900 dark:text-red-100",
    ready_for_handoff: "border-sky-500/30 bg-sky-500/10 text-sky-900 dark:text-sky-100",
    missing_setup: "border-amber-500/30 bg-amber-500/10 text-amber-900 dark:text-amber-100",
    awaiting_approval: "border-amber-500/30 bg-amber-500/10 text-amber-900 dark:text-amber-100",
    not_required: "border-border/70 bg-muted/20 text-foreground",
  } as const;

  const statusIcon =
    reviewSummary.stage === "approved"
      ? CheckCircle2
      : reviewSummary.stage === "changes_requested"
        ? ShieldAlert
        : Sparkles;
  const StatusIcon = statusIcon;

  async function handleSaveReviewer() {
    const payload =
      reviewerSelection === "unassigned"
        ? { reviewerAgentId: null, reviewerUserId: null }
        : reviewerSelection.startsWith("agent:")
          ? { reviewerAgentId: reviewerSelection.slice(6), reviewerUserId: null }
          : { reviewerAgentId: null, reviewerUserId: reviewerSelection.slice(5) };

    try {
      await onUpdate(payload);
      pushToast({ title: "Reviewer updated", tone: "success" });
    } catch (error) {
      pushToast({
        title: error instanceof Error ? error.message : "Failed to update reviewer",
        tone: "error",
      });
    }
  }

  async function handleSaveChecklist() {
    try {
      await onUpdate({
        acceptanceChecklistJson: checklistItems.length > 0 ? checklistItems : null,
      });
      pushToast({ title: "Checklist updated", tone: "success" });
    } catch (error) {
      pushToast({
        title: error instanceof Error ? error.message : "Failed to update checklist",
        tone: "error",
      });
    }
  }

  async function handleMoveToReview() {
    try {
      await onUpdate({ status: "in_review" });
      pushToast({ title: "Issue moved to in review", tone: "success" });
    } catch (error) {
      pushToast({
        title: error instanceof Error ? error.message : "Failed to update issue status",
        tone: "error",
      });
    }
  }

  if (!reviewSummary.reviewRequired) return null;

  return (
    <div className="space-y-4 rounded-xl border border-border/70 bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Review handoff</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            {reviewSummary.reviewPolicyLabel} requires one approved output before this issue can move to done.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full border border-border/70 bg-muted/30 px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
            Accepts {reviewSummary.reviewableTypeLabels.join(", ")}
          </span>
          {reviewSummary.shouldSuggestInReview ? (
            <Button
              type="button"
              size="sm"
              onClick={handleMoveToReview}
              disabled={isUpdating}
            >
              Move to in review
            </Button>
          ) : null}
        </div>
      </div>

      <div className={cn("rounded-lg border px-3 py-3", toneClasses[reviewSummary.stage])}>
        <div className="flex items-start gap-2">
          <StatusIcon className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="space-y-1">
            <div className="text-sm font-medium">{reviewSummary.summary}</div>
            <div className="text-sm opacity-90">{reviewSummary.detail}</div>
          </div>
        </div>
        {reviewSummary.blockers.length > 0 ? (
          <div className="mt-3 space-y-1.5 text-sm">
            {reviewSummary.blockers.map((blocker) => (
              <div key={blocker} className="flex items-start gap-2">
                <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>{blocker}</span>
              </div>
            ))}
          </div>
        ) : null}
        {reviewSummary.warnings.length > 0 ? (
          <div className="mt-3 space-y-1.5 text-sm opacity-90">
            {reviewSummary.warnings.map((warning) => (
              <div key={warning} className="flex items-start gap-2">
                <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>{warning}</span>
              </div>
            ))}
          </div>
        ) : null}
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-border/70 bg-muted/20 px-3 py-3">
          <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Reviewer
          </div>
          <div className="mt-1 text-2xl font-semibold text-foreground">
            {reviewSummary.reviewerAssigned ? "Assigned" : "Missing"}
          </div>
        </div>
        <div className="rounded-lg border border-border/70 bg-muted/20 px-3 py-3">
          <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Reviewable outputs
          </div>
          <div className="mt-1 text-2xl font-semibold text-foreground">
            {reviewSummary.reviewableProducts.length}
          </div>
        </div>
        <div className="rounded-lg border border-border/70 bg-muted/20 px-3 py-3">
          <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Approved outputs
          </div>
          <div className="mt-1 text-2xl font-semibold text-foreground">
            {reviewSummary.approvedProducts.length}
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.1fr_1fr]">
        <div className="space-y-3 rounded-lg border border-border/70 bg-muted/15 px-3 py-3">
          <div className="flex items-center gap-2">
            <UserRoundCheck className="h-4 w-4 text-muted-foreground" />
            <div>
              <div className="text-sm font-medium text-foreground">Reviewer assignment</div>
              <div className="text-xs text-muted-foreground">
                Pick the board operator or agent who should accept this work.
              </div>
            </div>
          </div>

          <Select value={reviewerSelection} onValueChange={setReviewerSelection}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select reviewer" />
            </SelectTrigger>
            <SelectContent>
              {reviewerOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={handleSaveReviewer}
              disabled={!reviewerChanged || isUpdating}
            >
              Save reviewer
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setReviewerSelection("unassigned")}
              disabled={reviewerSelection === "unassigned" || isUpdating}
            >
              Clear reviewer
            </Button>
          </div>
        </div>

        <div className="space-y-3 rounded-lg border border-border/70 bg-muted/15 px-3 py-3">
          <div className="flex items-center gap-2">
            <ClipboardList className="h-4 w-4 text-muted-foreground" />
            <div>
              <div className="text-sm font-medium text-foreground">Acceptance checklist</div>
              <div className="text-xs text-muted-foreground">
                One line per review checkpoint. Leave blank if this issue does not need a checklist.
              </div>
            </div>
          </div>

          <Textarea
            value={checklistDraft}
            onChange={(event) => setChecklistDraft(event.target.value)}
            rows={5}
            placeholder={"Open preview\nValidate polish on mobile\nConfirm links and docs"}
          />

          <div className="flex items-center justify-between gap-3">
            <div className="text-xs text-muted-foreground">
              {checklistItems.length > 0 ? `${checklistItems.length} checklist items` : "No checklist items"}
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={handleSaveChecklist}
              disabled={!checklistChanged || isUpdating}
            >
              Save checklist
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
