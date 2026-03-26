import { definePlugin, runWorker } from "@paperclipai/plugin-sdk";

const plugin = definePlugin({
  async setup(ctx) {
    ctx.logger.info("author-voice-profiles plugin ready");
  },

  async onHealth() {
    return {
      status: "ok",
      message: "Author Voice Profiles ready",
    };
  },
});

export default plugin;
runWorker(plugin, import.meta.url);
