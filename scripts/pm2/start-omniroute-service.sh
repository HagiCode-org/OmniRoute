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

bash "$ROOT_DIR/scripts/pm2/prepare-runtime.sh"

cd "$ROOT_DIR"
echo "[pm2] starting OmniRoute on ${BASE_URL}"

if [[ -z "${OMNIROUTE_PM2_USE_DEV:-}" ]]; then
	OMNIROUTE_PM2_USE_DEV="$(read_env_key_from_file OMNIROUTE_PM2_USE_DEV || true)"
fi
export OMNIROUTE_PM2_USE_DEV="${OMNIROUTE_PM2_USE_DEV:-0}"

if [[ -z "${OMNIROUTE_SKIP_BOOT_DB_INIT:-}" ]]; then
	OMNIROUTE_SKIP_BOOT_DB_INIT="$(read_env_key_from_file OMNIROUTE_SKIP_BOOT_DB_INIT || true)"
fi
export OMNIROUTE_SKIP_BOOT_DB_INIT="${OMNIROUTE_SKIP_BOOT_DB_INIT:-0}"

if [[ "${OMNIROUTE_PM2_USE_DEV:-0}" == "1" ]]; then
	echo "[pm2] OMNIROUTE_PM2_USE_DEV=1 -> running npm run dev"
	exec bash "$ROOT_DIR/scripts/pm2/use-project-node.sh" npm run dev
fi

exec bash "$ROOT_DIR/scripts/pm2/use-project-node.sh" npm run start
