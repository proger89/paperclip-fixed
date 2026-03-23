#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
COMPOSE_FILE="$REPO_ROOT/docker-compose.hybrid.yml"
HOST_PORT="${HOST_PORT:-3242}"
HOST_BRIDGE_PORT="${HOST_BRIDGE_PORT:-4243}"
DATA_DIR="${DATA_DIR:-$REPO_ROOT/data/docker-hybrid-smoke}"
SMOKE_DETACH="${SMOKE_DETACH:-false}"
SMOKE_METADATA_FILE="${SMOKE_METADATA_FILE:-}"
HYBRID_SMOKE_START_BRIDGE="${HYBRID_SMOKE_START_BRIDGE:-true}"
HYBRID_SMOKE_ENABLE_BROWSER_PROFILE="${HYBRID_SMOKE_ENABLE_BROWSER_PROFILE:-false}"
PAPERCLIP_PUBLIC_URL="${PAPERCLIP_PUBLIC_URL:-http://127.0.0.1:${HOST_PORT}}"
BETTER_AUTH_SECRET="${BETTER_AUTH_SECRET:-paperclip-hybrid-smoke-secret}"
PAPERCLIP_HOST_BRIDGE_TOKEN="${PAPERCLIP_HOST_BRIDGE_TOKEN:-paperclip-hybrid-smoke-token}"
SMOKE_ADMIN_NAME="${SMOKE_ADMIN_NAME:-Smoke Admin}"
SMOKE_ADMIN_EMAIL="${SMOKE_ADMIN_EMAIL:-smoke-admin@paperclip.local}"
SMOKE_ADMIN_PASSWORD="${SMOKE_ADMIN_PASSWORD:-paperclip-smoke-password}"
COMPOSE_PROJECT="${COMPOSE_PROJECT:-paperclip-hybrid-smoke}"
HOST_BRIDGE_LOG_FILE="${HOST_BRIDGE_LOG_FILE:-$DATA_DIR/host-runtime.log}"
TMP_DIR=""
COOKIE_JAR=""
BRIDGE_PID=""
PRESERVE_STACK_ON_EXIT="false"

mkdir -p "$DATA_DIR"

cleanup() {
  if [[ "$PRESERVE_STACK_ON_EXIT" != "true" ]]; then
    if [[ -n "$BRIDGE_PID" ]]; then
      kill "$BRIDGE_PID" >/dev/null 2>&1 || true
      wait "$BRIDGE_PID" >/dev/null 2>&1 || true
    fi
    docker compose -p "$COMPOSE_PROJECT" -f "$COMPOSE_FILE" down -v >/dev/null 2>&1 || true
  fi
  if [[ -n "$TMP_DIR" && -d "$TMP_DIR" ]]; then
    rm -rf "$TMP_DIR"
  fi
}

trap cleanup EXIT INT TERM

wait_for_http() {
  local url="$1"
  local attempts="${2:-90}"
  local sleep_seconds="${3:-1}"
  local i
  for ((i = 1; i <= attempts; i += 1)); do
    if curl -fsS "$url" >/dev/null 2>&1; then
      return 0
    fi
    sleep "$sleep_seconds"
  done
  return 1
}

wait_for_bridge_health() {
  local url="$1"
  local token="$2"
  local attempts="${3:-60}"
  local sleep_seconds="${4:-1}"
  local i
  for ((i = 1; i <= attempts; i += 1)); do
    if curl -fsS -H "Authorization: Bearer $token" "$url" >/dev/null 2>&1; then
      return 0
    fi
    if [[ -n "$BRIDGE_PID" ]] && ! kill -0 "$BRIDGE_PID" >/dev/null 2>&1; then
      echo "Hybrid smoke failed: host bridge exited before becoming ready" >&2
      if [[ -f "$HOST_BRIDGE_LOG_FILE" ]]; then
        cat "$HOST_BRIDGE_LOG_FILE" >&2 || true
      fi
      return 1
    fi
    sleep "$sleep_seconds"
  done
  return 1
}

compose_service_running() {
  local service="$1"
  local container_id
  container_id="$(docker compose -p "$COMPOSE_PROJECT" -f "$COMPOSE_FILE" ps -q "$service" 2>/dev/null || true)"
  if [[ -z "$container_id" ]]; then
    return 1
  fi
  local running
  running="$(docker inspect -f '{{.State.Running}}' "$container_id" 2>/dev/null || true)"
  [[ "$running" == "true" ]]
}

wait_for_stack_health() {
  local url="$1"
  local attempts="${2:-120}"
  local sleep_seconds="${3:-1}"
  local i
  for ((i = 1; i <= attempts; i += 1)); do
    if curl -fsS "$url" >/dev/null 2>&1; then
      return 0
    fi
    if ! compose_service_running paperclip; then
      echo "Hybrid smoke failed: paperclip container exited before readiness" >&2
      docker compose -p "$COMPOSE_PROJECT" -f "$COMPOSE_FILE" logs paperclip >&2 || true
      return 1
    fi
    sleep "$sleep_seconds"
  done
  return 1
}

write_metadata_file() {
  if [[ -z "$SMOKE_METADATA_FILE" ]]; then
    return 0
  fi
  mkdir -p "$(dirname "$SMOKE_METADATA_FILE")"
  {
    printf 'SMOKE_BASE_URL=%q\n' "$PAPERCLIP_PUBLIC_URL"
    printf 'SMOKE_ADMIN_EMAIL=%q\n' "$SMOKE_ADMIN_EMAIL"
    printf 'SMOKE_ADMIN_PASSWORD=%q\n' "$SMOKE_ADMIN_PASSWORD"
    printf 'SMOKE_DATA_DIR=%q\n' "$DATA_DIR"
    printf 'SMOKE_COMPOSE_PROJECT=%q\n' "$COMPOSE_PROJECT"
    printf 'SMOKE_HOST_BRIDGE_PORT=%q\n' "$HOST_BRIDGE_PORT"
    printf 'SMOKE_HOST_BRIDGE_TOKEN=%q\n' "$PAPERCLIP_HOST_BRIDGE_TOKEN"
    printf 'SMOKE_HOST_BRIDGE_LOG_FILE=%q\n' "$HOST_BRIDGE_LOG_FILE"
    printf 'SMOKE_HYBRID_MODE=%q\n' "$([[ "$HYBRID_SMOKE_START_BRIDGE" == "true" ]] && echo available || echo missing)"
    printf 'SMOKE_BRIDGE_PID=%q\n' "$BRIDGE_PID"
  } >"$SMOKE_METADATA_FILE"
}

generate_bootstrap_invite_url() {
  local bootstrap_output
  local bootstrap_status
  if bootstrap_output="$(
    docker compose -p "$COMPOSE_PROJECT" -f "$COMPOSE_FILE" exec -T paperclip sh -lc \
      'timeout 20s node cli/node_modules/tsx/dist/cli.mjs cli/src/index.ts auth bootstrap-ceo --data-dir "$PAPERCLIP_HOME" --base-url "$PAPERCLIP_PUBLIC_URL"' \
      2>&1
  )"; then
    bootstrap_status=0
  else
    bootstrap_status=$?
  fi

  if [[ $bootstrap_status -ne 0 && $bootstrap_status -ne 124 ]]; then
    echo "Hybrid smoke failed: bootstrap-ceo command failed inside compose stack" >&2
    printf '%s\n' "$bootstrap_output" >&2
    return 1
  fi

  local invite_url
  invite_url="$(
    printf '%s\n' "$bootstrap_output" \
      | grep -o 'https\?://[^[:space:]]*/invite/pcp_bootstrap_[[:alnum:]]*' \
      | tail -n 1
  )"
  if [[ -z "$invite_url" ]]; then
    echo "Hybrid smoke failed: bootstrap-ceo did not print an invite URL" >&2
    printf '%s\n' "$bootstrap_output" >&2
    return 1
  fi
  printf '%s\n' "$invite_url"
}

post_json_with_cookies() {
  local url="$1"
  local body="$2"
  local output_file="$3"
  curl -sS \
    -o "$output_file" \
    -w "%{http_code}" \
    -c "$COOKIE_JAR" \
    -b "$COOKIE_JAR" \
    -H "Content-Type: application/json" \
    -H "Origin: $PAPERCLIP_PUBLIC_URL" \
    -X POST \
    "$url" \
    --data "$body"
}

get_with_cookies() {
  local url="$1"
  curl -fsS \
    -c "$COOKIE_JAR" \
    -b "$COOKIE_JAR" \
    -H "Accept: application/json" \
    "$url"
}

sign_up_or_sign_in() {
  local signup_response="$TMP_DIR/signup.json"
  local signup_status
  signup_status="$(post_json_with_cookies \
    "$PAPERCLIP_PUBLIC_URL/api/auth/sign-up/email" \
    "{\"name\":\"$SMOKE_ADMIN_NAME\",\"email\":\"$SMOKE_ADMIN_EMAIL\",\"password\":\"$SMOKE_ADMIN_PASSWORD\"}" \
    "$signup_response")"
  if [[ "$signup_status" =~ ^2 ]]; then
    return 0
  fi

  local signin_response="$TMP_DIR/signin.json"
  local signin_status
  signin_status="$(post_json_with_cookies \
    "$PAPERCLIP_PUBLIC_URL/api/auth/sign-in/email" \
    "{\"email\":\"$SMOKE_ADMIN_EMAIL\",\"password\":\"$SMOKE_ADMIN_PASSWORD\"}" \
    "$signin_response")"
  if [[ "$signin_status" =~ ^2 ]]; then
    return 0
  fi

  echo "Hybrid smoke failed: could not sign up or sign in admin user" >&2
  echo "Sign-up response:" >&2
  cat "$signup_response" >&2 || true
  echo >&2
  echo "Sign-in response:" >&2
  cat "$signin_response" >&2 || true
  echo >&2
  return 1
}

bootstrap_authenticated_mode() {
  local health_json
  health_json="$(curl -fsS "$PAPERCLIP_PUBLIC_URL/api/health")"
  if [[ "$health_json" != *'"deploymentMode":"authenticated"'* ]]; then
    return 0
  fi

  sign_up_or_sign_in

  if [[ "$health_json" == *'"bootstrapStatus":"ready"'* ]]; then
    return 0
  fi

  local invite_url
  invite_url="$(generate_bootstrap_invite_url)"
  local invite_token="${invite_url##*/}"
  local accept_response="$TMP_DIR/accept.json"
  local accept_status
  accept_status="$(post_json_with_cookies \
    "$PAPERCLIP_PUBLIC_URL/api/invites/$invite_token/accept" \
    '{"requestType":"human"}' \
    "$accept_response")"
  if [[ ! "$accept_status" =~ ^2 ]]; then
    echo "Hybrid smoke failed: bootstrap invite acceptance returned HTTP $accept_status" >&2
    cat "$accept_response" >&2 || true
    echo >&2
    return 1
  fi
}

prepare_hybrid_host_runtime_files() {
  local smoke_root="$DATA_DIR/hybrid-smoke"
  mkdir -p "$smoke_root/workspace"
  cat >"$smoke_root/fake-codex.mjs" <<'EOF'
#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const capturePath = process.env.PAPERCLIP_TEST_CAPTURE_PATH || "";
const payload = {
  cwd: process.cwd(),
  argv: process.argv.slice(2),
  paperclipApiUrl: process.env.PAPERCLIP_API_URL || null,
  playwrightWsEndpoint: process.env.PAPERCLIP_PLAYWRIGHT_WS_ENDPOINT || null,
  browserCdpUrl: process.env.PAPERCLIP_BROWSER_CDP_URL || null,
};

if (capturePath) {
  fs.mkdirSync(path.dirname(capturePath), { recursive: true });
  fs.writeFileSync(capturePath, JSON.stringify(payload, null, 2), "utf8");
}

console.log(JSON.stringify({ type: "thread.started", thread_id: "hybrid-smoke-thread" }));
console.log(
  JSON.stringify({
    type: "item.completed",
    item: {
      type: "agent_message",
      text: payload.playwrightWsEndpoint ? "Hybrid host runtime ok" : "Hybrid host runtime missing browser endpoint",
    },
  }),
);
console.log(
  JSON.stringify({
    type: "turn.completed",
    usage: { input_tokens: 1, cached_input_tokens: 0, output_tokens: 1 },
  }),
);
EOF
  chmod +x "$smoke_root/fake-codex.mjs"
}

resolve_node_command() {
  if command -v node >/dev/null 2>&1; then
    command -v node
    return 0
  fi
  if command -v node.exe >/dev/null 2>&1; then
    command -v node.exe
    return 0
  fi
  echo "Hybrid smoke failed: node is not available on PATH" >&2
  return 1
}

start_host_bridge_if_needed() {
  if [[ "$HYBRID_SMOKE_START_BRIDGE" != "true" ]]; then
    return 0
  fi

  local node_cmd
  node_cmd="$(resolve_node_command)"
  mkdir -p "$(dirname "$HOST_BRIDGE_LOG_FILE")"
  : >"$HOST_BRIDGE_LOG_FILE"
  (
    cd "$REPO_ROOT"
    "$node_cmd" cli/node_modules/tsx/dist/cli.mjs cli/src/index.ts host-runtime serve \
      --listen "127.0.0.1:${HOST_BRIDGE_PORT}" \
      --token "$PAPERCLIP_HOST_BRIDGE_TOKEN" \
      --path-map "/paperclip=${DATA_DIR}" \
      --capability codex \
      --capability claude \
      --capability browser
  ) >"$HOST_BRIDGE_LOG_FILE" 2>&1 &
  BRIDGE_PID=$!

  if ! wait_for_bridge_health "http://127.0.0.1:${HOST_BRIDGE_PORT}/health" "$PAPERCLIP_HOST_BRIDGE_TOKEN" 60 1; then
    echo "Hybrid smoke failed: host bridge did not become ready" >&2
    cat "$HOST_BRIDGE_LOG_FILE" >&2 || true
    return 1
  fi
}

echo "==> Preparing hybrid smoke workspace"
prepare_hybrid_host_runtime_files

echo "==> Starting host bridge (${HYBRID_SMOKE_START_BRIDGE})"
start_host_bridge_if_needed

echo "==> Starting hybrid Docker stack"
export PAPERCLIP_PORT="$HOST_PORT"
export PAPERCLIP_DATA_DIR="$DATA_DIR"
export PAPERCLIP_PUBLIC_URL
export BETTER_AUTH_SECRET
export PAPERCLIP_HOST_BRIDGE_URL="http://host.docker.internal:${HOST_BRIDGE_PORT}"
export PAPERCLIP_HOST_BRIDGE_TOKEN

docker compose -p "$COMPOSE_PROJECT" -f "$COMPOSE_FILE" down -v >/dev/null 2>&1 || true
if [[ "$HYBRID_SMOKE_ENABLE_BROWSER_PROFILE" == "true" ]]; then
  docker compose -p "$COMPOSE_PROJECT" -f "$COMPOSE_FILE" --profile browser up -d --build
else
  docker compose -p "$COMPOSE_PROJECT" -f "$COMPOSE_FILE" up -d --build
fi

TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/paperclip-hybrid-smoke.XXXXXX")"
COOKIE_JAR="$TMP_DIR/cookies.txt"

if ! wait_for_stack_health "$PAPERCLIP_PUBLIC_URL/api/health" 120 1; then
  echo "Hybrid smoke failed: paperclip stack did not become ready" >&2
  docker compose -p "$COMPOSE_PROJECT" -f "$COMPOSE_FILE" logs >&2 || true
  exit 1
fi

bootstrap_authenticated_mode
write_metadata_file

if [[ "$SMOKE_DETACH" == "true" ]]; then
  PRESERVE_STACK_ON_EXIT="true"
  echo "==> Hybrid smoke stack ready"
  echo "    Base URL: $PAPERCLIP_PUBLIC_URL"
  echo "    Hybrid mode: $([[ "$HYBRID_SMOKE_START_BRIDGE" == "true" ]] && echo available || echo missing)"
  if [[ -n "$SMOKE_METADATA_FILE" ]]; then
    echo "    Metadata file: $SMOKE_METADATA_FILE"
  fi
  exit 0
fi

echo "==> Hybrid smoke stack is running. Press Ctrl+C to stop."
docker compose -p "$COMPOSE_PROJECT" -f "$COMPOSE_FILE" logs -f
