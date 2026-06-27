#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

# shellcheck source=./common.sh
. "$ROOT_DIR/scripts/pm2/common.sh"

ensure_omniroute_pm2_dirs

cd "$ROOT_DIR"

if [[ ! -f "$ROOT_DIR/.env" ]]; then
  echo "[pm2] .env not found. Generating it from .env.example..."
fi
bash "$ROOT_DIR/scripts/pm2/use-project-node.sh" \
  node --input-type=module -e "const m = await import('./scripts/dev/sync-env.mjs'); m.syncEnv({ rootDir: process.cwd() });" \
  >/dev/null

if [[ ! -f "$ROOT_DIR/node_modules/next/package.json" ]]; then
  echo "[pm2] Dependencies are missing. Run 'npm install' in $ROOT_DIR first." >&2
  exit 1
fi

if [[ ! -f "$ROOT_DIR/.next/BUILD_ID" ]]; then
  echo "[pm2] Build artifacts not found. Running npm run build..."
  bash "$ROOT_DIR/scripts/pm2/use-project-node.sh" npm run build
fi
