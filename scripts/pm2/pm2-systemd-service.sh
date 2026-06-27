#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="${OMNIROUTE_ROOT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
ACTION="${1:-start}"

resolve_pm2_bin() {
  if [[ -n "${PM2_BIN:-}" && -x "${PM2_BIN:-}" ]]; then
    printf '%s\n' "$PM2_BIN"
    return 0
  fi

  if command -v pm2 >/dev/null 2>&1; then
    command -v pm2
    return 0
  fi

  return 1
}

PM2_CMD="$(resolve_pm2_bin || true)"
if [[ -z "$PM2_CMD" ]]; then
  echo "pm2 executable not found. Set PM2_BIN or ensure pm2 is on PATH." >&2
  exit 1
fi

cd "$ROOT_DIR"

case "$ACTION" in
  start)
    exec "$PM2_CMD" resurrect
    ;;
  reload)
    exec "$PM2_CMD" reload all --update-env
    ;;
  stop)
    exec "$PM2_CMD" kill
    ;;
  *)
    echo "Unsupported action: $ACTION" >&2
    echo "Supported actions: start, reload, stop" >&2
    exit 1
    ;;
esac
