import { definePlugin, runWorker } from "@paperclipai/plugin-sdk";

const plugin = definePlugin({
  async setup(ctx) {
    ctx.logger.info("feed-sources plugin ready");
  },

  async onHealth() {
    return {
      status: "ok",
      message: "Feed Sources ready",
    };
  },
});

export default plugin;
runWorker(plugin, import.meta.url);
