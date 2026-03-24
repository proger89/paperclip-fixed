import {
  AGENT_ROLE_LABELS,
  AGENT_ROLES,
  REVIEW_POLICY_KEYS,
  REVIEW_POLICY_LABELS,
  ROLE_BUNDLE_KEYS,
} from "@paperclipai/shared";
import { Plus, RotateCcw, Trash2 } from "lucide-react";
import { Button } from "./ui/button";
import { HintIcon } from "./agent-config-primitives";
import {
  buildCustomReviewRuleDraft,
  buildPresetReviewRuleDraft,
  DEFAULT_REQUIRED_REVIEW_BY_ROLE,
  ReviewRuleDraft,
  sortReviewRuleDrafts,
} from "./company-review-rule-drafts";

function roleBundleLabel(roleKey: string) {
  return roleKey.replaceAll("_", " ");
}

function defaultRuleForRole(roleKey: string) {
  return DEFAULT_REQUIRED_REVIEW_BY_ROLE[roleKey] ?? null;
}

function isPresetRole(roleKey: string) {
  return ROLE_BUNDLE_KEYS.includes(roleKey as (typeof ROLE_BUNDLE_KEYS)[number]);
}

export function CompanyReviewRulesEditor({
  drafts,
  onChange,
  error,
  onErrorChange,
}: {
  drafts: ReviewRuleDraft[];
  onChange: (next: ReviewRuleDraft[]) => void;
  error?: string | null;
  onErrorChange?: (value: string | null) => void;
}) {
  const usedRoleKeys = new Set(drafts.map((draft) => draft.roleKey));
  const missingPresetRoles = ROLE_BUNDLE_KEYS.filter((roleKey) => !usedRoleKeys.has(roleKey));

  function updateDraft(id: string, patch: Partial<ReviewRuleDraft>) {
    onChange(sortReviewRuleDrafts(
      drafts.map((draft) => (draft.id === id ? { ...draft, ...patch } : draft)),
    ));
    onErrorChange?.(null);
  }

  function addPresetRole(roleKey: string) {
    onChange(sortReviewRuleDrafts([...drafts, buildPresetReviewRuleDraft(roleKey)]));
    onErrorChange?.(null);
  }

  function addCustomRole() {
    onChange([...drafts, buildCustomReviewRuleDraft()]);
    onErrorChange?.(null);
  }

  function removeDraft(draft: ReviewRuleDraft) {
    const defaultRule = defaultRuleForRole(draft.roleKey);
    if (defaultRule) {
      updateDraft(draft.id, {
        reviewPolicyKey: defaultRule.reviewPolicyKey,
        reviewerRole: defaultRule.reviewerRole ?? "",
      });
      return;
    }
    onChange(drafts.filter((item) => item.id !== draft.id));
    onErrorChange?.(null);
  }

  return (
    <div className="space-y-3">
      <div className="rounded-md border border-border/70 bg-muted/20 p-3 text-xs text-muted-foreground">
        Review-gated roles cannot complete work until a reviewer and acceptable work products exist.
        Default specialist rules are recommended and can be overridden here.
      </div>

      <div className="space-y-3">
        {drafts.map((draft) => {
          const defaultRule = defaultRuleForRole(draft.roleKey);
          const canRemove = !defaultRule;
          const roleKeyChoices = ROLE_BUNDLE_KEYS.filter((roleKey) => roleKey === draft.roleKey || !usedRoleKeys.has(roleKey));

          return (
            <div key={draft.id} className="rounded-md border border-border px-3 py-3">
              <div className="grid gap-3 md:grid-cols-[1.1fr_1fr_1fr_auto] md:items-end">
                <div className="space-y-1">
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <span>Role bundle</span>
                    <HintIcon text="This matches the role bundle key used during hire and follow-up assignment." />
                  </div>
                  {draft.keyMode === "preset" ? (
                    <select
                      className="w-full rounded-md border border-border bg-transparent px-2.5 py-1.5 text-sm outline-none"
                      value={draft.roleKey}
                      onChange={(event) => updateDraft(draft.id, { roleKey: event.target.value })}
                    >
                      {roleKeyChoices.map((roleKey) => (
                        <option key={roleKey} value={roleKey}>
                          {roleBundleLabel(roleKey)}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      className="w-full rounded-md border border-border bg-transparent px-2.5 py-1.5 text-sm outline-none"
                      value={draft.roleKey}
                      placeholder="custom_role_bundle"
                      onChange={(event) => updateDraft(draft.id, { roleKey: event.target.value })}
                    />
                  )}
                </div>

                <div className="space-y-1">
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <span>Review policy</span>
                    <HintIcon text="Controls which output types are required before the issue can move to done." />
                  </div>
                  <select
                    className="w-full rounded-md border border-border bg-transparent px-2.5 py-1.5 text-sm outline-none"
                    value={draft.reviewPolicyKey}
                    onChange={(event) => updateDraft(draft.id, { reviewPolicyKey: event.target.value })}
                  >
                    {REVIEW_POLICY_KEYS.map((policyKey) => (
                      <option key={policyKey} value={policyKey}>
                        {REVIEW_POLICY_LABELS[policyKey]}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1">
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <span>Reviewer role</span>
                    <HintIcon text="Preferred role to auto-assign as reviewer. Leave blank to fall back to requestor or manager resolution." />
                  </div>
                  <input
                    className="w-full rounded-md border border-border bg-transparent px-2.5 py-1.5 text-sm outline-none"
                    value={draft.reviewerRole}
                    list={`reviewer-role-suggestions-${draft.id}`}
                    placeholder="pm"
                    onChange={(event) => updateDraft(draft.id, { reviewerRole: event.target.value })}
                  />
                  <datalist id={`reviewer-role-suggestions-${draft.id}`}>
                    {AGENT_ROLES.map((role) => (
                      <option key={role} value={role}>
                        {AGENT_ROLE_LABELS[role]}
                      </option>
                    ))}
                  </datalist>
                </div>

                <div className="flex gap-2">
                  <Button
                    size="sm"
                    type="button"
                    variant="outline"
                    onClick={() => removeDraft(draft)}
                  >
                    {canRemove ? <Trash2 className="h-3.5 w-3.5" /> : <RotateCcw className="h-3.5 w-3.5" />}
                    <span className="ml-1">{canRemove ? "Remove" : "Reset"}</span>
                  </Button>
                </div>
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                {draft.roleKey ? (
                  <span className="rounded-full border border-border/70 bg-muted/30 px-2 py-0.5">
                    {isPresetRole(draft.roleKey) ? "Known bundle" : "Custom bundle"}
                  </span>
                ) : null}
                {defaultRule ? (
                  <span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-emerald-700 dark:text-emerald-300">
                    Recommended default
                  </span>
                ) : null}
                {draft.roleKey && defaultRule ? (
                  <span>
                    Default: {REVIEW_POLICY_LABELS[defaultRule.reviewPolicyKey as keyof typeof REVIEW_POLICY_LABELS]} via {defaultRule.reviewerRole ?? "auto reviewer"}
                  </span>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap gap-2">
        {missingPresetRoles.map((roleKey) => (
          <Button
            key={roleKey}
            type="button"
            size="sm"
            variant="outline"
            onClick={() => addPresetRole(roleKey)}
          >
            <Plus className="mr-1 h-3.5 w-3.5" />
            {roleBundleLabel(roleKey)}
          </Button>
        ))}
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={addCustomRole}
        >
          <Plus className="mr-1 h-3.5 w-3.5" />
          Custom rule
        </Button>
      </div>

      {error ? (
        <div className="text-xs text-destructive">{error}</div>
      ) : (
        <div className="text-xs text-muted-foreground">
          Use preset bundles for standard Paperclip roles, and add custom keys only if your company extends the role model.
        </div>
      )}
    </div>
  );
}
