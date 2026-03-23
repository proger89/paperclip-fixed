import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "../..");
const dataDir = process.env.PAPERCLIP_E2E_DATA_DIR
  ? path.resolve(process.env.PAPERCLIP_E2E_DATA_DIR)
  : path.resolve(scriptDir, ".paperclip-home");
const pnpmExecutable = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

fs.rmSync(dataDir, { recursive: true, force: true });

const child = spawn(
  pnpmExecutable,
  ["paperclipai", "onboard", "-y", "--run", "-d", dataDir],
  {
    cwd: repoRoot,
    stdio: "inherit",
    shell: process.platform === "win32",
    env: {
      ...process.env,
      PAPERCLIP_E2E_DATA_DIR: dataDir,
    },
  },
);

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
