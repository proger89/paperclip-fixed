import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { SlidersHorizontal } from "lucide-react";
import type { PatchInstanceGeneralSettings, UiLanguage } from "@paperclipai/shared";
import { instanceSettingsApi } from "@/api/instanceSettings";
import { useI18n } from "@/context/I18nContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { queryKeys } from "../lib/queryKeys";
import { cn } from "../lib/utils";

export function InstanceGeneralSettings() {
  const { setBreadcrumbs } = useBreadcrumbs();
  const queryClient = useQueryClient();
  const { t, translateText, setLocale } = useI18n();
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    setBreadcrumbs([
      { label: "Instance Settings" },
      { label: "General" },
    ]);
  }, [setBreadcrumbs]);

  const generalQuery = useQuery({
    queryKey: queryKeys.instance.generalSettings,
    queryFn: () => instanceSettingsApi.getGeneral(),
  });

  const generalMutation = useMutation({
    mutationFn: async (patch: PatchInstanceGeneralSettings) =>
      instanceSettingsApi.updateGeneral(patch),
    onSuccess: async (data) => {
      setActionError(null);
      setLocale(data.effectiveUiLanguage, { persist: data.uiLanguage !== null });
      await queryClient.invalidateQueries({ queryKey: queryKeys.instance.generalSettings });
    },
    onError: (error) => {
      setActionError(error instanceof Error ? error.message : t("common.failedToUpdateGeneralSettings"));
    },
  });

  if (generalQuery.isLoading) {
    return <div className="text-sm text-muted-foreground">{t("common.loadingGeneralSettings")}</div>;
  }

  if (generalQuery.error) {
    return (
      <div className="text-sm text-destructive">
        {generalQuery.error instanceof Error
          ? generalQuery.error.message
          : t("common.failedToLoadGeneralSettings")}
      </div>
    );
  }

  const censorUsernameInLogs = generalQuery.data?.censorUsernameInLogs === true;
  const languageValue = generalQuery.data?.uiLanguage ?? "__browser__";

  return (
    <div className="max-w-4xl space-y-6">
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <SlidersHorizontal className="h-5 w-5 text-muted-foreground" />
          <h1 className="text-lg font-semibold">{translateText("General")}</h1>
        </div>
        <p className="text-sm text-muted-foreground">{t("instance.general.description")}</p>
      </div>

      {actionError && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {actionError}
        </div>
      )}

      <section className="rounded-xl border border-border bg-card p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1.5">
            <h2 className="text-sm font-semibold">{t("instance.general.censorTitle")}</h2>
            <p className="max-w-2xl text-sm text-muted-foreground">{t("instance.general.censorDescription")}</p>
          </div>
          <button
            type="button"
            aria-label={t("instance.general.toggleCensor")}
            disabled={generalMutation.isPending}
            className={cn(
              "relative inline-flex h-5 w-9 items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-60",
              censorUsernameInLogs ? "bg-green-600" : "bg-muted",
            )}
            onClick={() => generalMutation.mutate({ censorUsernameInLogs: !censorUsernameInLogs })}
          >
            <span
              className={cn(
                "inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform",
                censorUsernameInLogs ? "translate-x-4.5" : "translate-x-0.5",
              )}
            />
          </button>
        </div>
      </section>

      <section className="rounded-xl border border-border bg-card p-5">
        <div className="grid gap-3">
          <div className="space-y-1.5">
            <h2 className="text-sm font-semibold">{t("instance.general.uiLanguageTitle")}</h2>
            <p className="max-w-2xl text-sm text-muted-foreground">{t("instance.general.uiLanguageDescription")}</p>
          </div>
          <div className="max-w-sm">
            <select
              value={languageValue}
              disabled={generalMutation.isPending}
              onChange={(event) => {
                const nextValue = event.target.value === "__browser__" ? null : event.target.value as UiLanguage;
                generalMutation.mutate({ uiLanguage: nextValue });
              }}
              className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
              aria-label={t("instance.general.uiLanguageTitle")}
            >
              <option value="__browser__">{t("instance.general.useBrowserLanguage")}</option>
              <option value="en">{t("common.language.english")}</option>
              <option value="ru">Русский</option>
            </select>
          </div>
        </div>
      </section>
    </div>
  );
}
