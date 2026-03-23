import fs from "node:fs/promises";

const DEFAULT_AGENT_BUNDLE_FILES = {
  default: ["AGENTS.md"],
  ceo: ["AGENTS.md", "HEARTBEAT.md", "SOUL.md", "TOOLS.md"],
} as const;
const CURRENT_DEFAULT_AGENT_BUNDLE_VERSION = "2026-03-23.1";
const LEGACY_CEO_DEFAULT_AGENT_BUNDLE_VERSION = "2026-03-23.0";
export const MANAGED_DEFAULT_AGENT_BUNDLE_MARKER_FILE = ".paperclip-managed-bundle.json";

type DefaultAgentBundleRole = keyof typeof DEFAULT_AGENT_BUNDLE_FILES;

export interface ManagedDefaultAgentBundleMarker {
  schemaVersion: 1;
  source: "paperclip_default_agent_bundle";
  role: DefaultAgentBundleRole;
  version: string;
}

function resolveDefaultAgentBundleUrl(role: DefaultAgentBundleRole, fileName: string) {
  return new URL(`../onboarding-assets/${role}/${fileName}`, import.meta.url);
}

export async function loadDefaultAgentInstructionsBundle(role: DefaultAgentBundleRole): Promise<Record<string, string>> {
  const fileNames = DEFAULT_AGENT_BUNDLE_FILES[role];
  const entries = await Promise.all(
    fileNames.map(async (fileName) => {
      const content = await fs.readFile(resolveDefaultAgentBundleUrl(role, fileName), "utf8");
      return [fileName, content] as const;
    }),
  );
  return Object.fromEntries(entries);
}

export function resolveDefaultAgentInstructionsBundleRole(role: string): DefaultAgentBundleRole {
  return role === "ceo" ? "ceo" : "default";
}

function normalizeBundleText(text: string) {
  return text.replace(/\r\n/g, "\n");
}

function buildLegacyCeoAgentsFile(currentContent: string) {
  return normalizeBundleText(currentContent)
    .replaceAll("$PAPERCLIP_INSTRUCTIONS_DIR/HEARTBEAT.md", "$AGENT_HOME/HEARTBEAT.md")
    .replaceAll("$PAPERCLIP_INSTRUCTIONS_DIR/SOUL.md", "$AGENT_HOME/SOUL.md")
    .replaceAll("$PAPERCLIP_INSTRUCTIONS_DIR/TOOLS.md", "$AGENT_HOME/TOOLS.md")
    .replace(
      "\nYour workspace and memory root remain `$AGENT_HOME`. Use `$PAPERCLIP_INSTRUCTIONS_FILE` and `$PAPERCLIP_INSTRUCTIONS_DIR` when you need the location of the managed instruction bundle.\n",
      "\n",
    );
}

export function createManagedDefaultAgentBundleMarker(
  role: DefaultAgentBundleRole,
  version = CURRENT_DEFAULT_AGENT_BUNDLE_VERSION,
): ManagedDefaultAgentBundleMarker {
  return {
    schemaVersion: 1,
    source: "paperclip_default_agent_bundle",
    role,
    version,
  };
}

export function isManagedDefaultAgentBundleMarker(value: unknown): value is ManagedDefaultAgentBundleMarker {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    record.schemaVersion === 1
    && record.source === "paperclip_default_agent_bundle"
    && (record.role === "default" || record.role === "ceo")
    && typeof record.version === "string"
    && record.version.trim().length > 0
  );
}

export async function loadLegacyDefaultAgentInstructionsBundles(
  role: DefaultAgentBundleRole,
): Promise<Array<{ marker: ManagedDefaultAgentBundleMarker; files: Record<string, string> }>> {
  if (role !== "ceo") return [];

  const current = await loadDefaultAgentInstructionsBundle("ceo");
  return [{
    marker: createManagedDefaultAgentBundleMarker("ceo", LEGACY_CEO_DEFAULT_AGENT_BUNDLE_VERSION),
    files: {
      ...current,
      "AGENTS.md": buildLegacyCeoAgentsFile(current["AGENTS.md"] ?? ""),
    },
  }];
}
