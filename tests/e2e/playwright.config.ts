import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "@playwright/test";

const PORT = Number(process.env.PAPERCLIP_E2E_PORT ?? 3100);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const CONFIG_DIR = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(CONFIG_DIR, ".paperclip-home");
const START_SERVER_SCRIPT = path.resolve(CONFIG_DIR, "start-server.mjs");

export default defineConfig({
  testDir: ".",
  testMatch: "**/*.spec.ts",
  timeout: 60_000,
  retries: 0,
  use: {
    baseURL: BASE_URL,
    headless: true,
    screenshot: "only-on-failure",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { browserName: "chromium" },
    },
  ],
  // The webServer directive starts `paperclipai run` before tests.
  // It bootstraps a fresh quickstart config in an isolated data dir before starting.
  webServer: {
    command: `node "${START_SERVER_SCRIPT}"`,
    url: `${BASE_URL}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      PORT: String(PORT),
      PAPERCLIP_E2E_DATA_DIR: DATA_DIR,
    },
  },
  outputDir: "./test-results",
  reporter: [["list"], ["html", { open: "never", outputFolder: "./playwright-report" }]],
});
