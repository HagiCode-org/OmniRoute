#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CURRENT_USER="${OMNIROUTE_SYSTEMD_USER:-$(id -un)}"
CURRENT_HOME="${OMNIROUTE_SYSTEMD_HOME:-$HOME}"
PM2_HOME_DIR="${PM2_HOME:-$CURRENT_HOME/.pm2}"
NVM_HOME="${NVM_DIR:-$CURRENT_HOME/.nvm}"
SERVICE_NAME="${OMNIROUTE_SYSTEMD_SERVICE_NAME:-pm2-$CURRENT_USER}"
INSTALL_MODE=false
PM2_BIN_OVERRIDE="${OMNIROUTE_PM2_BIN:-${PM2_BIN:-}}"

print_usage() {
  cat <<EOF
Usage: $(basename "$0") [--install] [--print] [--service-name NAME]

Options:
  --install             Install/update the systemd unit with sudo, enable it, and restart it
  --print               Print the generated unit file to stdout (default)
  --service-name NAME   Override the generated service name (default: $SERVICE_NAME)
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --install)
      INSTALL_MODE=true
      shift
      ;;
    --print)
      INSTALL_MODE=false
      shift
      ;;
    --service-name)
      if [[ $# -lt 2 ]]; then
        echo "--service-name requires a value" >&2
        exit 1
      fi
      SERVICE_NAME="$2"
      shift 2
      ;;
    -h|--help)
      print_usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      print_usage >&2
      exit 1
      ;;
  esac
done

if [[ -n "$PM2_BIN_OVERRIDE" ]]; then
  PM2_BIN="$PM2_BIN_OVERRIDE"
elif ! PM2_BIN="$(command -v pm2 2>/dev/null)"; then
  echo "pm2 not found in PATH. Install pm2 first, then rerun this script." >&2
  exit 1
fi

PM2_BIN_DIR="$(dirname "$PM2_BIN")"
UNIT_PATH="/etc/systemd/system/$SERVICE_NAME.service"
TMP_UNIT="$(mktemp)"
trap 'rm -f "$TMP_UNIT"' EXIT

cat >"$TMP_UNIT" <<EOF
[Unit]
Description=PM2 process manager
Documentation=https://pm2.keymetrics.io/
After=network.target

[Service]
Type=oneshot
User=$CURRENT_USER
WorkingDirectory=$ROOT_DIR
RemainAfterExit=yes
LimitNOFILE=infinity
LimitNPROC=infinity
LimitCORE=infinity
Environment=HOME=$CURRENT_HOME
Environment=PM2_HOME=$PM2_HOME_DIR
Environment=NVM_DIR=$NVM_HOME
Environment=OMNIROUTE_ROOT_DIR=$ROOT_DIR
Environment=PM2_BIN=$PM2_BIN
Environment=PATH=$PM2_BIN_DIR:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/bin
ExecStart=/bin/bash $ROOT_DIR/scripts/pm2/pm2-systemd-service.sh start
ExecReload=/bin/bash $ROOT_DIR/scripts/pm2/pm2-systemd-service.sh reload
ExecStop=/bin/bash $ROOT_DIR/scripts/pm2/pm2-systemd-service.sh stop

[Install]
WantedBy=multi-user.target
EOF

if [[ "$INSTALL_MODE" != true ]]; then
  cat "$TMP_UNIT"
  exit 0
fi

echo "[pm2-systemd] Installing $UNIT_PATH"
sudo install -m 644 "$TMP_UNIT" "$UNIT_PATH"
sudo systemctl daemon-reload
sudo systemctl enable "$SERVICE_NAME"
sudo systemctl restart "$SERVICE_NAME"
sudo systemctl status "$SERVICE_NAME" --no-pager
