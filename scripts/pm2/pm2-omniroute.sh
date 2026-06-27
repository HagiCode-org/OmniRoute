#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ACTION="${1:-start}"
shift || true
APPS=(omniroute-service)

run_for_each_app() {
  local pm2_action="$1"
  shift || true

  for app in "${APPS[@]}"; do
    case "$pm2_action" in
      restart)
        if ! bash "$ROOT_DIR/scripts/pm2/use-project-node.sh" pm2 restart "$app" --update-env "$@"; then
          bash "$ROOT_DIR/scripts/pm2/use-project-node.sh" pm2 delete "$app" "$@" >/dev/null 2>&1 || true
          bash "$ROOT_DIR/scripts/pm2/use-project-node.sh" pm2 start ecosystem.config.cjs --only "$app" "$@"
        fi
        ;;
      stop|delete)
        bash "$ROOT_DIR/scripts/pm2/use-project-node.sh" pm2 "$pm2_action" "$app" "$@" || true
        ;;
      *)
        bash "$ROOT_DIR/scripts/pm2/use-project-node.sh" pm2 "$pm2_action" "$app" "$@"
        ;;
    esac
  done
}

case "$ACTION" in
  start)
    bash "$ROOT_DIR/scripts/pm2/prepare-runtime.sh"
    exec bash "$ROOT_DIR/scripts/pm2/use-project-node.sh" pm2 start ecosystem.config.cjs "$@"
    ;;
  restart)
    bash "$ROOT_DIR/scripts/pm2/prepare-runtime.sh"
    run_for_each_app restart "$@"
    ;;
  stop)
    run_for_each_app stop "$@"
    ;;
  delete)
    run_for_each_app delete "$@"
    ;;
  logs)
    exec bash "$ROOT_DIR/scripts/pm2/use-project-node.sh" pm2 logs "${APPS[@]}" "$@"
    ;;
  save)
    exec bash "$ROOT_DIR/scripts/pm2/use-project-node.sh" pm2 save "$@"
    ;;
  status)
    for app in "${APPS[@]}"; do
      bash "$ROOT_DIR/scripts/pm2/use-project-node.sh" pm2 describe "$app" "$@" || true
    done
    ;;
  *)
    echo "Unsupported pm2 action: $ACTION" >&2
    echo "Supported actions: start, restart, stop, delete, logs, save, status" >&2
    exit 1
    ;;
esac
