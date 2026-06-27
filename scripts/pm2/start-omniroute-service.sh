#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

# shellcheck source=./common.sh
. "$ROOT_DIR/scripts/pm2/common.sh"

bash "$ROOT_DIR/scripts/pm2/prepare-runtime.sh"

cd "$ROOT_DIR"
echo "[pm2] starting OmniRoute on ${BASE_URL}"
exec bash "$ROOT_DIR/scripts/pm2/use-project-node.sh" npm run start
