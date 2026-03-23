# Docker Quickstart

Run Paperclip in Docker without installing Node or pnpm locally.

## One-liner (build + run)

Direct single-container `docker run` is still useful for image debugging, but the recommended local runtime is Compose. Compose now starts a dedicated PostgreSQL container so Paperclip boots reliably on Docker Desktop for Windows instead of relying on embedded PostgreSQL inside a bind mount.

```sh
docker build -t paperclip-local . && \
docker run --name paperclip \
  -p 3100:3100 \
  -e HOST=0.0.0.0 \
  -e PAPERCLIP_HOME=/paperclip \
  -v "$(pwd)/data/docker-paperclip:/paperclip" \
  paperclip-local
```

Open: `http://127.0.0.1:3100`

Data persistence:

- uploaded assets
- local secrets key
- local agent workspace data

In Compose mode, Paperclip app data stays under your bind mount (`./data/docker-paperclip` by default) and PostgreSQL data stays under a host bind mount (`./data/docker-paperclip/postgres` by default).

## Compose Quickstart

```sh
docker compose -f docker-compose.quickstart.yml up --build
```

Defaults:

- host port: `3100`
- persistent data dir: `./data/docker-paperclip`
- persistent postgres dir: `./data/docker-paperclip/postgres`
- public URL default: `http://127.0.0.1:3100`
- Better Auth secret default: `paperclip-docker-dev-secret`
- sign-up mode default: `PAPERCLIP_AUTH_DISABLE_SIGN_UP=false`

Authenticated Docker note:

- `BETTER_AUTH_SECRET` is also sufficient for managed local agent JWT signing.
- `PAPERCLIP_AGENT_JWT_SECRET` is optional and only needed if you want a dedicated override separate from Better Auth.

On first startup in authenticated mode with sign-up enabled, the normal flow is now:

- open the app
- create an account
- create your first company
- invite other people into that company from company settings

If `OPENAI_API_KEY` is present in the container environment, the Docker entrypoint also runs `codex login --with-api-key` automatically so the `codex_local` adapter probe works without a separate manual login step inside the container.

If you intentionally run closed sign-up mode with `PAPERCLIP_AUTH_DISABLE_SIGN_UP=true`, the container keeps the legacy bootstrap flow and can still auto-generate a bootstrap CEO invite in logs.

Optional overrides:

```sh
PAPERCLIP_PORT=3200 PAPERCLIP_DATA_DIR=./data/pc PAPERCLIP_POSTGRES_DATA_DIR=./data/pc-postgres docker compose -f docker-compose.quickstart.yml up --build
```

If you change host port or use a non-local domain, set `PAPERCLIP_PUBLIC_URL` to the external URL you will use in browser/auth flows.
If host-executed agents must reach Paperclip at a different base URL than the browser uses, also set `PAPERCLIP_AGENT_API_URL`. Otherwise Paperclip falls back from `PAPERCLIP_AGENT_API_URL` to `PAPERCLIP_PUBLIC_URL`.

Persistence notes:

- `docker compose down` keeps both bind-mounted data directories.
- `docker compose down -v` removes Docker volumes, but it does not remove your bind-mounted Paperclip or Postgres directories.
- Data is deleted only if you remove the host directories yourself.
- Default host paths:
  - app/runtime data: `./data/docker-paperclip`
  - postgres data: `./data/docker-paperclip/postgres`

Migration from the old named volume layout:

```sh
mkdir -p ./data/docker-paperclip/postgres
docker run --rm -v paperclip_postgres_data:/from -v "$(pwd)/data/docker-paperclip/postgres:/to" alpine sh -lc 'cp -a /from/. /to/'
```

After that, switch to the current compose files and keep using the bind-mounted postgres directory.

## Hybrid Docker Mode

Use this when you want Paperclip itself in Docker, but `codex`, `claude`, or browser automation to stay on the host machine.

Start Paperclip:

```sh
docker compose -f docker-compose.hybrid.yml up --build
```

Hybrid Compose now also uses the dedicated `postgres` service by default, so it avoids the Windows bind-mount failure mode from embedded PostgreSQL.

Start the host bridge on the host machine:

Linux:

```sh
paperclipai host-runtime serve \
  --listen 0.0.0.0:4243 \
  --token "$PAPERCLIP_HOST_BRIDGE_TOKEN" \
  --path-map /paperclip=/absolute/host/paperclip-data \
  --path-map /workspace=/absolute/host/workspace \
  --capability codex \
  --capability claude \
  --capability browser
```

Windows PowerShell:

```powershell
paperclipai host-runtime serve `
  --listen 0.0.0.0:4243 `
  --token $env:PAPERCLIP_HOST_BRIDGE_TOKEN `
  --path-map /paperclip=C:\paperclip-data `
  --path-map /workspace=C:\workspace `
  --capability codex `
  --capability claude `
  --capability browser
```

Hybrid mode requirements:

- `docker-compose.hybrid.yml` defaults `PAPERCLIP_HOST_BRIDGE_TOKEN` to `paperclip-hybrid-dev-token` for local private use. Override it for any shared or non-local deployment.
- `docker-compose.hybrid.yml` also defaults `PAPERCLIP_LOCAL_ADAPTER_DEFAULT_EXECUTION_LOCATION=host`, so newly created local CLI agents use the host bridge unless you explicitly set `executionLocation`.
- Set `PAPERCLIP_HOST_BRIDGE_URL` if you do not want the default `http://host.docker.internal:4243`.
- Host-executed agents use the agent-facing URL contract: `PAPERCLIP_AGENT_API_URL` if set, otherwise `PAPERCLIP_PUBLIC_URL`, otherwise the internal listen URL. Set `PAPERCLIP_AGENT_API_URL` whenever the host bridge must reach Paperclip through a different hostname or port than the browser.
- Every path the host-executed adapter needs must be covered by a `--path-map` entry.
- Absolute `command`, `cwd`, env path values, and absolute path-like `extraArgs` entries are translated through the configured path maps before the host process starts.
- On Linux, `docker-compose.hybrid.yml` already adds `host.docker.internal:host-gateway`.
- If you want the host bridge to launch Playwright-managed browsers, install browser binaries on the host first with `npx playwright install chromium`.

Agent config for host-executed Codex or Claude:

```json
{
  "executionLocation": "host"
}
```

Existing hybrid local agents with a missing `executionLocation` are backfilled to `host` on container startup. Paperclip does not auto-resume paused agents after this repair; resume them explicitly from the board.

Example browser runtime service for a host-managed browser:

```json
{
  "services": [
    {
      "name": "browser",
      "location": "host",
      "lifecycle": "ephemeral",
      "browser": {
        "browserName": "chromium"
      }
    }
  ]
}
```

Paperclip injects these env vars into the adapter when a browser runtime is present:

- `PAPERCLIP_PLAYWRIGHT_WS_ENDPOINT`
- `PAPERCLIP_BROWSER_CDP_URL`

If the host bridge is down, Paperclip still boots normally. Only host-mode environment tests and host-mode runs fail.

### Hybrid Smoke Harness

Use the dedicated smoke harness when you want to validate the hybrid topology end to end from this repo:

```sh
bash ./scripts/docker-hybrid-smoke.sh
```

It does all of the following:

- starts `paperclipai host-runtime serve` on the host unless `HYBRID_SMOKE_START_BRIDGE=false`
- brings up `docker-compose.hybrid.yml`
- signs up a real user in authenticated mode
- only uses legacy bootstrap invite flow when `PAPERCLIP_AUTH_DISABLE_SIGN_UP=true`
- prepares a shared `/paperclip/hybrid-smoke` workspace for host-executed agent checks

Detached mode for Playwright or CI:

```sh
SMOKE_DETACH=true SMOKE_METADATA_FILE=/tmp/paperclip-hybrid.env bash ./scripts/docker-hybrid-smoke.sh
```

Then run the hybrid smoke spec:

```sh
set -a && source /tmp/paperclip-hybrid.env && set +a
PAPERCLIP_RELEASE_SMOKE_BASE_URL="$SMOKE_BASE_URL" \
PAPERCLIP_RELEASE_SMOKE_EMAIL="$SMOKE_ADMIN_EMAIL" \
PAPERCLIP_RELEASE_SMOKE_PASSWORD="$SMOKE_ADMIN_PASSWORD" \
PAPERCLIP_RELEASE_SMOKE_DATA_DIR="$SMOKE_DATA_DIR" \
PAPERCLIP_HYBRID_SMOKE_MODE="$SMOKE_HYBRID_MODE" \
pnpm run test:release-smoke:hybrid
```

To validate safe degradation without the host companion:

```sh
HYBRID_SMOKE_START_BRIDGE=false bash ./scripts/docker-hybrid-smoke.sh
```

In that mode the board should still boot and authenticated flows should still work, while host-mode adapter environment tests report `host_bridge_unavailable`.

## Authenticated Compose (Single Public URL)

For authenticated deployments, set one canonical public URL and let Paperclip derive auth/callback defaults:

```yaml
services:
  paperclip:
    environment:
      PAPERCLIP_DEPLOYMENT_MODE: authenticated
      PAPERCLIP_DEPLOYMENT_EXPOSURE: private
      PAPERCLIP_PUBLIC_URL: https://desk.koker.net
```

`PAPERCLIP_PUBLIC_URL` is used as the primary source for:

- auth public base URL
- Better Auth base URL defaults
- invite URL defaults
- hostname allowlist defaults (hostname extracted from URL)

Managed agent URL note:

- `PAPERCLIP_AGENT_API_URL` overrides the control-plane base URL injected into host/external agents.
- If `PAPERCLIP_AGENT_API_URL` is unset, managed agents fall back to `PAPERCLIP_PUBLIC_URL`.
- Use this when the browser/public URL and the agent-reachable URL differ.

Granular overrides remain available if needed (`PAPERCLIP_AUTH_PUBLIC_BASE_URL`, `BETTER_AUTH_URL`, `BETTER_AUTH_TRUSTED_ORIGINS`, `PAPERCLIP_ALLOWED_HOSTNAMES`).

Managed local/host agent note:

- In authenticated deployments, Paperclip injects `PAPERCLIP_API_KEY` into managed local and host-bridge runs.
- By default that agent auth token is signed with `BETTER_AUTH_SECRET`.
- Set `PAPERCLIP_AGENT_JWT_SECRET` only if you want to override that signer secret explicitly.

Set `PAPERCLIP_ALLOWED_HOSTNAMES` explicitly only when you need additional hostnames beyond the public URL host (for example Tailscale/LAN aliases or multiple private hostnames).

## Claude + Codex Local Adapters in Docker

The image pre-installs:

- `claude` (Anthropic Claude Code CLI)
- `codex` (OpenAI Codex CLI)

If you want local adapter runs inside the container, pass API keys when starting the container:

```sh
docker run --name paperclip \
  -p 3100:3100 \
  -e HOST=0.0.0.0 \
  -e PAPERCLIP_HOME=/paperclip \
  -e OPENAI_API_KEY=... \
  -e ANTHROPIC_API_KEY=... \
  -v "$(pwd)/data/docker-paperclip:/paperclip" \
  paperclip-local
```

Notes:

- Without API keys, the app still runs normally.
- Adapter environment checks in Paperclip will surface missing auth/CLI prerequisites.

## Optional Browser Sidecar

If you want a browser endpoint inside Docker without installing browser binaries in the main Paperclip image, start the optional sidecar profile:

```sh
docker compose -f docker-compose.hybrid.yml --profile browser up --build
```

Then point a browser runtime service at the sidecar endpoint:

```json
{
  "services": [
    {
      "name": "browser",
      "browser": {
        "cdpUrl": "http://playwright-browser:3000"
      }
    }
  ]
}
```

This keeps the main app image slim while still exposing browser connection details to adapters through the standard Paperclip browser env vars.

## Untrusted PR Review Container

If you want a separate Docker environment for reviewing untrusted pull requests with `codex` or `claude`, use the dedicated review workflow in `doc/UNTRUSTED-PR-REVIEW.md`.

That setup keeps CLI auth state in Docker volumes instead of your host home directory and uses a separate scratch workspace for PR checkouts and preview runs.

## Onboard Smoke Test (Ubuntu + npm only)

Use this when you want to mimic a fresh machine that only has Ubuntu + npm and verify:

- `npx paperclipai onboard --yes` completes
- the server binds to `0.0.0.0:3100` so host access works
- onboard/run banners and startup logs are visible in your terminal

Build + run:

```sh
./scripts/docker-onboard-smoke.sh
```

Open: `http://localhost:3131` (default smoke host port)

Useful overrides:

```sh
HOST_PORT=3200 PAPERCLIPAI_VERSION=latest ./scripts/docker-onboard-smoke.sh
PAPERCLIP_DEPLOYMENT_MODE=authenticated PAPERCLIP_DEPLOYMENT_EXPOSURE=private ./scripts/docker-onboard-smoke.sh
SMOKE_DETACH=true SMOKE_METADATA_FILE=/tmp/paperclip-smoke.env PAPERCLIPAI_VERSION=latest ./scripts/docker-onboard-smoke.sh
```

Notes:

- Persistent data is mounted at `./data/docker-onboard-smoke` by default.
- Container runtime user id defaults to your local `id -u` so the mounted data dir stays writable while avoiding root runtime.
- Smoke script defaults to `authenticated/private` mode so `HOST=0.0.0.0` can be exposed to the host.
- Smoke script defaults host port to `3131` to avoid conflicts with local Paperclip on `3100`.
- Smoke script also defaults `PAPERCLIP_PUBLIC_URL` to `http://localhost:<HOST_PORT>` so auth callbacks and invite links use the reachable host port instead of the container's internal `3100`.
- In authenticated mode with sign-up enabled, the smoke script signs up a real user and verifies board session access directly.
- If `PAPERCLIP_AUTH_DISABLE_SIGN_UP=true`, the smoke script falls back to the legacy bootstrap flow automatically.
- Run the script in the foreground to watch the onboarding flow; stop with `Ctrl+C` after validation.
- Set `SMOKE_DETACH=true` to leave the container running for automation and optionally write shell-ready metadata to `SMOKE_METADATA_FILE`.
- The image definition is in `Dockerfile.onboard-smoke`.
