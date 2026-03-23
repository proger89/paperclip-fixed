import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveUiDevMiddleware } from "../config.ts";

function createExists(paths: string[]) {
  const set = new Set(paths.map((entry) => path.resolve(entry)));
  return (candidate: string) => set.has(path.resolve(candidate));
}

describe("resolveUiDevMiddleware", () => {
  it("forces vite middleware on when PAPERCLIP_UI_DEV_MIDDLEWARE=true", () => {
    const cwd = path.resolve("paperclip-repo", "server");

    const result = resolveUiDevMiddleware({
      envValue: "true",
      argv: ["node", "dist/index.js"],
      cwd,
      fileExists: createExists([]),
    });

    expect(result.enabled).toBe(true);
    expect(result.source).toBe("env");
    expect(result.repoLocalUiSourcePath).toBeNull();
  });

  it("forces static ui when PAPERCLIP_UI_DEV_MIDDLEWARE=false", () => {
    const cwd = path.resolve("paperclip-repo", "server");
    const uiIndexPath = path.resolve(cwd, "..", "ui", "index.html");

    const result = resolveUiDevMiddleware({
      envValue: "false",
      argv: ["node", "src/index.ts"],
      cwd,
      fileExists: createExists([uiIndexPath]),
    });

    expect(result.enabled).toBe(false);
    expect(result.source).toBe("env");
    expect(result.repoLocalDevServerInvocation).toBe(true);
    expect(result.repoLocalUiSourcePath).toBe(uiIndexPath);
  });

  it("auto-enables vite middleware for repo-local source server runs when ui source exists", () => {
    const cwd = path.resolve("paperclip-repo", "server");
    const uiIndexPath = path.resolve(cwd, "..", "ui", "index.html");

    const result = resolveUiDevMiddleware({
      argv: ["node", "src/index.ts"],
      cwd,
      fileExists: createExists([uiIndexPath]),
    });

    expect(result.enabled).toBe(true);
    expect(result.source).toBe("auto");
    expect(result.repoLocalDevServerInvocation).toBe(true);
    expect(result.repoLocalUiSourcePath).toBe(uiIndexPath);
  });

  it("keeps static ui for production-style runs even when local ui source exists", () => {
    const cwd = path.resolve("paperclip-repo", "server");
    const uiIndexPath = path.resolve(cwd, "..", "ui", "index.html");

    const result = resolveUiDevMiddleware({
      argv: ["node", "dist/index.js"],
      cwd,
      fileExists: createExists([uiIndexPath]),
    });

    expect(result.enabled).toBe(false);
    expect(result.source).toBe("default");
    expect(result.repoLocalDevServerInvocation).toBe(false);
    expect(result.repoLocalUiSourcePath).toBe(uiIndexPath);
  });

  it("keeps static ui when the repo-local ui source tree is absent", () => {
    const cwd = path.resolve("paperclip-repo", "server");

    const result = resolveUiDevMiddleware({
      argv: ["node", "src/index.ts"],
      cwd,
      fileExists: createExists([]),
    });

    expect(result.enabled).toBe(false);
    expect(result.source).toBe("default");
    expect(result.repoLocalDevServerInvocation).toBe(true);
    expect(result.repoLocalUiSourcePath).toBeNull();
  });
});
