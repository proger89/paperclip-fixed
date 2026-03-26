import { describe, expect, it } from "vitest";
import { listBundledPluginExamples, listBundledProductPlugins } from "../services/plugin-example-catalog.js";

describe("plugin example catalog", () => {
  it("returns product plugins without dev examples by default in the product catalog", () => {
    const examples = listBundledProductPlugins();

    expect(examples).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          packageName: "@paperclipai/plugin-telegram-publishing",
          categories: expect.arrayContaining(["connector"]),
        }),
        expect.objectContaining({
          packageName: "@paperclipai/plugin-telegram-operator-bot",
          categories: expect.arrayContaining(["connector"]),
        }),
        expect.objectContaining({
          packageName: "@paperclipai/plugin-author-voice-profiles",
          tag: "bundled",
          categories: expect.arrayContaining(["ui"]),
        }),
      ]),
    );
    expect(examples.find((plugin) => plugin.packageName === "@paperclipai/plugin-kitchen-sink-example")).toBeUndefined();
  });

  it("can still expose dev examples when explicitly requested", () => {
    const examples = listBundledPluginExamples({ includeDevOnly: true });

    expect(examples).toEqual(expect.arrayContaining([
      expect.objectContaining({
        packageName: "@paperclipai/plugin-kitchen-sink-example",
        categories: expect.arrayContaining(["connector"]),
      }),
      expect.objectContaining({
        packageName: "@paperclipai/plugin-authoring-smoke-example",
        categories: ["connector"],
      }),
    ]));
  });
});
