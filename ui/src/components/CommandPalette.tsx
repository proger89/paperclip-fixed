import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "@/lib/router";
import { useQuery } from "@tanstack/react-query";
import { useCompany } from "../context/CompanyContext";
import { useDialog } from "../context/DialogContext";
import { useSidebar } from "../context/SidebarContext";
import { issuesApi } from "../api/issues";
import { agentsApi } from "../api/agents";
import { projectsApi } from "../api/projects";
import { queryKeys } from "../lib/queryKeys";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import {
  CircleDot,
  Bot,
  Hexagon,
  Target,
  LayoutDashboard,
  Inbox,
  DollarSign,
  History,
  SquarePen,
  Plus,
} from "lucide-react";
import { Identity } from "./Identity";
import { agentUrl, projectUrl } from "../lib/utils";
import { useI18n } from "@/context/I18nContext";

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const { translateText } = useI18n();
  const navigate = useNavigate();
  const { selectedCompanyId } = useCompany();
  const { openNewIssue, openNewAgent } = useDialog();
  const { isMobile, setSidebarOpen } = useSidebar();
  const searchQuery = query.trim();

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen(true);
        if (isMobile) setSidebarOpen(false);
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isMobile, setSidebarOpen]);

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  const { data: issues = [] } = useQuery({
    queryKey: queryKeys.issues.list(selectedCompanyId!),
    queryFn: () => issuesApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId && open,
  });

  const { data: searchedIssues = [] } = useQuery({
    queryKey: queryKeys.issues.search(selectedCompanyId!, searchQuery),
    queryFn: () => issuesApi.list(selectedCompanyId!, { q: searchQuery }),
    enabled: !!selectedCompanyId && open && searchQuery.length > 0,
  });

  const { data: agents = [] } = useQuery({
    queryKey: queryKeys.agents.list(selectedCompanyId!),
    queryFn: () => agentsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId && open,
  });

  const { data: allProjects = [] } = useQuery({
    queryKey: queryKeys.projects.list(selectedCompanyId!),
    queryFn: () => projectsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId && open,
  });
  const projects = useMemo(
    () => allProjects.filter((p) => !p.archivedAt),
    [allProjects],
  );

  function go(path: string) {
    setOpen(false);
    navigate(path);
  }

  const agentName = (id: string | null) => {
    if (!id) return null;
    return agents.find((a) => a.id === id)?.name ?? null;
  };

  const visibleIssues = useMemo(
    () => (searchQuery.length > 0 ? searchedIssues : issues),
    [issues, searchedIssues, searchQuery],
  );

  return (
    <CommandDialog
      open={open}
      title={translateText("Command Palette")}
      description={translateText("Search for a command to run...")}
      onOpenChange={(v) => {
        setOpen(v);
        if (v && isMobile) setSidebarOpen(false);
      }}
    >
      <CommandInput
        placeholder={translateText("Search issues, agents, projects...")}
        value={query}
        onValueChange={setQuery}
      />
      <CommandList>
        <CommandEmpty>{translateText("No results found.")}</CommandEmpty>

        <CommandGroup heading={translateText("Actions")}>
          <CommandItem
            onSelect={() => {
              setOpen(false);
              openNewIssue();
            }}
          >
            <SquarePen className="mr-2 h-4 w-4" />
            {translateText("Create new issue")}
            <span className="ml-auto text-xs text-muted-foreground">C</span>
          </CommandItem>
          <CommandItem
            onSelect={() => {
              setOpen(false);
              openNewAgent();
            }}
          >
            <Plus className="mr-2 h-4 w-4" />
            {translateText("Create new agent")}
          </CommandItem>
          <CommandItem onSelect={() => go("/projects")}>
            <Plus className="mr-2 h-4 w-4" />
            {translateText("Create new project")}
          </CommandItem>
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading={translateText("Pages")}>
          <CommandItem onSelect={() => go("/dashboard")}>
            <LayoutDashboard className="mr-2 h-4 w-4" />
            {translateText("Dashboard")}
          </CommandItem>
          <CommandItem onSelect={() => go("/inbox")}>
            <Inbox className="mr-2 h-4 w-4" />
            {translateText("Inbox")}
          </CommandItem>
          <CommandItem onSelect={() => go("/issues")}>
            <CircleDot className="mr-2 h-4 w-4" />
            {translateText("Issues")}
          </CommandItem>
          <CommandItem onSelect={() => go("/projects")}>
            <Hexagon className="mr-2 h-4 w-4" />
            {translateText("Projects")}
          </CommandItem>
          <CommandItem onSelect={() => go("/goals")}>
            <Target className="mr-2 h-4 w-4" />
            {translateText("Goals")}
          </CommandItem>
          <CommandItem onSelect={() => go("/agents")}>
            <Bot className="mr-2 h-4 w-4" />
            {translateText("Agents")}
          </CommandItem>
          <CommandItem onSelect={() => go("/costs")}>
            <DollarSign className="mr-2 h-4 w-4" />
            {translateText("Costs")}
          </CommandItem>
          <CommandItem onSelect={() => go("/activity")}>
            <History className="mr-2 h-4 w-4" />
            {translateText("Activity")}
          </CommandItem>
        </CommandGroup>

        {visibleIssues.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading={translateText("Issues")}>
              {visibleIssues.slice(0, 10).map((issue) => (
                <CommandItem
                  key={issue.id}
                  value={
                    searchQuery.length > 0
                      ? `${searchQuery} ${issue.identifier ?? ""} ${issue.title}`
                      : undefined
                  }
                  onSelect={() => go(`/issues/${issue.identifier ?? issue.id}`)}
                >
                  <CircleDot className="mr-2 h-4 w-4" />
                  <span className="text-muted-foreground mr-2 font-mono text-xs">
                    {issue.identifier ?? issue.id.slice(0, 8)}
                  </span>
                  <span className="flex-1 truncate">{issue.title}</span>
                  {issue.assigneeAgentId && (() => {
                    const name = agentName(issue.assigneeAgentId);
                    return name ? <Identity name={name} size="sm" className="ml-2 hidden sm:inline-flex" /> : null;
                  })()}
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}

        {agents.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading={translateText("Agents")}>
              {agents.slice(0, 10).map((agent) => (
                <CommandItem key={agent.id} onSelect={() => go(agentUrl(agent))}>
                  <Bot className="mr-2 h-4 w-4" />
                  {agent.name}
                  <span className="text-xs text-muted-foreground ml-2">{agent.role}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}

        {projects.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading={translateText("Projects")}>
              {projects.slice(0, 10).map((project) => (
                <CommandItem key={project.id} onSelect={() => go(projectUrl(project))}>
                  <Hexagon className="mr-2 h-4 w-4" />
                  {project.name}
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}
      </CommandList>
    </CommandDialog>
  );
}
