import { definePlugin, runWorker } from "@paperclipai/plugin-sdk";

const plugin = definePlugin({
  async setup(ctx) {
    ctx.logger.info("web-content-import plugin ready");
  },

  async onHealth() {
    return {
      status: "ok",
      message: "Web Content Import ready",
    };
  },
});

export default plugin;
runWorker(plugin, import.meta.url);
