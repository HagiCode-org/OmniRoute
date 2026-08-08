#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

# shellcheck source=./common.sh
. "$ROOT_DIR/scripts/pm2/common.sh"

read_env_key_from_file() {
  local key="$1"
  local env_file="$ROOT_DIR/.env"
  if [[ ! -f "$env_file" ]]; then
    return 0
  fi

  grep -E "^${key}=" "$env_file" | tail -n 1 | cut -d'=' -f2- | tr -d '\r'
}

ensure_omniroute_pm2_dirs

cd "$ROOT_DIR"

if [[ ! -f "$ROOT_DIR/.env" ]]; then
  echo "[pm2] .env not found. Generating it from .env.example..."
fi
bash "$ROOT_DIR/scripts/pm2/use-project-node.sh" \
  node --input-type=module -e "const m = await import('./scripts/dev/sync-env.mjs'); m.syncEnv({ rootDir: process.cwd() });" \
  >/dev/null

if [[ -z "${OMNIROUTE_USE_TURBOPACK:-}" ]]; then
  OMNIROUTE_USE_TURBOPACK="$(read_env_key_from_file OMNIROUTE_USE_TURBOPACK || true)"
fi
if [[ -z "${OMNIROUTE_BUILD_MEMORY_MB:-}" ]]; then
  OMNIROUTE_BUILD_MEMORY_MB="$(read_env_key_from_file OMNIROUTE_BUILD_MEMORY_MB || true)"
fi
if [[ -z "${OMNIROUTE_PM2_USE_DEV:-}" ]]; then
  OMNIROUTE_PM2_USE_DEV="$(read_env_key_from_file OMNIROUTE_PM2_USE_DEV || true)"
fi

# Keep pm2 restarts deterministic even when env files are missing these keys.
export OMNIROUTE_USE_TURBOPACK="${OMNIROUTE_USE_TURBOPACK:-0}"
export OMNIROUTE_BUILD_MEMORY_MB="${OMNIROUTE_BUILD_MEMORY_MB:-8192}"
export OMNIROUTE_PM2_USE_DEV="${OMNIROUTE_PM2_USE_DEV:-0}"

if [[ "$OMNIROUTE_PM2_USE_DEV" == "1" ]]; then
  echo "[pm2] OMNIROUTE_PM2_USE_DEV=1 -> skipping production build preflight"
  exit 0
fi

if [[ ! -f "$ROOT_DIR/node_modules/next/package.json" ]]; then
  echo "[pm2] Dependencies are missing. Run 'npm install' in $ROOT_DIR first." >&2
  exit 1
fi

if [[ ! -f "$ROOT_DIR/.next/BUILD_ID" ]]; then
  echo "[pm2] Build artifacts not found. Running npm run build..."
  bash "$ROOT_DIR/scripts/pm2/use-project-node.sh" npm run build
fi
