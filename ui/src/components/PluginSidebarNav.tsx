import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Puzzle } from "lucide-react";
import { resolveLocalizedText } from "@paperclipai/shared";
import { pluginsApi } from "@/api/plugins";
import { queryKeys } from "@/lib/queryKeys";
import { useI18n } from "@/context/I18nContext";
import { usePluginSlots } from "@/plugins/slots";
import { SidebarNavItem } from "./SidebarNavItem";

export function PluginSidebarNav({
  companyId,
  companyPrefix,
}: {
  companyId: string | null;
  companyPrefix: string | null;
}) {
  const { locale } = useI18n();
  const { slots } = usePluginSlots({
    slotTypes: ["page"],
    companyId,
    enabled: Boolean(companyId),
  });
  const { data: plugins } = useQuery({
    queryKey: queryKeys.plugins.all,
    queryFn: () => pluginsApi.list(),
    enabled: Boolean(companyId),
  });
  const { data: examples } = useQuery({
    queryKey: [...queryKeys.plugins.examples, "company-sidebar"],
    queryFn: () => pluginsApi.listExamples(),
    enabled: Boolean(companyId),
  });

  const pageSlots = slots.filter((slot) => typeof slot.routePath === "string" && slot.routePath.length > 0);
  const pluginsById = useMemo(
    () => new Map((plugins ?? []).map((plugin) => [plugin.id, plugin])),
    [plugins],
  );
  const examplesByPackageName = useMemo(
    () =>
      new Map(
        (examples ?? []).map((example) => [
          example.packageName,
          resolveLocalizedText(example.displayName, locale) ?? example.packageName,
        ]),
      ),
    [examples, locale],
  );
  const deduped = Array.from(new Map(pageSlots.map((slot) => [`${slot.pluginId}:${slot.routePath}`, slot])).values());
  const resolveLabel = (slot: (typeof deduped)[number]): string => {
    const plugin = pluginsById.get(slot.pluginId);
    if (!plugin) {
      return resolveLocalizedText(slot.displayName, locale) || slot.routePath || "";
    }
    return (
      examplesByPackageName.get(plugin.packageName)
      ?? resolveLocalizedText(plugin.manifestJson.displayName, locale)
      ?? resolveLocalizedText(slot.displayName, locale)
      ?? slot.routePath
      ?? ""
    );
  };

  if (!companyId || !companyPrefix || deduped.length === 0) {
    return null;
  }

  return (
    <>
      {deduped.map((slot) => (
        <SidebarNavItem
          key={`${slot.pluginId}:${slot.routePath}`}
          to={`/${companyPrefix}/${slot.routePath}`}
          label={resolveLabel(slot)}
          icon={Puzzle}
        />
      ))}
    </>
  );
}
