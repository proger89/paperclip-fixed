import { useQuery } from "@tanstack/react-query";
import { Clock3, FlaskConical, Puzzle, Settings, SlidersHorizontal } from "lucide-react";
import { pluginsApi } from "@/api/plugins";
import { queryKeys } from "@/lib/queryKeys";
import { resolveUiText } from "@/lib/localized";
import { useI18n } from "@/context/I18nContext";
import { SidebarNavItem } from "./SidebarNavItem";

export function InstanceSidebar() {
  const { translateText } = useI18n();
  const { data: plugins } = useQuery({
    queryKey: queryKeys.plugins.all,
    queryFn: () => pluginsApi.list(),
  });
  const { data: examples } = useQuery({
    queryKey: [...queryKeys.plugins.examples, "catalog-sidebar"],
    queryFn: () => pluginsApi.listExamples(),
  });
  const exampleNameByPackageName = new Map(
    (examples ?? []).map((example) => [example.packageName, resolveUiText(example.displayName)]),
  );

  return (
    <aside className="w-60 h-full min-h-0 border-r border-border bg-background flex flex-col">
      <div className="flex items-center gap-2 px-3 h-12 shrink-0">
        <Settings className="h-4 w-4 text-muted-foreground shrink-0 ml-1" />
        <span className="flex-1 text-sm font-bold text-foreground truncate">
          {translateText("Instance Settings")}
        </span>
      </div>

      <nav className="flex-1 min-h-0 overflow-y-auto scrollbar-auto-hide flex flex-col gap-4 px-3 py-2">
        <div className="flex flex-col gap-0.5">
          <SidebarNavItem to="/instance/settings/general" label="General" icon={SlidersHorizontal} end />
          <SidebarNavItem to="/instance/settings/heartbeats" label="Heartbeats" icon={Clock3} end />
          <SidebarNavItem to="/instance/settings/experimental" label="Experimental" icon={FlaskConical} />
          <SidebarNavItem to="/instance/settings/plugins" label="Plugins" icon={Puzzle} />
          {(plugins ?? []).length > 0 ? (
            <div className="ml-4 mt-1 flex flex-col gap-0.5 border-l border-border/70 pl-3">
              {(plugins ?? []).map((plugin) => (
                <SidebarNavItem
                  key={plugin.id}
                  to={`/instance/settings/plugins/${plugin.id}`}
                  label={
                    exampleNameByPackageName.get(plugin.packageName) ||
                    resolveUiText(plugin.manifestJson.displayName) ||
                    plugin.packageName
                  }
                  icon={Puzzle}
                  className="px-2 py-1.5 text-xs"
                />
              ))}
            </div>
          ) : null}
        </div>
      </nav>
    </aside>
  );
}
