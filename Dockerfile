FROM node:lts-trixie-slim AS base
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl git \
  && rm -rf /var/lib/apt/lists/*
RUN corepack enable

FROM base AS deps
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./
COPY cli/package.json cli/
COPY server/package.json server/
COPY ui/package.json ui/
COPY packages/shared/package.json packages/shared/
COPY packages/db/package.json packages/db/
COPY packages/adapter-utils/package.json packages/adapter-utils/
COPY packages/plugins/sdk/package.json packages/plugins/sdk/
COPY packages/plugins/create-paperclip-plugin/package.json packages/plugins/create-paperclip-plugin/
COPY packages/plugins/telegram-publishing/package.json packages/plugins/telegram-publishing/
COPY packages/plugins/telegram-operator-bot/package.json packages/plugins/telegram-operator-bot/
COPY packages/plugins/author-voice-profiles/package.json packages/plugins/author-voice-profiles/
COPY packages/plugins/web-content-import/package.json packages/plugins/web-content-import/
COPY packages/plugins/feed-sources/package.json packages/plugins/feed-sources/
COPY packages/plugins/examples/plugin-hello-world-example/package.json packages/plugins/examples/plugin-hello-world-example/
COPY packages/plugins/examples/plugin-file-browser-example/package.json packages/plugins/examples/plugin-file-browser-example/
COPY packages/plugins/examples/plugin-kitchen-sink-example/package.json packages/plugins/examples/plugin-kitchen-sink-example/
COPY packages/plugins/examples/plugin-authoring-smoke-example/package.json packages/plugins/examples/plugin-authoring-smoke-example/
COPY packages/adapters/claude-local/package.json packages/adapters/claude-local/
COPY packages/adapters/codex-local/package.json packages/adapters/codex-local/
COPY packages/adapters/cursor-local/package.json packages/adapters/cursor-local/
COPY packages/adapters/gemini-local/package.json packages/adapters/gemini-local/
COPY packages/adapters/openclaw-gateway/package.json packages/adapters/openclaw-gateway/
COPY packages/adapters/opencode-local/package.json packages/adapters/opencode-local/
COPY packages/adapters/pi-local/package.json packages/adapters/pi-local/

RUN pnpm install --frozen-lockfile

FROM base AS build
WORKDIR /app
COPY --from=deps /app /app
COPY . .
RUN node scripts/clean-build-artifacts.mjs
RUN pnpm --filter @paperclipai/server clean
RUN pnpm --filter @paperclipai/ui build
RUN pnpm --filter @paperclipai/plugin-sdk build
RUN pnpm --filter @paperclipai/plugin-hello-world-example build
RUN pnpm --filter @paperclipai/plugin-file-browser-example build
RUN pnpm --filter @paperclipai/plugin-kitchen-sink-example build
RUN pnpm --filter @paperclipai/plugin-authoring-smoke-example build
RUN pnpm --filter @paperclipai/plugin-telegram-publishing build
RUN pnpm --filter @paperclipai/plugin-telegram-operator-bot build
RUN pnpm --filter @paperclipai/plugin-author-voice-profiles build
RUN pnpm --filter @paperclipai/plugin-web-content-import build
RUN pnpm --filter @paperclipai/plugin-feed-sources build
RUN pnpm --filter @paperclipai/server build
RUN node scripts/verify-docker-runtime-build.mjs
RUN test -f server/dist/index.js || (echo "ERROR: server build output missing" && exit 1)

FROM base AS production
WORKDIR /app
COPY --chown=node:node --from=build /app /app
RUN for attempt in 1 2 3; do \
    npm install --global --omit=dev @anthropic-ai/claude-code@latest @openai/codex@latest opencode-ai && break; \
    if [ "$attempt" -eq 3 ]; then exit 1; fi; \
    sleep 5; \
  done \
  && mkdir -p /paperclip \
  && chown node:node /paperclip

ENV NODE_ENV=production \
  HOME=/paperclip \
  HOST=0.0.0.0 \
  PORT=3100 \
  SERVE_UI=true \
  PAPERCLIP_HOME=/paperclip \
  PAPERCLIP_INSTANCE_ID=default \
  PAPERCLIP_CONFIG=/paperclip/instances/default/config.json \
  PAPERCLIP_DEPLOYMENT_MODE=authenticated \
  PAPERCLIP_DEPLOYMENT_EXPOSURE=private

VOLUME ["/paperclip"]
EXPOSE 3100

USER node
CMD ["node", "scripts/docker-entrypoint.mjs"]
