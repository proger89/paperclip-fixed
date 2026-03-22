import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  resolveShellCommandTarget,
  resolveSpawnTarget,
  withWindowsUtf8EnvDefaults,
} from "./server-utils.js";

describe("server-utils UTF-8 process helpers", () => {
  it("adds Windows UTF-8 defaults only when missing", () => {
    const env = withWindowsUtf8EnvDefaults({ PATH: "C:\\Windows\\System32", LANG: "already-set" }, "win32");
    expect(env.PYTHONIOENCODING).toBe("UTF-8");
    expect(env.PYTHONUTF8).toBe("1");
    expect(env.LANG).toBe("already-set");
    expect(env.LC_ALL).toBe("C.UTF-8");
  });

  it("keeps POSIX shell execution unchanged", () => {
    const target = resolveShellCommandTarget("printf 'hello\\n'", {
      platform: "linux",
      shell: "/bin/sh",
    });

    expect(target).toEqual({
      command: "/bin/sh",
      args: ["-lc", "printf 'hello\\n'"],
    });
  });

  it("builds a PowerShell UTF-8 prelude on Windows", () => {
    const target = resolveShellCommandTarget("Write-Output 'hello'", {
      platform: "win32",
      shell: "powershell.exe",
    });

    expect(target.command).toBe("powershell.exe");
    expect(target.args.slice(0, 4)).toEqual([
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-Command",
    ]);
    expect(target.args[4]).toContain("[Console]::InputEncoding");
    expect(target.args[4]).toContain("$OutputEncoding");
    expect(target.args[4]).toContain("Write-Output 'hello'");
  });

  it("launches .cmd wrappers through cmd.exe with UTF-8 code page prelude on Windows", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-server-utils-"));
    const commandPath = path.join(root, "codex.cmd");
    await fs.writeFile(commandPath, "@echo off\r\necho hello\r\n", "utf8");

    try {
      const target = await resolveSpawnTarget(commandPath, ["exec", "--json"], root, {
        ComSpec: "C:\\Windows\\System32\\cmd.exe",
        PATH: root,
      }, { platform: "win32" });

      expect(target.command).toBe("C:\\Windows\\System32\\cmd.exe");
      expect(target.args.slice(0, 3)).toEqual(["/d", "/s", "/c"]);
      expect(target.args[3]).toContain("chcp 65001>nul &&");
      expect(target.args[3]).toContain("codex.cmd");
      expect(target.args[3]).toContain("exec");
      expect(target.args[3]).toContain("--json");
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("launches extensionless node shebang scripts through node on Windows", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-server-utils-node-"));
    const commandPath = path.join(root, "codex");
    await fs.writeFile(
      commandPath,
      "#!/usr/bin/env node\nconsole.log(JSON.stringify(process.argv.slice(2)));\n",
      "utf8",
    );

    try {
      const target = await resolveSpawnTarget(commandPath, ["exec", "--json"], root, {
        PATH: root,
      }, { platform: "win32" });

      expect(target.command).toBe(process.execPath);
      expect(target.args).toEqual([commandPath, "exec", "--json"]);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
