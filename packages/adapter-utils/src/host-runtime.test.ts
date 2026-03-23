import { describe, expect, it } from "vitest";
import {
  parseHostRuntimePathMap,
  translateMappedPath,
  translatePathBearingValue,
} from "./host-runtime.js";

describe("host runtime path mapping", () => {
  it("uses the longest matching prefix when translating container paths to host paths", () => {
    const maps = [
      { containerPath: "/workspace", hostPath: "C:\\repo" },
      { containerPath: "/workspace/project", hostPath: "D:\\project" },
    ];

    expect(
      translateMappedPath("/workspace/project/src/index.ts", maps, "container_to_host", {
        throwOnUnmapped: true,
        platform: "win32",
      }),
    ).toBe("D:\\project\\src/index.ts");
  });

  it("throws for unmapped absolute paths when strict translation is requested", () => {
    const maps = [parseHostRuntimePathMap("/workspace=C:\\repo")];
    expect(() =>
      translateMappedPath("/outside/file.txt", maps, "container_to_host", {
        throwOnUnmapped: true,
        platform: "win32",
      }),
    ).toThrow(/outside configured host-runtime path maps/i);
  });

  it("translates nested path-bearing structures and JSON payloads", () => {
    const maps = [parseHostRuntimePathMap("/workspace=/srv/repo")];
    const translated = translatePathBearingValue(
      {
        cwd: "/workspace/app",
        env: {
          PAPERCLIP_WORKSPACE_CWD: "/workspace/app",
          PAPERCLIP_RUNTIME_SERVICES_JSON: JSON.stringify([
            { cwd: "/workspace/app/browser-profile", serviceName: "browser" },
          ]),
        },
      },
      maps,
      "container_to_host",
      {
        throwOnUnmapped: true,
        platform: "linux",
      },
    );

    expect(translated).toEqual({
      cwd: "/srv/repo/app",
      env: {
        PAPERCLIP_WORKSPACE_CWD: "/srv/repo/app",
        PAPERCLIP_RUNTIME_SERVICES_JSON: JSON.stringify([
          { cwd: "/srv/repo/app/browser-profile", serviceName: "browser" },
        ]),
      },
    });
  });

  it("translates absolute command paths and extraArgs path values", () => {
    const maps = [parseHostRuntimePathMap("/paperclip=C:\\paperclip-data")];
    const translated = translatePathBearingValue(
      {
        command: "/paperclip/hybrid-smoke/fake-codex.mjs",
        extraArgs: [
          "/paperclip/hybrid-smoke/fake-codex.mjs",
          "--json",
          "/c",
        ],
      },
      maps,
      "container_to_host",
      {
        throwOnUnmapped: true,
        platform: "win32",
      },
    );

    expect(translated).toEqual({
      command: "C:\\paperclip-data\\hybrid-smoke\\fake-codex.mjs",
      extraArgs: [
        "C:\\paperclip-data\\hybrid-smoke\\fake-codex.mjs",
        "--json",
        "/c",
      ],
    });
  });

  it("translates paperclip runtime skill source paths for host execution", () => {
    const maps = [parseHostRuntimePathMap("/app=D:\\new-projects\\paperclip")];
    const translated = translatePathBearingValue(
      {
        paperclipRuntimeSkills: [
          {
            key: "paperclipai/paperclip/paperclip",
            runtimeName: "paperclip",
            source: "/app/skills/paperclip",
          },
        ],
      },
      maps,
      "container_to_host",
      {
        throwOnUnmapped: true,
        platform: "win32",
      },
    );

    expect(translated).toEqual({
      paperclipRuntimeSkills: [
        {
          key: "paperclipai/paperclip/paperclip",
          runtimeName: "paperclip",
          source: "D:\\new-projects\\paperclip\\skills\\paperclip",
        },
      ],
    });
  });
});
