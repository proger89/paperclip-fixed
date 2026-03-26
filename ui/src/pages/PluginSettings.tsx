import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Puzzle, ArrowLeft, ShieldAlert, ActivitySquare, CheckCircle, XCircle, Loader2, Clock, Cpu, Webhook, CalendarClock, AlertTriangle } from "lucide-react";
import { useCompany } from "@/context/CompanyContext";
import { useI18n } from "@/context/I18nContext";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { Link, Navigate, useParams } from "@/lib/router";
import {
  PluginSlotMount,
  ensurePluginContributionLoaded,
  type ResolvedPluginSlot,
} from "@/plugins/slots";
import { pluginsApi, type PluginUiContribution } from "@/api/plugins";
import { queryKeys } from "@/lib/queryKeys";
import { getPluginCompanyPagePath, getPluginPageLinkLabel } from "@/lib/plugin-pages";
import { resolveUiText } from "@/lib/localized";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { PageTabBar } from "@/components/PageTabBar";
import {
  JsonSchemaForm,
  validateJsonSchemaForm,
  getDefaultValues,
  type JsonSchemaNode,
} from "@/components/JsonSchemaForm";
import { formatDateTime, relativeTime } from "@/lib/utils";

/**
 * PluginSettings page component.
 *
 * Detailed settings and diagnostics page for a single installed plugin.
 * Navigated to from {@link PluginManager} via the Settings gear icon.
 *
 * Displays:
 * - Plugin identity: display name, id, version, description, categories.
 * - Manifest-declared capabilities (what data and features the plugin can access).
 * - Health check results (only for `ready` plugins; polled every 30 seconds).
 * - Runtime dashboard: worker status/uptime, recent job runs, webhook deliveries.
 * - Auto-generated config form from `instanceConfigSchema` (when no custom settings page).
 * - Plugin-contributed settings UI via `<PluginSlotOutlet type="settingsPage" />`.
 *
 * Data flow:
 * - `GET /api/plugins/:pluginId` — plugin record (refreshes on mount).
 * - `GET /api/plugins/:pluginId/health` — health diagnostics (polling).
 *   Only fetched when `plugin.status === "ready"`.
 * - `GET /api/plugins/:pluginId/dashboard` — aggregated runtime dashboard data (polling).
 * - `GET /api/plugins/:pluginId/config` — current config values.
 * - `POST /api/plugins/:pluginId/config` — save config values.
 * - `POST /api/plugins/:pluginId/config/test` — test configuration.
 *
 * URL params:
 * - `companyPrefix` — the company slug (for breadcrumb links).
 * - `pluginId` — UUID of the plugin to display.
 *
 * @see PluginManager — parent list page.
 * @see doc/plugins/PLUGIN_SPEC.md §13 — Plugin Health Checks.
 * @see doc/plugins/PLUGIN_SPEC.md §19.8 — Plugin Settings UI.
 */
export function PluginSettings() {
  const { selectedCompany, selectedCompanyId } = useCompany();
  const { t, translateText } = useI18n();
  const { setBreadcrumbs } = useBreadcrumbs();
  const { companyPrefix, pluginId } = useParams<{ companyPrefix?: string; pluginId: string }>();
  const [activeTab, setActiveTab] = useState<"configuration" | "status">("configuration");

  const { data: plugin, isLoading: pluginLoading } = useQuery({
    queryKey: queryKeys.plugins.detail(pluginId!),
    queryFn: () => pluginsApi.get(pluginId!),
    enabled: !!pluginId,
  });

  const { data: healthData, isLoading: healthLoading } = useQuery({
    queryKey: queryKeys.plugins.health(pluginId!),
    queryFn: () => pluginsApi.health(pluginId!),
    enabled: !!pluginId && plugin?.status === "ready",
    refetchInterval: 30000,
  });

  const { data: dashboardData } = useQuery({
    queryKey: queryKeys.plugins.dashboard(pluginId!),
    queryFn: () => pluginsApi.dashboard(pluginId!),
    enabled: !!pluginId,
    refetchInterval: 30000,
  });

  const { data: recentLogs } = useQuery({
    queryKey: queryKeys.plugins.logs(pluginId!),
    queryFn: () => pluginsApi.logs(pluginId!, { limit: 50 }),
    enabled: !!pluginId && plugin?.status === "ready",
    refetchInterval: 30000,
  });

  // Fetch existing config for the plugin
  const configSchema = plugin?.manifestJson?.instanceConfigSchema as JsonSchemaNode | undefined;
  const hasConfigSchema = configSchema && configSchema.properties && Object.keys(configSchema.properties).length > 0;

  const { data: configData, isLoading: configLoading } = useQuery({
    queryKey: queryKeys.plugins.config(pluginId!),
    queryFn: () => pluginsApi.getConfig(pluginId!),
    enabled: !!pluginId && !!hasConfigSchema,
  });

  const pluginDeclaresCustomSettingsPage = Boolean(
    plugin?.manifestJson?.ui?.slots?.some((slot) => slot.type === "settingsPage"),
  );

  const {
    data: uiContributions,
    isLoading: uiContributionsLoading,
    error: uiContributionsError,
  } = useQuery({
    queryKey: queryKeys.plugins.uiContributions,
    queryFn: () => pluginsApi.listUiContributions(),
    enabled: !!selectedCompanyId && pluginDeclaresCustomSettingsPage,
  });

  const matchingUiContributions = useMemo(() => {
    if (!plugin || !uiContributions) return [] as PluginUiContribution[];
    const identifiers = new Set<string>([
      plugin.id,
      plugin.pluginKey,
      pluginId ?? "",
    ]);
    return uiContributions.filter((contribution) => (
      identifiers.has(contribution.pluginId)
      || identifiers.has(contribution.pluginKey)
    ));
  }, [plugin, pluginId, uiContributions]);

  const pluginSlots = useMemo(() => {
    const rows: ResolvedPluginSlot[] = [];
    for (const contribution of matchingUiContributions) {
      for (const slot of contribution.slots) {
        if (slot.type !== "settingsPage") continue;
        rows.push({
          ...slot,
          pluginId: contribution.pluginId,
          pluginKey: contribution.pluginKey,
          pluginDisplayName: contribution.displayName,
          pluginVersion: contribution.version,
        });
      }
    }
    rows.sort((left, right) => {
      const leftOrder = left.order ?? Number.MAX_SAFE_INTEGER;
      const rightOrder = right.order ?? Number.MAX_SAFE_INTEGER;
      if (leftOrder !== rightOrder) return leftOrder - rightOrder;
      return resolveUiText(left.displayName).localeCompare(resolveUiText(right.displayName));
    });
    return rows;
  }, [matchingUiContributions]);

  const [pluginSlotsLoading, setPluginSlotsLoading] = useState(false);
  const [pluginSlotsError, setPluginSlotsError] = useState<string | null>(null);

  useEffect(() => {
    if (!pluginDeclaresCustomSettingsPage) {
      setPluginSlotsLoading(false);
      setPluginSlotsError(null);
      return;
    }
    if (uiContributionsLoading) {
      setPluginSlotsLoading(true);
      setPluginSlotsError(null);
      return;
    }
    if (uiContributionsError) {
      setPluginSlotsLoading(false);
      setPluginSlotsError(uiContributionsError instanceof Error ? uiContributionsError.message : String(uiContributionsError));
      return;
    }
    if (matchingUiContributions.length === 0) {
      setPluginSlotsLoading(false);
      setPluginSlotsError(null);
      return;
    }

    let cancelled = false;
    setPluginSlotsLoading(true);
    setPluginSlotsError(null);
    void Promise.all(matchingUiContributions.map((contribution) => ensurePluginContributionLoaded(contribution)))
      .then(() => {
        if (cancelled) return;
        setPluginSlotsLoading(false);
      })
      .catch((error) => {
        if (cancelled) return;
        setPluginSlotsLoading(false);
        setPluginSlotsError(error instanceof Error ? error.message : String(error));
      });

    return () => {
      cancelled = true;
    };
  }, [
    matchingUiContributions,
    pluginDeclaresCustomSettingsPage,
    uiContributionsError,
    uiContributionsLoading,
  ]);

  // If the plugin declares a custom settingsPage slot, wait for that slot to
  // resolve instead of falling back to the generic schema form. Some plugins
  // intentionally provide richer settings UIs than their instanceConfigSchema.
  const hasCustomSettingsPage = pluginDeclaresCustomSettingsPage && pluginSlots.length > 0;

  useEffect(() => {
    setBreadcrumbs([
      { label: selectedCompany?.name ?? "Company", href: "/dashboard" },
      { label: "Settings", href: "/instance/settings/heartbeats" },
      { label: "Plugins", href: "/instance/settings/plugins" },
      { label: resolveUiText(plugin?.manifestJson?.displayName) || plugin?.packageName || "Plugin Details" },
    ]);
  }, [selectedCompany?.name, setBreadcrumbs, companyPrefix, plugin]);

  useEffect(() => {
    setActiveTab("configuration");
  }, [pluginId]);

  if (pluginLoading) {
    return <div className="p-4 text-sm text-muted-foreground">{t("plugin.settings.loadingDetails")}</div>;
  }

  if (!plugin) {
    return <Navigate to="/instance/settings/plugins" replace />;
  }

  const displayStatus = plugin.status;
  const statusVariant =
    plugin.status === "ready"
      ? "default"
      : plugin.status === "error"
        ? "destructive"
        : "secondary";
  const pluginDescription = resolveUiText(plugin.manifestJson.description) || t("plugin.manager.noDescription");
  const pluginCapabilities = plugin.manifestJson.capabilities ?? [];
  const companyPluginPagePath = getPluginCompanyPagePath(plugin, selectedCompany?.issuePrefix ?? companyPrefix ?? null);

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <Link to="/instance/settings/plugins">
            <Button variant="outline" size="icon" className="h-8 w-8">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div className="flex items-center gap-2">
            <Puzzle className="h-6 w-6 text-muted-foreground" />
            <h1 className="text-xl font-semibold">{resolveUiText(plugin.manifestJson.displayName) || plugin.packageName}</h1>
            <Badge variant={statusVariant} className="ml-2">
              {translateText(displayStatus)}
            </Badge>
            <Badge variant="outline" className="ml-1">
              v{plugin.manifestJson.version ?? plugin.version}
            </Badge>
          </div>
        </div>
        {plugin.status === "ready" && companyPluginPagePath ? (
          <Button variant="outline" size="sm" asChild>
            <Link to={companyPluginPagePath}>{getPluginPageLinkLabel(plugin)}</Link>
          </Button>
        ) : null}
      </div>

      <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as "configuration" | "status")} className="space-y-6">
        <PageTabBar
          align="start"
          items={[
            { value: "configuration", label: t("plugin.settings.configuration") },
            { value: "status", label: t("plugin.settings.status") },
          ]}
          value={activeTab}
          onValueChange={(value) => setActiveTab(value as "configuration" | "status")}
        />

        <TabsContent value="configuration" className="space-y-6">
          <div className="space-y-8">
            <section className="space-y-5">
              <h2 className="text-base font-semibold">{t("plugin.settings.about")}</h2>
              <div className="grid gap-8 lg:grid-cols-[minmax(0,1.4fr)_minmax(220px,0.8fr)]">
                <div className="space-y-2">
                  <h3 className="text-sm font-medium text-muted-foreground">{t("plugin.settings.description")}</h3>
                  <p className="text-sm leading-6 text-foreground/90">{pluginDescription}</p>
                </div>
                <div className="space-y-4 text-sm">
                  <div className="space-y-1.5">
                    <h3 className="font-medium text-muted-foreground">{t("plugin.settings.author")}</h3>
                    <p className="text-foreground">{plugin.manifestJson.author}</p>
                  </div>
                  <div className="space-y-2">
                    <h3 className="font-medium text-muted-foreground">{t("plugin.settings.categories")}</h3>
                    <div className="flex flex-wrap gap-2">
                      {plugin.categories.length > 0 ? (
                        plugin.categories.map((category) => (
                          <Badge key={category} variant="outline" className="capitalize">
                            {category}
                          </Badge>
                        ))
                      ) : (
                        <span className="text-foreground">{translateText("None")}</span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </section>

            <Separator />

            <section className="space-y-4">
              <div className="space-y-1">
                <h2 className="text-base font-semibold">{t("plugin.settings.settings")}</h2>
              </div>
              {pluginDeclaresCustomSettingsPage ? (
                pluginSlotsLoading ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {t("plugin.settings.loadingUi")}
                  </div>
                ) : pluginSlotsError ? (
                  <p className="text-sm text-destructive">
                    {t("plugin.settings.uiUnavailable", { error: pluginSlotsError })}
                  </p>
                ) : hasCustomSettingsPage ? (
                  <div className="space-y-3">
                    {pluginSlots.map((slot) => (
                      <PluginSlotMount
                        key={`${slot.pluginKey}:${slot.id}`}
                        slot={slot}
                        context={{
                          companyId: selectedCompanyId,
                          companyPrefix: selectedCompany?.issuePrefix ?? companyPrefix ?? null,
                        }}
                        missingBehavior="placeholder"
                      />
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    {t("plugin.settings.customUiMissing")}
                  </p>
                )
              ) : hasConfigSchema ? (
                <div className="space-y-3">
                  <PluginConfigForm
                    pluginId={pluginId!}
                    schema={configSchema!}
                    initialValues={configData?.configJson}
                    isLoading={configLoading}
                    pluginStatus={plugin.status}
                    supportsConfigTest={(plugin as unknown as { supportsConfigTest?: boolean }).supportsConfigTest === true}
                  />
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {t("plugin.settings.noSettings")}
                </p>
              )}
            </section>
          </div>
        </TabsContent>

        <TabsContent value="status" className="space-y-6">
          <div className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_320px]">
            <div className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-1.5">
                    <Cpu className="h-4 w-4" />
                    {t("plugin.settings.runtimeDashboard")}
                  </CardTitle>
                  <CardDescription>
                    {t("plugin.settings.runtimeDescription")}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  {dashboardData ? (
                    <>
                      <div>
                        <h3 className="text-sm font-medium mb-3 flex items-center gap-1.5">
                          <Cpu className="h-3.5 w-3.5 text-muted-foreground" />
                          {translateText("Worker Process")}
                        </h3>
                        {dashboardData.worker ? (
                          <div className="grid grid-cols-2 gap-3 text-sm">
                            <div className="flex justify-between">
                              <span className="text-muted-foreground">{t("plugin.settings.status")}</span>
                              <Badge variant={dashboardData.worker.status === "running" ? "default" : "secondary"}>
                                {translateText(dashboardData.worker.status)}
                              </Badge>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-muted-foreground">{translateText("PID")}</span>
                              <span className="font-mono text-xs">{dashboardData.worker.pid ?? "—"}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-muted-foreground">{translateText("Uptime")}</span>
                              <span className="text-xs">{formatUptime(dashboardData.worker.uptime)}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-muted-foreground">{translateText("Pending RPCs")}</span>
                              <span className="text-xs">{dashboardData.worker.pendingRequests}</span>
                            </div>
                            {dashboardData.worker.totalCrashes > 0 && (
                              <>
                                <div className="flex justify-between col-span-2">
                                  <span className="text-muted-foreground flex items-center gap-1">
                                    <AlertTriangle className="h-3 w-3 text-amber-500" />
                                    {translateText("Crashes")}
                                  </span>
                                  <span className="text-xs">
                                    {t("plugin.settings.crashSummary", {
                                      consecutive: dashboardData.worker.consecutiveCrashes,
                                      total: dashboardData.worker.totalCrashes,
                                    })}
                                  </span>
                                </div>
                                {dashboardData.worker.lastCrashAt && (
                                  <div className="flex justify-between col-span-2">
                                    <span className="text-muted-foreground">{translateText("Last Crash")}</span>
                                    <span className="text-xs">{formatTimestamp(dashboardData.worker.lastCrashAt)}</span>
                                  </div>
                                )}
                              </>
                            )}
                          </div>
                        ) : (
                          <p className="text-sm text-muted-foreground italic">{translateText("No worker process registered.")}</p>
                        )}
                      </div>

                      <Separator />

                      <div>
                        <h3 className="text-sm font-medium mb-3 flex items-center gap-1.5">
                          <CalendarClock className="h-3.5 w-3.5 text-muted-foreground" />
                          {translateText("Recent Job Runs")}
                        </h3>
                        {dashboardData.recentJobRuns.length > 0 ? (
                          <div className="space-y-2">
                            {dashboardData.recentJobRuns.map((run) => (
                              <div
                                key={run.id}
                                className="flex items-center justify-between gap-2 rounded-md bg-muted/50 px-2 py-1.5 text-sm"
                              >
                                <div className="flex min-w-0 items-center gap-2">
                                  <JobStatusDot status={run.status} />
                                  <span className="truncate font-mono text-xs" title={run.jobKey ?? run.jobId}>
                                    {run.jobKey ?? run.jobId.slice(0, 8)}
                                  </span>
                                  <Badge variant="outline" className="px-1 py-0 text-[10px]">
                                    {run.trigger}
                                  </Badge>
                                </div>
                                <div className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                                  {run.durationMs != null ? <span>{formatDuration(run.durationMs)}</span> : null}
                                  <span title={run.createdAt}>{formatRelativeTime(run.createdAt)}</span>
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="text-sm text-muted-foreground italic">{translateText("No job runs recorded yet.")}</p>
                        )}
                      </div>

                      <Separator />

                      <div>
                        <h3 className="text-sm font-medium mb-3 flex items-center gap-1.5">
                          <Webhook className="h-3.5 w-3.5 text-muted-foreground" />
                          {translateText("Recent Webhook Deliveries")}
                        </h3>
                        {dashboardData.recentWebhookDeliveries.length > 0 ? (
                          <div className="space-y-2">
                            {dashboardData.recentWebhookDeliveries.map((delivery) => (
                              <div
                                key={delivery.id}
                                className="flex items-center justify-between gap-2 rounded-md bg-muted/50 px-2 py-1.5 text-sm"
                              >
                                <div className="flex min-w-0 items-center gap-2">
                                  <DeliveryStatusDot status={delivery.status} />
                                  <span className="truncate font-mono text-xs" title={delivery.webhookKey}>
                                    {delivery.webhookKey}
                                  </span>
                                </div>
                                <div className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                                  {delivery.durationMs != null ? <span>{formatDuration(delivery.durationMs)}</span> : null}
                                  <span title={delivery.createdAt}>{formatRelativeTime(delivery.createdAt)}</span>
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="text-sm text-muted-foreground italic">{translateText("No webhook deliveries recorded yet.")}</p>
                        )}
                      </div>

                      <div className="flex items-center gap-1.5 border-t border-border/50 pt-2 text-xs text-muted-foreground">
                        <Clock className="h-3 w-3" />
                        {t("plugin.settings.lastChecked", { time: formatDateTime(dashboardData.checkedAt) })}
                      </div>
                    </>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      {translateText("Runtime diagnostics are unavailable right now.")}
                    </p>
                  )}
                </CardContent>
              </Card>

              {recentLogs && recentLogs.length > 0 ? (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base flex items-center gap-1.5">
                      <ActivitySquare className="h-4 w-4" />
                      {translateText("Recent Logs")}
                    </CardTitle>
                    <CardDescription>{t("plugin.settings.recentLogs", { count: recentLogs.length })}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="max-h-64 space-y-1 overflow-y-auto font-mono text-xs">
                      {recentLogs.map((entry) => (
                        <div
                          key={entry.id}
                          className={`flex gap-2 py-0.5 ${
                            entry.level === "error"
                              ? "text-destructive"
                              : entry.level === "warn"
                                ? "text-yellow-600 dark:text-yellow-400"
                                : entry.level === "debug"
                                  ? "text-muted-foreground/60"
                                  : "text-muted-foreground"
                          }`}
                        >
                          <span className="shrink-0 text-muted-foreground/50">{formatDateTime(entry.createdAt)}</span>
                          <Badge variant="outline" className="h-4 shrink-0 px-1 text-[10px]">{translateText(entry.level)}</Badge>
                          <span className="truncate" title={entry.message}>{entry.message}</span>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              ) : null}
            </div>

            <div className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-1.5">
                    <ActivitySquare className="h-4 w-4" />
                    {t("plugin.settings.healthStatus")}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {healthLoading ? (
                    <p className="text-sm text-muted-foreground">{translateText("Checking health...")}</p>
                  ) : healthData ? (
                    <div className="space-y-4 text-sm">
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">{translateText("Overall")}</span>
                        <Badge variant={healthData.healthy ? "default" : "destructive"}>
                          {translateText(healthData.status)}
                        </Badge>
                      </div>

                      {healthData.checks.length > 0 ? (
                        <div className="space-y-2 border-t border-border/50 pt-2">
                          {healthData.checks.map((check, i) => (
                            <div key={i} className="flex items-start justify-between gap-2">
                              <span className="truncate text-muted-foreground" title={check.name}>
                                {check.name}
                              </span>
                              {check.passed ? (
                                <CheckCircle className="h-4 w-4 shrink-0 text-green-500" />
                              ) : (
                                <XCircle className="h-4 w-4 shrink-0 text-destructive" />
                              )}
                            </div>
                          ))}
                        </div>
                      ) : null}

                      {healthData.lastError ? (
                        <div className="break-words rounded border border-destructive/20 bg-destructive/10 p-2 text-xs text-destructive">
                          {healthData.lastError}
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <div className="space-y-3 text-sm text-muted-foreground">
                      <div className="flex items-center justify-between">
                        <span>{translateText("Lifecycle")}</span>
                        <Badge variant={statusVariant}>{translateText(displayStatus)}</Badge>
                      </div>
                      <p>{translateText("Health checks run once the plugin is ready.")}</p>
                      {plugin.lastError ? (
                        <div className="break-words rounded border border-destructive/20 bg-destructive/10 p-2 text-xs text-destructive">
                          {plugin.lastError}
                        </div>
                      ) : null}
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">{translateText("Details")}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-sm text-muted-foreground">
                  <div className="flex justify-between gap-3">
                    <span>{translateText("Plugin ID")}</span>
                    <span className="font-mono text-xs text-right">{plugin.id}</span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span>{translateText("Plugin Key")}</span>
                    <span className="font-mono text-xs text-right">{plugin.pluginKey}</span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span>{translateText("NPM Package")}</span>
                    <span className="max-w-[170px] truncate text-right text-xs" title={plugin.packageName}>
                      {plugin.packageName}
                    </span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span>{translateText("Version")}</span>
                    <span className="text-right text-foreground">v{plugin.manifestJson.version ?? plugin.version}</span>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-1.5">
                    <ShieldAlert className="h-4 w-4" />
                    {translateText("Permissions")}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {pluginCapabilities.length > 0 ? (
                    <ul className="space-y-2 text-sm text-muted-foreground">
                      {pluginCapabilities.map((cap) => (
                        <li key={cap} className="rounded-md bg-muted/40 px-2.5 py-2 font-mono text-xs text-foreground/85">
                          {cap}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-muted-foreground italic">{translateText("No special permissions requested.")}</p>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ---------------------------------------------------------------------------
// PluginConfigForm — auto-generated form for instanceConfigSchema
// ---------------------------------------------------------------------------

interface PluginConfigFormProps {
  pluginId: string;
  schema: JsonSchemaNode;
  initialValues?: Record<string, unknown>;
  isLoading?: boolean;
  /** Current plugin lifecycle status — "Test Configuration" only available when `ready`. */
  pluginStatus?: string;
  /** Whether the plugin worker implements `validateConfig`. */
  supportsConfigTest?: boolean;
}

/**
 * Inner component that manages form state, validation, save, and "Test Configuration"
 * for the auto-generated plugin config form.
 *
 * Separated from PluginSettings to isolate re-render scope — only the form
 * re-renders on field changes, not the entire page.
 */
function PluginConfigForm({ pluginId, schema, initialValues, isLoading, pluginStatus, supportsConfigTest }: PluginConfigFormProps) {
  const queryClient = useQueryClient();
  const { translateText } = useI18n();

  // Form values: start with saved values, fall back to schema defaults
  const [values, setValues] = useState<Record<string, unknown>>(() => ({
    ...getDefaultValues(schema),
    ...(initialValues ?? {}),
  }));

  // Sync when saved config loads asynchronously — only on first load so we
  // don't overwrite in-progress user edits if the query refetches (e.g. on
  // window focus).
  const hasHydratedRef = useRef(false);
  useEffect(() => {
    if (initialValues && !hasHydratedRef.current) {
      hasHydratedRef.current = true;
      setValues({
        ...getDefaultValues(schema),
        ...initialValues,
      });
    }
  }, [initialValues, schema]);

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saveMessage, setSaveMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [testResult, setTestResult] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Dirty tracking: compare against initial values
  const isDirty = JSON.stringify(values) !== JSON.stringify({
    ...getDefaultValues(schema),
    ...(initialValues ?? {}),
  });

  // Save mutation
  const saveMutation = useMutation({
    mutationFn: (configJson: Record<string, unknown>) =>
      pluginsApi.saveConfig(pluginId, configJson),
    onSuccess: () => {
      setSaveMessage({ type: "success", text: translateText("Configuration saved.") });
      setTestResult(null);
      queryClient.invalidateQueries({ queryKey: queryKeys.plugins.config(pluginId) });
      // Clear success message after 3s
      setTimeout(() => setSaveMessage(null), 3000);
    },
    onError: (err: Error) => {
      setSaveMessage({ type: "error", text: err.message || translateText("Failed to save configuration.") });
    },
  });

  // Test configuration mutation
  const testMutation = useMutation({
    mutationFn: (configJson: Record<string, unknown>) =>
      pluginsApi.testConfig(pluginId, configJson),
    onSuccess: (result) => {
      if (result.valid) {
        setTestResult({ type: "success", text: translateText("Configuration test passed.") });
      } else {
        setTestResult({ type: "error", text: result.message || translateText("Configuration test failed.") });
      }
    },
    onError: (err: Error) => {
      setTestResult({ type: "error", text: err.message || translateText("Configuration test failed.") });
    },
  });

  const handleChange = useCallback((newValues: Record<string, unknown>) => {
    setValues(newValues);
    // Clear field-level errors as the user types
    setErrors({});
    setSaveMessage(null);
  }, []);

  const handleSave = useCallback(() => {
    // Validate before saving
    const validationErrors = validateJsonSchemaForm(schema, values);
    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors);
      return;
    }
    setErrors({});
    saveMutation.mutate(values);
  }, [schema, values, saveMutation]);

  const handleTestConnection = useCallback(() => {
    // Validate before testing
    const validationErrors = validateJsonSchemaForm(schema, values);
    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors);
      return;
    }
    setErrors({});
    setTestResult(null);
    testMutation.mutate(values);
  }, [schema, values, testMutation]);

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
        <Loader2 className="h-4 w-4 animate-spin" />
        {translateText("Loading configuration...")}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <JsonSchemaForm
        schema={schema}
        values={values}
        onChange={handleChange}
        errors={errors}
        disabled={saveMutation.isPending}
      />

      {/* Status messages */}
      {saveMessage && (
        <div
          className={`text-sm p-2 rounded border ${
            saveMessage.type === "success"
              ? "text-green-700 bg-green-50 border-green-200 dark:text-green-400 dark:bg-green-950/30 dark:border-green-900"
              : "text-destructive bg-destructive/10 border-destructive/20"
          }`}
        >
          {saveMessage.text}
        </div>
      )}

      {testResult && (
        <div
          className={`text-sm p-2 rounded border ${
            testResult.type === "success"
              ? "text-green-700 bg-green-50 border-green-200 dark:text-green-400 dark:bg-green-950/30 dark:border-green-900"
              : "text-destructive bg-destructive/10 border-destructive/20"
          }`}
        >
          {testResult.text}
        </div>
      )}

      {/* Action buttons */}
      <div className="flex items-center gap-2 pt-2">
        <Button
          onClick={handleSave}
          disabled={saveMutation.isPending || !isDirty}
          size="sm"
        >
          {saveMutation.isPending ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {translateText("Saving...")}
            </>
          ) : (
            translateText("Save Configuration")
          )}
        </Button>
        {pluginStatus === "ready" && supportsConfigTest && (
          <Button
            variant="outline"
            onClick={handleTestConnection}
            disabled={testMutation.isPending}
            size="sm"
          >
            {testMutation.isPending ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                {translateText("Testing...")}
              </>
            ) : (
              translateText("Test Configuration")
            )}
          </Button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dashboard helper components and formatting utilities
// ---------------------------------------------------------------------------

/**
 * Format an uptime value (in milliseconds) to a human-readable string.
 */
function formatUptime(uptimeMs: number | null): string {
  if (uptimeMs == null) return "—";
  const totalSeconds = Math.floor(uptimeMs / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  if (minutes < 60) return `${minutes}m ${totalSeconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

/**
 * Format a duration in milliseconds to a compact display string.
 */
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

/**
 * Format an ISO timestamp to a relative time string (e.g., "2m ago").
 */
function formatRelativeTime(isoString: string): string {
  return relativeTime(isoString);
}

/**
 * Format a unix timestamp (ms since epoch) to a locale string.
 */
function formatTimestamp(epochMs: number): string {
  return formatDateTime(new Date(epochMs));
}

/**
 * Status indicator dot for job run statuses.
 */
function JobStatusDot({ status }: { status: string }) {
  const colorClass =
    status === "success" || status === "succeeded"
      ? "bg-green-500"
      : status === "failed"
        ? "bg-red-500"
        : status === "running"
          ? "bg-blue-500 animate-pulse"
          : status === "cancelled"
            ? "bg-gray-400"
            : "bg-amber-500"; // queued, pending
  return (
    <span
      className={`inline-block h-2 w-2 rounded-full shrink-0 ${colorClass}`}
      title={status}
    />
  );
}

/**
 * Status indicator dot for webhook delivery statuses.
 */
function DeliveryStatusDot({ status }: { status: string }) {
  const colorClass =
    status === "processed" || status === "success"
      ? "bg-green-500"
      : status === "failed"
        ? "bg-red-500"
        : status === "received"
          ? "bg-blue-500"
          : "bg-amber-500"; // pending
  return (
    <span
      className={`inline-block h-2 w-2 rounded-full shrink-0 ${colorClass}`}
      title={status}
    />
  );
}
