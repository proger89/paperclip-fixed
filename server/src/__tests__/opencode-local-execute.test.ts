import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  execute,
  resetOpenCodeModelsCacheForTests,
} from "@paperclipai/adapter-opencode-local/server";

async function writeFakeOpenCodeAuthFailureCommand(commandPath: string): Promise<void> {
  const script = `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args[0] === "models") {
  console.log("openai/gpt-5");
  process.exit(0);
}
console.log(JSON.stringify({
  type: "error",
  message: "Authentication required. Run opencode auth login.",
}));
process.exit(1);
`;
  await fs.writeFile(commandPath, script, "utf8");
  await fs.chmod(commandPath, 0o755);
}

describe("opencode execute", () => {
  afterEach(() => {
    resetOpenCodeModelsCacheForTests();
  });

  it("returns opencode_auth_required when OpenCode asks for login", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-opencode-execute-auth-"));
    const workspace = path.join(root, "workspace");
    const commandPath = path.join(root, "opencode");
    await fs.mkdir(workspace, { recursive: true });
    await writeFakeOpenCodeAuthFailureCommand(commandPath);

    const previousHome = process.env.HOME;
    const previousUserProfile = process.env.USERPROFILE;
    process.env.HOME = root;
    process.env.USERPROFILE = root;

    try {
      const result = await execute({
        runId: "run-auth",
        agent: {
          id: "agent-1",
          companyId: "company-1",
          name: "OpenCode Coder",
          adapterType: "opencode_local",
          adapterConfig: {},
        },
        runtime: {
          sessionId: null,
          sessionParams: null,
          sessionDisplayId: null,
          taskKey: null,
        },
        config: {
          command: commandPath,
          cwd: workspace,
          model: "openai/gpt-5",
          promptTemplate: "Follow the paperclip heartbeat.",
        },
        context: {},
        authToken: "run-jwt-token",
        onLog: async () => {},
      });

      expect(result.exitCode).toBe(1);
      expect(result.errorCode).toBe("opencode_auth_required");
      expect(result.errorMessage).toContain("opencode auth login");
    } finally {
      if (previousHome === undefined) {
        delete process.env.HOME;
      } else {
        process.env.HOME = previousHome;
      }
      if (previousUserProfile === undefined) {
        delete process.env.USERPROFILE;
      } else {
        process.env.USERPROFILE = previousUserProfile;
      }
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
