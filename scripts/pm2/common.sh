#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
export ROOT_DIR
export OMNIROUTE_LOG_DIR="${OMNIROUTE_LOG_DIR:-$ROOT_DIR/logs}"
export OMNIROUTE_RUNTIME_DIR="${OMNIROUTE_RUNTIME_DIR:-$ROOT_DIR/runtime}"
export DATA_DIR="${DATA_DIR:-$ROOT_DIR/data}"
export HOST="${HOST:-0.0.0.0}"
export PORT="${PORT:-${OMNIROUTE_PORT:-36129}}"
export OMNIROUTE_PORT="${OMNIROUTE_PORT:-$PORT}"

default_base_url="http://localhost:${PORT}"
export BASE_URL="${BASE_URL:-$default_base_url}"
export NEXT_PUBLIC_BASE_URL="${NEXT_PUBLIC_BASE_URL:-$BASE_URL}"
export OMNIROUTE_BASE_URL="${OMNIROUTE_BASE_URL:-$BASE_URL}"

ensure_omniroute_pm2_dirs() {
  mkdir -p "$DATA_DIR" "$OMNIROUTE_LOG_DIR" "$OMNIROUTE_RUNTIME_DIR"
}
