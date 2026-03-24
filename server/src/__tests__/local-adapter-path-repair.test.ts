import { describe, expect, it } from "vitest";
import {
  canonicalizeLocalAdapterConfigPathsForPersistence,
  LocalAdapterPathValidationError,
  repairPersistedLocalAdapterConfigPaths,
  repairTaskSessionPathState,
} from "../local-adapter-paths.js";

const env = {
  PAPERCLIP_HOST_RUNTIME_PATH_MAPS: "/paperclip=D:\\new-projects\\paperclip\\data\\docker-paperclip",
} satisfies NodeJS.ProcessEnv;

describe("local adapter path repair helpers", () => {
  it("reverse-maps known host adapter config paths into canonical container paths", () => {
    const result = canonicalizeLocalAdapterConfigPathsForPersistence(
      "codex_local",
      {
        cwd: "D:\\new-projects\\paperclip\\data\\docker-paperclip\\repos\\product",
        instructionsRootPath: "D:\\new-projects\\paperclip\\data\\docker-paperclip\\instances\\default\\companies\\cmp\\agents\\a1\\instructions",
      },
      { env },
    );

    expect(result).toEqual(expect.objectContaining({
      cwd: "/paperclip/repos/product",
      instructionsRootPath: "/paperclip/instances/default/companies/cmp/agents/a1/instructions",
    }));
  });

  it("drops managed workspace cwd instead of persisting it", () => {
    const result = canonicalizeLocalAdapterConfigPathsForPersistence(
      "codex_local",
      {
        cwd: "D:\\new-projects\\paperclip\\data\\docker-paperclip\\instances\\default\\workspaces\\other-agent",
      },
      { env },
    );

    expect(result).toEqual({});
  });

  it("rejects unmapped Windows host paths", () => {
    expect(() =>
      canonicalizeLocalAdapterConfigPathsForPersistence(
        "codex_local",
        { cwd: "D:\\outside-maps\\repo" },
        { env },
      ),
    ).toThrow(LocalAdapterPathValidationError);
  });

  it("repairs mapped persisted config paths and drops managed workspace cwd", () => {
    const mapped = repairPersistedLocalAdapterConfigPaths(
      "codex_local",
      {
        cwd: "D:\\new-projects\\paperclip\\data\\docker-paperclip\\repos\\product",
      },
      { env, repairSource: "startup" },
    );
    const poisoned = repairPersistedLocalAdapterConfigPaths(
      "codex_local",
      {
        cwd: "D:\\new-projects\\paperclip\\data\\docker-paperclip\\instances\\default\\workspaces\\other-agent",
      },
      { env, repairSource: "startup" },
    );

    expect(mapped).toMatchObject({
      changed: true,
      normalizedKeys: ["cwd"],
      droppedKeys: [],
      adapterConfig: {
        cwd: "/paperclip/repos/product",
      },
    });
    expect(poisoned).toMatchObject({
      changed: true,
      normalizedKeys: [],
      droppedKeys: ["cwd"],
      adapterConfig: {},
    });
  });

  it("repairs or clears poisoned task sessions", () => {
    const mapped = repairTaskSessionPathState(
      {
        sessionId: "sess-1",
        cwd: "D:\\new-projects\\paperclip\\data\\docker-paperclip\\repos\\product",
      },
      "sess-1",
      {
        env,
        adapterType: "codex_local",
        repairSource: "startup",
      },
    );
    const poisoned = repairTaskSessionPathState(
      {
        sessionId: "sess-2",
        cwd: "D:\\new-projects\\paperclip\\data\\docker-paperclip\\instances\\default\\workspaces\\other-agent",
      },
      "sess-2",
      {
        env,
        adapterType: "codex_local",
        repairSource: "startup",
      },
    );

    expect(mapped).toMatchObject({
      changed: true,
      cleared: false,
      normalizedCwd: true,
      sessionParamsJson: {
        sessionId: "sess-1",
        cwd: "/paperclip/repos/product",
      },
      sessionDisplayId: "sess-1",
    });
    expect(poisoned).toMatchObject({
      changed: true,
      cleared: true,
      normalizedCwd: false,
      sessionParamsJson: null,
      sessionDisplayId: null,
    });
  });
});
