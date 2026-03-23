import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { agentInstructionsService } from "../services/agent-instructions.js";
import {
  MANAGED_DEFAULT_AGENT_BUNDLE_MARKER_FILE,
  loadDefaultAgentInstructionsBundle,
} from "../services/default-agent-instructions.js";

type TestAgent = {
  id: string;
  companyId: string;
  name: string;
  adapterConfig: Record<string, unknown>;
};

async function makeTempDir(prefix: string) {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

function makeAgent(adapterConfig: Record<string, unknown>): TestAgent {
  return {
    id: "agent-1",
    companyId: "company-1",
    name: "Agent 1",
    adapterConfig,
  };
}

describe("agent instructions service", () => {
  const originalPaperclipHome = process.env.PAPERCLIP_HOME;
  const originalPaperclipInstanceId = process.env.PAPERCLIP_INSTANCE_ID;
  const cleanupDirs = new Set<string>();

  afterEach(async () => {
    if (originalPaperclipHome === undefined) delete process.env.PAPERCLIP_HOME;
    else process.env.PAPERCLIP_HOME = originalPaperclipHome;
    if (originalPaperclipInstanceId === undefined) delete process.env.PAPERCLIP_INSTANCE_ID;
    else process.env.PAPERCLIP_INSTANCE_ID = originalPaperclipInstanceId;

    await Promise.all([...cleanupDirs].map(async (dir) => {
      await fs.rm(dir, { recursive: true, force: true });
      cleanupDirs.delete(dir);
    }));
  });

  it("copies the existing bundle into the managed root when switching to managed mode", async () => {
    const paperclipHome = await makeTempDir("paperclip-agent-instructions-home-");
    const externalRoot = await makeTempDir("paperclip-agent-instructions-external-");
    cleanupDirs.add(paperclipHome);
    cleanupDirs.add(externalRoot);
    process.env.PAPERCLIP_HOME = paperclipHome;
    process.env.PAPERCLIP_INSTANCE_ID = "test-instance";

    await fs.writeFile(path.join(externalRoot, "AGENTS.md"), "# External Agent\n", "utf8");
    await fs.mkdir(path.join(externalRoot, "docs"), { recursive: true });
    await fs.writeFile(path.join(externalRoot, "docs", "TOOLS.md"), "## Tools\n", "utf8");

    const svc = agentInstructionsService();
    const agent = makeAgent({
      instructionsBundleMode: "external",
      instructionsRootPath: externalRoot,
      instructionsEntryFile: "AGENTS.md",
      instructionsFilePath: path.join(externalRoot, "AGENTS.md"),
    });

    const result = await svc.updateBundle(agent, { mode: "managed" });

    expect(result.bundle.mode).toBe("managed");
    expect(result.bundle.managedRootPath).toBe(
      path.join(
        paperclipHome,
        "instances",
        "test-instance",
        "companies",
        "company-1",
        "agents",
        "agent-1",
        "instructions",
      ),
    );
    expect(result.bundle.files.map((file) => file.path)).toEqual(["AGENTS.md", "docs/TOOLS.md"]);
    await expect(fs.readFile(path.join(result.bundle.managedRootPath, "AGENTS.md"), "utf8")).resolves.toBe("# External Agent\n");
    await expect(fs.readFile(path.join(result.bundle.managedRootPath, "docs", "TOOLS.md"), "utf8")).resolves.toBe("## Tools\n");
  });

  it("creates the target entry file when switching to a new external root", async () => {
    const paperclipHome = await makeTempDir("paperclip-agent-instructions-home-");
    const managedRoot = path.join(
      paperclipHome,
      "instances",
      "test-instance",
      "companies",
      "company-1",
      "agents",
      "agent-1",
      "instructions",
    );
    const externalRoot = await makeTempDir("paperclip-agent-instructions-new-external-");
    cleanupDirs.add(paperclipHome);
    cleanupDirs.add(externalRoot);
    process.env.PAPERCLIP_HOME = paperclipHome;
    process.env.PAPERCLIP_INSTANCE_ID = "test-instance";

    await fs.mkdir(managedRoot, { recursive: true });
    await fs.writeFile(path.join(managedRoot, "AGENTS.md"), "# Managed Agent\n", "utf8");

    const svc = agentInstructionsService();
    const agent = makeAgent({
      instructionsBundleMode: "managed",
      instructionsRootPath: managedRoot,
      instructionsEntryFile: "AGENTS.md",
      instructionsFilePath: path.join(managedRoot, "AGENTS.md"),
    });

    const result = await svc.updateBundle(agent, {
      mode: "external",
      rootPath: externalRoot,
      entryFile: "docs/AGENTS.md",
    });

    expect(result.bundle.mode).toBe("external");
    expect(result.bundle.rootPath).toBe(externalRoot);
    await expect(fs.readFile(path.join(externalRoot, "docs", "AGENTS.md"), "utf8")).resolves.toBe("# Managed Agent\n");
  });

  it("filters junk files, dependency bundles, and python caches from bundle listings and exports", async () => {
    const externalRoot = await makeTempDir("paperclip-agent-instructions-ignore-");
    cleanupDirs.add(externalRoot);

    await fs.writeFile(path.join(externalRoot, "AGENTS.md"), "# External Agent\n", "utf8");
    await fs.writeFile(path.join(externalRoot, ".gitignore"), "node_modules/\n", "utf8");
    await fs.writeFile(path.join(externalRoot, ".DS_Store"), "junk", "utf8");
    await fs.mkdir(path.join(externalRoot, "docs"), { recursive: true });
    await fs.writeFile(path.join(externalRoot, "docs", "TOOLS.md"), "## Tools\n", "utf8");
    await fs.writeFile(path.join(externalRoot, "docs", "module.pyc"), "compiled", "utf8");
    await fs.writeFile(path.join(externalRoot, "docs", "._TOOLS.md"), "appledouble", "utf8");
    await fs.mkdir(path.join(externalRoot, "node_modules", "pkg"), { recursive: true });
    await fs.writeFile(path.join(externalRoot, "node_modules", "pkg", "index.js"), "export {};\n", "utf8");
    await fs.mkdir(path.join(externalRoot, "python", "__pycache__"), { recursive: true });
    await fs.writeFile(
      path.join(externalRoot, "python", "__pycache__", "module.cpython-313.pyc"),
      "compiled",
      "utf8",
    );
    await fs.mkdir(path.join(externalRoot, ".pytest_cache"), { recursive: true });
    await fs.writeFile(path.join(externalRoot, ".pytest_cache", "README.md"), "cache", "utf8");

    const svc = agentInstructionsService();
    const agent = makeAgent({
      instructionsBundleMode: "external",
      instructionsRootPath: externalRoot,
      instructionsEntryFile: "AGENTS.md",
      instructionsFilePath: path.join(externalRoot, "AGENTS.md"),
    });

    const bundle = await svc.getBundle(agent);
    const exported = await svc.exportFiles(agent);

    expect(bundle.files.map((file) => file.path)).toEqual([".gitignore", "AGENTS.md", "docs/TOOLS.md"]);
    expect(Object.keys(exported.files).sort((left, right) => left.localeCompare(right))).toEqual([
      ".gitignore",
      "AGENTS.md",
      "docs/TOOLS.md",
    ]);
  });

  it("repairs a legacy CEO managed bundle to the current instruction contract", async () => {
    const paperclipHome = await makeTempDir("paperclip-agent-instructions-legacy-ceo-");
    cleanupDirs.add(paperclipHome);
    process.env.PAPERCLIP_HOME = paperclipHome;
    process.env.PAPERCLIP_INSTANCE_ID = "test-instance";

    const managedRoot = path.join(
      paperclipHome,
      "instances",
      "test-instance",
      "companies",
      "company-1",
      "agents",
      "agent-1",
      "instructions",
    );
    await fs.mkdir(managedRoot, { recursive: true });
    const currentBundle = await loadDefaultAgentInstructionsBundle("ceo");
    const legacyAgentsMd = currentBundle["AGENTS.md"]
      .replaceAll("$PAPERCLIP_INSTRUCTIONS_DIR/HEARTBEAT.md", "$AGENT_HOME/HEARTBEAT.md")
      .replaceAll("$PAPERCLIP_INSTRUCTIONS_DIR/SOUL.md", "$AGENT_HOME/SOUL.md")
      .replaceAll("$PAPERCLIP_INSTRUCTIONS_DIR/TOOLS.md", "$AGENT_HOME/TOOLS.md")
      .replace(
        "\nYour workspace and memory root remain `$AGENT_HOME`. Use `$PAPERCLIP_INSTRUCTIONS_FILE` and `$PAPERCLIP_INSTRUCTIONS_DIR` when you need the location of the managed instruction bundle.\n",
        "\n",
      )
      .replace(/\n+$/u, "\n");
    await fs.writeFile(path.join(managedRoot, "AGENTS.md"), legacyAgentsMd, "utf8");
    await fs.writeFile(path.join(managedRoot, "HEARTBEAT.md"), currentBundle["HEARTBEAT.md"], "utf8");
    await fs.writeFile(path.join(managedRoot, "SOUL.md"), currentBundle["SOUL.md"], "utf8");
    await fs.writeFile(path.join(managedRoot, "TOOLS.md"), currentBundle["TOOLS.md"], "utf8");

    const svc = agentInstructionsService();
    const result = await svc.repairManagedDefaultBundle({
      ...makeAgent({
        instructionsBundleMode: "managed",
        instructionsRootPath: managedRoot,
        instructionsEntryFile: "AGENTS.md",
        instructionsFilePath: path.join(managedRoot, "AGENTS.md"),
      }),
      role: "ceo",
    });

    expect(result.updated).toBe(true);
    expect(result.reason).toBe("repaired_legacy");
    await expect(fs.readFile(path.join(managedRoot, "AGENTS.md"), "utf8")).resolves.toContain("$PAPERCLIP_INSTRUCTIONS_DIR/HEARTBEAT.md");
    await expect(fs.readFile(path.join(managedRoot, "AGENTS.md"), "utf8")).resolves.not.toContain("$AGENT_HOME/HEARTBEAT.md");
    const marker = JSON.parse(await fs.readFile(path.join(managedRoot, MANAGED_DEFAULT_AGENT_BUNDLE_MARKER_FILE), "utf8")) as Record<string, unknown>;
    expect(marker).toMatchObject({
      source: "paperclip_default_agent_bundle",
      role: "ceo",
    });
  });

  it("marks an unmodified current CEO managed bundle as system-owned without changing visible files", async () => {
    const paperclipHome = await makeTempDir("paperclip-agent-instructions-current-ceo-");
    cleanupDirs.add(paperclipHome);
    process.env.PAPERCLIP_HOME = paperclipHome;
    process.env.PAPERCLIP_INSTANCE_ID = "test-instance";

    const svc = agentInstructionsService();
    const currentBundle = await loadDefaultAgentInstructionsBundle("ceo");
    const agent = {
      ...makeAgent({}),
      role: "ceo",
    };
    await svc.materializeManagedBundle(agent, currentBundle, {
      entryFile: "AGENTS.md",
      replaceExisting: true,
      managedDefaultBundleMarker: null,
    });

    const repaired = await svc.repairManagedDefaultBundle({
      ...agent,
      adapterConfig: {
        instructionsBundleMode: "managed",
        instructionsRootPath: path.join(
          paperclipHome,
          "instances",
          "test-instance",
          "companies",
          "company-1",
          "agents",
          "agent-1",
          "instructions",
        ),
        instructionsEntryFile: "AGENTS.md",
        instructionsFilePath: path.join(
          paperclipHome,
          "instances",
          "test-instance",
          "companies",
          "company-1",
          "agents",
          "agent-1",
          "instructions",
          "AGENTS.md",
        ),
      },
    });

    expect(repaired.updated).toBe(true);
    expect(repaired.reason).toBe("marked_current");
    const bundle = await svc.getBundle({
      ...agent,
      adapterConfig: repaired.adapterConfig,
    });
    expect(bundle.files.map((file) => file.path)).toEqual(["AGENTS.md", "HEARTBEAT.md", "SOUL.md", "TOOLS.md"]);
  });

  it("does not overwrite a manually edited managed CEO bundle", async () => {
    const paperclipHome = await makeTempDir("paperclip-agent-instructions-custom-ceo-");
    cleanupDirs.add(paperclipHome);
    process.env.PAPERCLIP_HOME = paperclipHome;
    process.env.PAPERCLIP_INSTANCE_ID = "test-instance";

    const managedRoot = path.join(
      paperclipHome,
      "instances",
      "test-instance",
      "companies",
      "company-1",
      "agents",
      "agent-1",
      "instructions",
    );
    await fs.mkdir(managedRoot, { recursive: true });
    const currentBundle = await loadDefaultAgentInstructionsBundle("ceo");
    await fs.writeFile(
      path.join(managedRoot, "AGENTS.md"),
      `${currentBundle["AGENTS.md"]}\nCustom operator note.\n`,
      "utf8",
    );
    await fs.writeFile(path.join(managedRoot, "HEARTBEAT.md"), currentBundle["HEARTBEAT.md"], "utf8");
    await fs.writeFile(path.join(managedRoot, "SOUL.md"), currentBundle["SOUL.md"], "utf8");
    await fs.writeFile(path.join(managedRoot, "TOOLS.md"), currentBundle["TOOLS.md"], "utf8");

    const svc = agentInstructionsService();
    const result = await svc.repairManagedDefaultBundle({
      ...makeAgent({
        instructionsBundleMode: "managed",
        instructionsRootPath: managedRoot,
        instructionsEntryFile: "AGENTS.md",
        instructionsFilePath: path.join(managedRoot, "AGENTS.md"),
      }),
      role: "ceo",
    });

    expect(result.updated).toBe(false);
    await expect(fs.readFile(path.join(managedRoot, "AGENTS.md"), "utf8")).resolves.toContain("Custom operator note.");
    await expect(fs.readFile(path.join(managedRoot, MANAGED_DEFAULT_AGENT_BUNDLE_MARKER_FILE), "utf8")).rejects.toThrow();
  });
});
