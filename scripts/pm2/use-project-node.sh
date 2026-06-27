#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PROJECT_NODE_VERSION="${OMNIROUTE_NODE_VERSION:-$(tr -d '[:space:]' < "$ROOT_DIR/.nvmrc")}"
NVM_DIR="${NVM_DIR:-$HOME/.nvm}"

load_nvm() {
  unset npm_config_prefix
  unset NPM_CONFIG_PREFIX

  if [[ ! -s "$NVM_DIR/nvm.sh" ]]; then
    echo "nvm is required but was not found at $NVM_DIR/nvm.sh" >&2
    echo "Please install nvm first, then rerun the command." >&2
    exit 1
  fi

  # shellcheck source=/dev/null
  . "$NVM_DIR/nvm.sh"
}

use_project_node() {
  load_nvm

  if nvm use "$PROJECT_NODE_VERSION" >/dev/null 2>&1; then
    nvm use "$PROJECT_NODE_VERSION" >/dev/null
    return
  fi

  nvm install "$PROJECT_NODE_VERSION" >/dev/null
  nvm use "$PROJECT_NODE_VERSION" >/dev/null
}

use_project_node

if [[ $# -eq 0 ]]; then
  echo "Using Node $(node -v)"
  echo "Using npm $(npm -v)"
  exit 0
fi

exec "$@"
