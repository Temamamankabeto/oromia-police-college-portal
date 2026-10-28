#!/usr/bin/env bash
set -euo pipefail

APP_PATH="${1:?Application path required}"
RELEASE_ARCHIVE="${2:?Release archive required}"

CONFIG="$HOME/.opc-deploy/production.env"

echo "=== OPC DEPLOYMENT VALIDATION ==="

test -d "$APP_PATH" || {
  echo "ERROR: Application directory not found"
  exit 1
}

test -f "$RELEASE_ARCHIVE" || {
  echo "ERROR: Release archive not found"
  exit 1
}

test -f "$CONFIG" || {
  echo "ERROR: Protected production configuration missing"
  exit 1
}

test "$(stat -c '%a' "$CONFIG")" = "600" || {
  echo "ERROR: Production configuration permissions are incorrect"
  exit 1
}

test -d "$HOME/opc-backups" || {
  echo "ERROR: Backup directory missing"
  exit 1
}

tar -tzf "$RELEASE_ARCHIVE" > /dev/null

echo "OPC_RELEASE_ARCHIVE_VALID"
echo "OPC_PRODUCTION_CONFIG_VALID"
echo "OPC_BACKUP_DIRECTORY_VALID"
echo "OPC_DEPLOYMENT_VALIDATION_SUCCESS"
echo "No production files or database records were changed."
