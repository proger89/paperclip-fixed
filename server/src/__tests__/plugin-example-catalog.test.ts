import { describe, expect, it } from "vitest";
import { listBundledPluginExamples } from "../services/plugin-example-catalog.js";

describe("plugin example catalog", () => {
  it("includes bundled connector-capable examples that exist in the checkout", () => {
    const examples = listBundledPluginExamples();

    expect(examples).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          packageName: "@paperclipai/plugin-kitchen-sink-example",
          categories: expect.arrayContaining(["connector"]),
        }),
        expect.objectContaining({
          packageName: "@paperclipai/plugin-authoring-smoke-example",
          categories: ["connector"],
        }),
      ]),
    );
  });
});
