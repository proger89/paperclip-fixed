import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { realizeExecutionWorkspace } from "../services/workspace-runtime.ts";
import type { WorkspaceOperation } from "@paperclipai/shared";
import type { WorkspaceOperationRecorder } from "../services/workspace-operations.ts";

const execFileAsync = promisify(execFile);
const itWindows = process.platform === "win32" ? it : it.skip;

async function runGit(cwd: string, args: string[]) {
  await execFileAsync("git", args, { cwd });
}

async function createTempRepo() {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-worktree-win-"));
  await runGit(repoRoot, ["init"]);
  await runGit(repoRoot, ["config", "user.email", "paperclip@example.com"]);
  await runGit(repoRoot, ["config", "user.name", "Paperclip Test"]);
  await fs.writeFile(path.join(repoRoot, "README.md"), "hello\n", "utf8");
  await runGit(repoRoot, ["add", "README.md"]);
  await runGit(repoRoot, ["commit", "-m", "Initial commit"]);
  await runGit(repoRoot, ["checkout", "-B", "main"]);
  return repoRoot;
}

function createWorkspaceOperationRecorderDouble() {
  const operations: Array<{
    phase: string;
    result: {
      status?: string;
      stdout?: string | null;
      stderr?: string | null;
    };
  }> = [];

  const recorder: WorkspaceOperationRecorder = {
    attachExecutionWorkspaceId: async () => {},
    recordOperation: async (input) => {
      const result = await input.run();
      operations.push({
        phase: input.phase,
        result,
      });
      return {
        id: `op-${operations.length}`,
        companyId: "company-1",
        executionWorkspaceId: null,
        heartbeatRunId: "run-1",
        phase: input.phase,
        command: input.command ?? null,
        cwd: input.cwd ?? null,
        status: (result.status ?? "succeeded") as WorkspaceOperation["status"],
        exitCode: result.exitCode ?? null,
        logStore: "local_file",
        logRef: `op-${operations.length}.ndjson`,
        logBytes: 0,
        logSha256: null,
        logCompressed: false,
        stdoutExcerpt: result.stdout ?? null,
        stderrExcerpt: result.stderr ?? null,
        metadata: input.metadata ?? null,
        startedAt: new Date(),
        finishedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    },
  };

  return { recorder, operations };
}

afterEach(() => {
  delete process.env.SHELL;
});

describe("workspace runtime Windows UTF-8 shell execution", () => {
  itWindows("preserves Cyrillic stdout and stderr for PowerShell provision commands", async () => {
    const repoRoot = await createTempRepo();
    const { recorder, operations } = createWorkspaceOperationRecorderDouble();
    process.env.SHELL = "powershell.exe";

    await realizeExecutionWorkspace({
      base: {
        baseCwd: repoRoot,
        source: "project_primary",
        projectId: "project-1",
        workspaceId: "workspace-1",
        repoUrl: null,
        repoRef: "HEAD",
      },
      config: {
        workspaceStrategy: {
          type: "git_worktree",
          branchTemplate: "{{issue.identifier}}-{{slug}}",
          provisionCommand: "Write-Output 'привет'; [Console]::Error.WriteLine('ошибка')",
        },
      },
      issue: {
        id: "issue-1",
        identifier: "PAP-UTF8",
        title: "Windows UTF8 provision",
      },
      agent: {
        id: "agent-1",
        name: "Codex Coder",
        companyId: "company-1",
      },
      recorder,
    });

    const provisionOperation = operations.find((operation) => operation.phase === "workspace_provision");
    expect(provisionOperation?.result.stdout).toContain("привет");
    expect(provisionOperation?.result.stderr).toContain("ошибка");
  });
});
