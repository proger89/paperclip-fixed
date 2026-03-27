/**
 * @fileoverview Plugin Manager page — admin UI for discovering,
 * installing, enabling/disabling, and uninstalling plugins.
 *
 * @see PLUGIN_SPEC.md §9 — Plugin Marketplace / Manager
 */
import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { LocalizedText, PluginRecord } from "@paperclipai/shared";
import { Link } from "@/lib/router";
import { AlertTriangle, FlaskConical, Plus, Power, Puzzle, Settings, Trash } from "lucide-react";
import { useCompany } from "@/context/CompanyContext";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { pluginsApi } from "@/api/plugins";
import { queryKeys } from "@/lib/queryKeys";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useI18n } from "@/context/I18nContext";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useToast } from "@/context/ToastContext";
import { cn } from "@/lib/utils";
import { resolveUiText } from "@/lib/localized";
import { getPluginCompanyPagePath, getPluginPageLinkLabel } from "@/lib/plugin-pages";

function firstNonEmptyLine(value: string | null | undefined): string | null {
  if (!value) return null;
  const line = value
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .find(Boolean);
  return line ?? null;
}

function getPluginErrorSummary(plugin: PluginRecord, fallback: string): string {
  return firstNonEmptyLine(plugin.lastError) ?? fallback;
}

function resolvePluginCatalogText(
  plugin: Pick<PluginRecord, "packageName" | "manifestJson">,
  examplesByPackageName: Map<string, { displayName: LocalizedText; description: LocalizedText }>,
  field: "displayName" | "description",
): string {
  const example = examplesByPackageName.get(plugin.packageName);
  const catalogValue = example?.[field];
  if (catalogValue) {
    return resolveUiText(catalogValue);
  }
  return resolveUiText(plugin.manifestJson[field]);
}

/**
 * PluginManager page component.
 *
 * Provides a management UI for the Paperclip plugin system:
 * - Lists all installed plugins with their status, version, and category badges.
 * - Allows installing new plugins by npm package name.
 * - Provides per-plugin actions: enable, disable, navigate to settings.
 * - Uninstall with a two-step confirmation dialog to prevent accidental removal.
 *
 * Data flow:
 * - Reads from `GET /api/plugins` via `pluginsApi.list()`.
 * - Mutations (install / uninstall / enable / disable) invalidate
 *   `queryKeys.plugins.all` so the list refreshes automatically.
 *
 * @see PluginSettings — linked from the Settings icon on each plugin row.
 * @see doc/plugins/PLUGIN_SPEC.md §3 — Plugin Lifecycle for status semantics.
 */
export function PluginManager() {
  const showDevPlugins = false;
  const { selectedCompany } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const queryClient = useQueryClient();
  const { pushToast } = useToast();
  const { t, translateText } = useI18n();

  const [installPackage, setInstallPackage] = useState("");
  const [installDialogOpen, setInstallDialogOpen] = useState(false);
  const [uninstallPluginId, setUninstallPluginId] = useState<string | null>(null);
  const [uninstallPluginName, setUninstallPluginName] = useState<string>("");
  const [errorDetailsPlugin, setErrorDetailsPlugin] = useState<PluginRecord | null>(null);

  useEffect(() => {
    setBreadcrumbs([
      { label: selectedCompany?.name ?? "Company", href: "/dashboard" },
      { label: "Settings", href: "/instance/settings/heartbeats" },
      { label: "Plugins" },
    ]);
  }, [selectedCompany?.name, setBreadcrumbs]);

  const { data: plugins, isLoading, error } = useQuery({
    queryKey: queryKeys.plugins.all,
    queryFn: () => pluginsApi.list(),
  });

  const examplesQuery = useQuery({
    queryKey: [...queryKeys.plugins.examples, "catalog"],
    queryFn: () => pluginsApi.listExamples({ includeDevOnly: true }),
  });

  const invalidatePluginQueries = () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.plugins.all });
    queryClient.invalidateQueries({ queryKey: queryKeys.plugins.examples });
    queryClient.invalidateQueries({ queryKey: queryKeys.plugins.uiContributions });
  };

  const installMutation = useMutation({
    mutationFn: (params: { packageName: string; version?: string; isLocalPath?: boolean }) =>
      pluginsApi.install(params),
    onSuccess: () => {
      invalidatePluginQueries();
      setInstallDialogOpen(false);
      setInstallPackage("");
      pushToast({ title: translateText("Plugin installed successfully"), tone: "success" });
    },
    onError: (err: Error) => {
      pushToast({ title: translateText("Failed to install plugin"), body: err.message, tone: "error" });
    },
  });

  const uninstallMutation = useMutation({
    mutationFn: (pluginId: string) => pluginsApi.uninstall(pluginId),
    onSuccess: () => {
      invalidatePluginQueries();
      pushToast({ title: translateText("Plugin uninstalled successfully"), tone: "success" });
    },
    onError: (err: Error) => {
      pushToast({ title: translateText("Failed to uninstall plugin"), body: err.message, tone: "error" });
    },
  });

  const enableMutation = useMutation({
    mutationFn: (pluginId: string) => pluginsApi.enable(pluginId),
    onSuccess: () => {
      invalidatePluginQueries();
      pushToast({ title: translateText("Plugin enabled"), tone: "success" });
    },
    onError: (err: Error) => {
      pushToast({ title: translateText("Failed to enable plugin"), body: err.message, tone: "error" });
    },
  });

  const disableMutation = useMutation({
    mutationFn: (pluginId: string) => pluginsApi.disable(pluginId),
    onSuccess: () => {
      invalidatePluginQueries();
      pushToast({ title: translateText("Plugin disabled"), tone: "info" });
    },
    onError: (err: Error) => {
      pushToast({ title: translateText("Failed to disable plugin"), body: err.message, tone: "error" });
    },
  });

  const allInstalledPlugins = plugins ?? [];
  const examples = examplesQuery.data ?? [];
  const examplesByPackageName = useMemo(
    () =>
      new Map(
        examples.map((example) => [
          example.packageName,
          {
            displayName: example.displayName,
            description: example.description,
          },
        ]),
      ),
    [examples],
  );
  const visibleExamples = examples.filter((example) => showDevPlugins || !example.devOnly);
  const hiddenExamplePackageNames = new Set(
    examples.filter((example) => example.devOnly && !showDevPlugins).map((example) => example.packageName),
  );
  const installedPlugins = allInstalledPlugins.filter((plugin) => !hiddenExamplePackageNames.has(plugin.packageName));
  const installedByPackageName = new Map(allInstalledPlugins.map((plugin) => [plugin.packageName, plugin]));
  const examplePackageNames = new Set(
    examples.filter((example) => example.tag === "example").map((example) => example.packageName),
  );
  const errorSummaryByPluginId = useMemo(
    () =>
      new Map(
        installedPlugins.map((plugin) => [
          plugin.id,
          getPluginErrorSummary(
            plugin,
            translateText("Plugin entered an error state without a stored error message."),
          ),
        ])
      ),
    [installedPlugins, translateText]
  );

  if (isLoading) return <div className="p-4 text-sm text-muted-foreground">{t("common.loadingPlugins")}</div>;
  if (error) return <div className="p-4 text-sm text-destructive">{t("common.failedToLoadPlugins")}</div>;

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Puzzle className="h-6 w-6 text-muted-foreground" />
          <h1 className="text-xl font-semibold">{t("plugin.manager.title")}</h1>
        </div>
        
        <Dialog open={installDialogOpen} onOpenChange={setInstallDialogOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="gap-2">
              <Plus className="h-4 w-4" />
              {t("plugin.manager.installPlugin")}
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t("plugin.manager.installDialogTitle")}</DialogTitle>
              <DialogDescription>
                {t("plugin.manager.installDialogDescription")}
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor="packageName">{t("plugin.manager.packageName")}</Label>
                <Input
                  id="packageName"
                  placeholder="@paperclipai/plugin-example"
                  value={installPackage}
                  onChange={(e) => setInstallPackage(e.target.value)}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setInstallDialogOpen(false)}>{t("plugin.manager.cancel")}</Button>
              <Button
                onClick={() => installMutation.mutate({ packageName: installPackage })}
                disabled={!installPackage || installMutation.isPending}
              >
                {installMutation.isPending ? t("plugin.manager.installing") : translateText("Install")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
          <div className="space-y-1 text-sm">
            <p className="font-medium text-foreground">{t("plugin.manager.pluginsAreAlpha")}</p>
            <p className="text-muted-foreground">
              {t("plugin.manager.pluginsAlphaDescription")}
            </p>
          </div>
        </div>
      </div>

      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <FlaskConical className="h-5 w-5 text-muted-foreground" />
          <h2 className="text-base font-semibold">{t("plugin.manager.bundledPlugins")}</h2>
          <Badge variant="outline">{t("plugin.manager.localInstall")}</Badge>
        </div>

        {examplesQuery.isLoading ? (
          <div className="text-sm text-muted-foreground">{t("common.loadingBundledPlugins")}</div>
        ) : examplesQuery.error ? (
          <div className="text-sm text-destructive">{t("common.failedToLoadBundledPlugins")}</div>
        ) : visibleExamples.length === 0 ? (
          <div className="rounded-md border border-dashed px-4 py-3 text-sm text-muted-foreground">
            {t("plugin.manager.noBundledPlugins")}
          </div>
        ) : (
          <ul className="divide-y rounded-md border bg-card">
            {visibleExamples.map((example) => {
              const installedPlugin = installedByPackageName.get(example.packageName);
              const installedPluginPagePath = getPluginCompanyPagePath(
                installedPlugin ?? null,
                selectedCompany?.issuePrefix ?? null,
              );
              const installPending =
                installMutation.isPending &&
                installMutation.variables?.isLocalPath &&
                installMutation.variables.packageName === example.localPath;

              return (
                <li key={example.packageName}>
                  <div className="flex items-center gap-4 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{resolveUiText(example.displayName)}</span>
                        <Badge variant="outline">{translateText(example.tag === "bundled" ? "Bundled" : "Example")}</Badge>
                        {example.categories.map((category) => (
                          <Badge key={`${example.packageName}:${category}`} variant="secondary" className="capitalize">
                            {translateText(category)}
                          </Badge>
                        ))}
                        {installedPlugin ? (
                          <Badge
                            variant={installedPlugin.status === "ready" ? "default" : "secondary"}
                            className={installedPlugin.status === "ready" ? "bg-green-600 hover:bg-green-700" : ""}
                          >
                            {translateText(installedPlugin.status)}
                          </Badge>
                        ) : (
                          <Badge variant="secondary">{translateText("Not installed")}</Badge>
                        )}
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground">{resolveUiText(example.description)}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{example.packageName}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {installedPlugin ? (
                        <>
                          {installedPlugin.status === "ready" && installedPluginPagePath ? (
                            <Button variant="outline" size="sm" asChild>
                              <Link to={installedPluginPagePath}>
                                {getPluginPageLinkLabel(installedPlugin)}
                              </Link>
                            </Button>
                          ) : null}
                          {installedPlugin.status !== "ready" && (
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={enableMutation.isPending}
                              onClick={() => enableMutation.mutate(installedPlugin.id)}
                            >
                              {translateText("Enable")}
                            </Button>
                          )}
                          <Button variant="outline" size="sm" asChild>
                            <Link to={`/instance/settings/plugins/${installedPlugin.id}`}>
                              {installedPlugin.status === "ready" ? t("plugin.manager.openSettings") : t("plugin.manager.review")}
                            </Link>
                          </Button>
                        </>
                      ) : (
                        <Button
                          size="sm"
                          disabled={installPending || installMutation.isPending}
                          onClick={() =>
                            installMutation.mutate({
                              packageName: example.localPath,
                              isLocalPath: true,
                            })
                          }
                        >
                          {installPending
                            ? t("plugin.manager.installing")
                            : example.tag === "bundled"
                              ? t("plugin.manager.installBundled")
                              : t("plugin.manager.installExample")}
                        </Button>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <Puzzle className="h-5 w-5 text-muted-foreground" />
          <h2 className="text-base font-semibold">{t("plugin.manager.installedPlugins")}</h2>
        </div>

        {!installedPlugins.length ? (
          <Card className="bg-muted/30">
            <CardContent className="flex flex-col items-center justify-center py-10">
              <Puzzle className="h-10 w-10 text-muted-foreground mb-4" />
              <p className="text-sm font-medium">{t("plugin.manager.noPluginsInstalled")}</p>
              <p className="text-xs text-muted-foreground mt-1">
                {t("plugin.manager.noPluginsDescription")}
              </p>
            </CardContent>
          </Card>
        ) : (
          <ul className="divide-y rounded-md border bg-card">
            {installedPlugins.map((plugin) => (
              <li key={plugin.id}>
                <div className="flex items-start gap-4 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        to={`/instance/settings/plugins/${plugin.id}`}
                        className="font-medium hover:underline truncate block"
                        title={resolvePluginCatalogText(plugin, examplesByPackageName, "displayName") || plugin.packageName}
                      >
                        {resolvePluginCatalogText(plugin, examplesByPackageName, "displayName") || plugin.packageName}
                      </Link>
                      {examplePackageNames.has(plugin.packageName) && (
                        <Badge variant="outline">{translateText("Example")}</Badge>
                      )}
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground mt-0.5 truncate" title={plugin.packageName}>
                        {plugin.packageName} · v{plugin.manifestJson.version ?? plugin.version}
                      </p>
                    </div>
                    <p
                      className="text-sm text-muted-foreground truncate mt-0.5"
                      title={resolvePluginCatalogText(plugin, examplesByPackageName, "description") || undefined}
                    >
                      {resolvePluginCatalogText(plugin, examplesByPackageName, "description") || t("plugin.manager.noDescription")}
                    </p>
                    {plugin.status === "error" && (
                      <div className="mt-3 rounded-md border border-red-500/25 bg-red-500/[0.06] px-3 py-2">
                        <div className="flex flex-wrap items-start gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 text-sm font-medium text-red-700 dark:text-red-300">
                              <AlertTriangle className="h-4 w-4 shrink-0" />
                              <span>{t("plugin.manager.pluginError")}</span>
                            </div>
                            <p
                              className="mt-1 text-sm text-red-700/90 dark:text-red-200/90 break-words"
                              title={plugin.lastError ?? undefined}
                            >
                              {errorSummaryByPluginId.get(plugin.id)}
                            </p>
                          </div>
                          <Button
                            variant="outline"
                            size="sm"
                            className="border-red-500/30 bg-background/60 text-red-700 hover:bg-red-500/10 hover:text-red-800 dark:text-red-200 dark:hover:text-red-100"
                            onClick={() => setErrorDetailsPlugin(plugin)}
                          >
                            {t("plugin.manager.viewFullError")}
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="flex shrink-0 self-center">
                    <div className="flex flex-col items-end gap-2">
                      <div className="flex items-center gap-2">
                        <Badge
                          variant={
                            plugin.status === "ready"
                              ? "default"
                              : plugin.status === "error"
                                ? "destructive"
                              : "secondary"
                          }
                          className={cn(
                            "shrink-0",
                            plugin.status === "ready" ? "bg-green-600 hover:bg-green-700" : ""
                          )}
                        >
                          {translateText(plugin.status)}
                        </Badge>
                        <Button
                          variant="outline"
                          size="icon-sm"
                          className="h-8 w-8"
                          title={translateText(plugin.status === "ready" ? "Disable" : "Enable")}
                          onClick={() => {
                            if (plugin.status === "ready") {
                              disableMutation.mutate(plugin.id);
                            } else {
                              enableMutation.mutate(plugin.id);
                            }
                          }}
                          disabled={enableMutation.isPending || disableMutation.isPending}
                        >
                          <Power className={cn("h-4 w-4", plugin.status === "ready" ? "text-green-600" : "")} />
                        </Button>
                        <Button
                          variant="outline"
                          size="icon-sm"
                          className="h-8 w-8 text-destructive hover:text-destructive"
                          title={translateText("Uninstall")}
                          onClick={() => {
                            setUninstallPluginId(plugin.id);
                            setUninstallPluginName(
                              resolvePluginCatalogText(plugin, examplesByPackageName, "displayName") || plugin.packageName,
                            );
                          }}
                          disabled={uninstallMutation.isPending}
                        >
                          <Trash className="h-4 w-4" />
                        </Button>
                      </div>
                      <div className="mt-2 flex flex-wrap justify-end gap-2">
                        {plugin.status === "ready" && getPluginCompanyPagePath(plugin, selectedCompany?.issuePrefix ?? null) ? (
                          <Button variant="outline" size="sm" className="h-8" asChild>
                            <Link to={getPluginCompanyPagePath(plugin, selectedCompany?.issuePrefix ?? null)!}>
                              {getPluginPageLinkLabel(plugin)}
                            </Link>
                          </Button>
                        ) : null}
                        <Button variant="outline" size="sm" className="h-8" asChild>
                          <Link to={`/instance/settings/plugins/${plugin.id}`}>
                            <Settings className="h-4 w-4" />
                            {translateText("Configure")}
                          </Link>
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Dialog
        open={uninstallPluginId !== null}
        onOpenChange={(open) => { if (!open) setUninstallPluginId(null); }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{translateText("Uninstall Plugin")}</DialogTitle>
            <DialogDescription>
              {t("plugin.manager.uninstallDescription", { name: uninstallPluginName })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUninstallPluginId(null)}>{t("plugin.manager.cancel")}</Button>
            <Button
              variant="destructive"
              disabled={uninstallMutation.isPending}
              onClick={() => {
                if (uninstallPluginId) {
                  uninstallMutation.mutate(uninstallPluginId, {
                    onSettled: () => setUninstallPluginId(null),
                  });
                }
              }}
            >
              {uninstallMutation.isPending ? translateText("Uninstalling...") : translateText("Uninstall")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={errorDetailsPlugin !== null}
        onOpenChange={(open) => { if (!open) setErrorDetailsPlugin(null); }}
      >
        <DialogContent className="sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle>{translateText("Error Details")}</DialogTitle>
              <DialogDescription>
                {t("plugin.manager.errorDetailsDescription", {
                  name:
                    (errorDetailsPlugin
                      ? resolvePluginCatalogText(errorDetailsPlugin, examplesByPackageName, "displayName")
                      : null) ||
                    errorDetailsPlugin?.packageName ||
                    translateText("Plugin"),
                })}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-md border border-red-500/25 bg-red-500/[0.06] px-4 py-3">
              <div className="flex items-start gap-3">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-700 dark:text-red-300" />
                <div className="space-y-1 text-sm">
                  <p className="font-medium text-red-700 dark:text-red-300">
                    {translateText("What errored")}
                  </p>
                  <p className="text-red-700/90 dark:text-red-200/90 break-words">
                    {errorDetailsPlugin
                      ? getPluginErrorSummary(
                        errorDetailsPlugin,
                        translateText("Plugin entered an error state without a stored error message."),
                      )
                      : translateText("No error summary available.")}
                  </p>
                </div>
              </div>
            </div>
            <div className="space-y-2">
              <p className="text-sm font-medium">{translateText("Full error output")}</p>
              <pre className="max-h-[50vh] overflow-auto rounded-md border bg-muted/40 p-3 text-xs leading-5 whitespace-pre-wrap break-words">
                {errorDetailsPlugin?.lastError ?? translateText("No stored error message.")}
              </pre>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setErrorDetailsPlugin(null)}>
              {translateText("Close")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
