#!/usr/bin/env bash
set -euo pipefail

APP_PATH="${1:?Application path required}"
RELEASE_ARCHIVE="${2:?Release archive required}"

CONFIG="$HOME/.opc-deploy/production.env"

# Never allow runtime replacement outside the approved application.
validate_production_path() {
  local expected="$HOME/opc-portal"
  local resolved

  resolved="$(realpath -e -- "$APP_PATH")" || return 1

  if [ "$resolved" != "$expected" ]; then
    echo "ERROR: Unauthorized production application path"
    return 1
  fi

  if [ "$HOME" != "/home/osdavcax" ]; then
    echo "ERROR: Unexpected deployment user"
    return 1
  fi

  echo "OPC_PRODUCTION_PATH_VALID"
}

validate_deployment_inputs() {
  validate_production_path || return 1
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
  
  

}

# Back up the production PostgreSQL database.
backup_production_database() {
  local backup_dir="$1"

  test -f "$CONFIG" || {
    echo "ERROR: Production configuration missing"
    return 1
  }

  mkdir -p "$backup_dir"
  chmod 700 "$backup_dir"

  # Production configuration uses shell-safe export statements.
  # Avoid nounset issues in the environment activation process.
  source "$CONFIG"

  test -n "${DATABASE_URL:-}" || {
    echo "ERROR: DATABASE_URL is missing"
    return 1
  }

  echo "=== BACKING UP POSTGRESQL DATABASE ==="

  pg_dump \
    --no-password \
    --dbname="$DATABASE_URL" \
    --format=custom \
    --file="$backup_dir/database.dump"

  test -s "$backup_dir/database.dump"

  pg_restore --list "$backup_dir/database.dump" > /dev/null

  chmod 600 "$backup_dir/database.dump"

  echo "OPC_DATABASE_BACKUP_VERIFIED"
}

# Extract and validate a release in an isolated directory.
stage_production_release() {
  local stage_dir="$1"

  if [ -e "$stage_dir" ]; then
    echo "ERROR: Staging directory already exists"
    return 1
  fi

  echo "=== VALIDATING ARCHIVE CONTENTS ==="

  python3 - "$RELEASE_ARCHIVE" <<'PYTHON'
import sys
import tarfile
from pathlib import PurePosixPath

archive = sys.argv[1]

with tarfile.open(archive, "r:gz") as tar:
    for member in tar:
        name = member.name
        path = PurePosixPath(name)

        if path.is_absolute() or ".." in path.parts:
            raise SystemExit(f"Unsafe archive path: {name}")

        if not (member.isfile() or member.isdir()):
            raise SystemExit(f"Unsupported archive entry: {name}")

print("OPC_ARCHIVE_SECURITY_VALID")
PYTHON

  mkdir -m 700 "$stage_dir"

  echo "=== EXTRACTING RELEASE ==="

  tar -xzf "$RELEASE_ARCHIVE" \
    --no-same-owner \
    --no-same-permissions \
    -C "$stage_dir"

  echo "=== VERIFYING RELEASE FILES ==="

  test -f "$stage_dir/server.js"
  test -d "$stage_dir/.next/static"
  test -d "$stage_dir/node_modules/pg"
  test -d "$stage_dir/public"
  test -f "$stage_dir/scripts/migrate.mjs"
  test -d "$stage_dir/database/migrations"

  echo "OPC_RELEASE_STAGING_SUCCESS"
}

# Save the current production runtime files before activation.
backup_production_application() {
  local backup_dir="$1"

  if [ -e "$backup_dir" ]; then
    echo "ERROR: Application backup directory already exists"
    return 1
  fi

  mkdir -m 700 "$backup_dir"

  echo "=== BACKING UP CURRENT APPLICATION ==="

  local item

  for item in server.js .next node_modules public; do
    if [ ! -e "$APP_PATH/$item" ]; then
      echo "ERROR: Missing production component: $item"
      return 1
    fi

    cp -a "$APP_PATH/$item" "$backup_dir/$item"
  done

  test -f "$backup_dir/server.js"
  test -d "$backup_dir/.next"
  test -d "$backup_dir/node_modules"
  test -d "$backup_dir/public"

  echo "OPC_APPLICATION_BACKUP_VERIFIED"
}

# Replace runtime components using filesystem renames.
# Keep old components until all replacements are installed.
switch_runtime_components() {
  validate_production_path || return 1

  local source_dir="$1"
  local item
  local transaction_dir

  # Refuse deployment if a previous file switch was interrupted.
  local existing_switch
  for existing_switch in "$APP_PATH"/.opc-switch.*; do
    if [ -e "$existing_switch" ]; then
      echo "ERROR: Unfinished OPC file switch detected"
      echo "Manual recovery required before another deployment"
      return 1
    fi
  done

  transaction_dir="$(mktemp -d "$APP_PATH/.opc-switch.XXXXXXXX")"

  for item in server.js .next node_modules public; do
    if [ ! -e "$source_dir/$item" ]; then
      echo "ERROR: Missing source component: $item"
      rmdir "$transaction_dir"
      return 1
    fi
  done

  # Prepare replacements on the same filesystem.
  for item in server.js .next node_modules public; do
    cp -a -- "$source_dir/$item" "$transaction_dir/$item"
  done

  local -a installed=()
  local -a moved=()

  for item in server.js .next node_modules public; do
    if mv -- "$APP_PATH/$item" "$transaction_dir/old-$item"; then
      moved+=("$item")
    else
      echo "ERROR: Could not preserve $item"
      break
    fi

    if mv -- "$transaction_dir/$item" "$APP_PATH/$item"; then
      installed+=("$item")
    else
      echo "ERROR: Could not activate $item"
      break
    fi
  done

  if [ "${#installed[@]}" -ne 4 ]; then
    echo "ERROR: File switch failed; restoring previous runtime"

    for ((i=${#moved[@]}-1; i>=0; i--)); do
      item="${moved[$i]}"
      if [ -e "$transaction_dir/old-$item" ]; then
        if [ -e "$APP_PATH/$item" ]; then
          mv -- "$APP_PATH/$item" "$transaction_dir/failed-$item" || return 1
        fi
        mv -- "$transaction_dir/old-$item" "$APP_PATH/$item" || return 1
      fi
    done

    echo "OPC_FILE_SWITCH_RECOVERED"
    return 1
  fi

  mkdir -p "$APP_PATH/tmp"
  touch "$APP_PATH/tmp/restart.txt"

  # The new runtime is installed and Passenger restart requested.
  # Remove the transaction directory after a successful switch.
  rm -rf -- "$transaction_dir"

  echo "OPC_RUNTIME_SWITCH_SUCCESS"
}

rollback_production_application() {
  local backup_dir="$1"
  echo "=== RESTORING PREVIOUS APPLICATION ==="
  switch_runtime_components "$backup_dir"
  echo "OPC_APPLICATION_ROLLBACK_COMPLETED"
}

activate_production_release() {
  local stage_dir="$1"
  echo "=== ACTIVATING OPC RELEASE ==="
  switch_runtime_components "$stage_dir"
  echo "OPC_RELEASE_ACTIVATED"
}

# Acquire an exclusive lock for the full deployment operation.
acquire_deployment_lock() {
  local lock_file="$HOME/.opc-deploy/deployment.lock"

  test -d "$HOME/.opc-deploy" || return 1

  exec 9>"$lock_file"
  chmod 600 "$lock_file"

  if ! flock -n 9; then
    echo "ERROR: Another OPC deployment is already running"
    return 1
  fi

  echo "OPC_DEPLOYMENT_LOCK_ACQUIRED"
}

# Verify that the public application responds after deployment.
verify_production_health() {
  local url="${OPC_PUBLIC_URL:-https://opc.osdavc.com}"
  local attempt
  local status

  if [ "$url" != "https://opc.osdavc.com" ]; then
    echo "ERROR: Unexpected OPC production URL"
    return 1
  fi

  echo "=== VERIFYING OPC PRODUCTION HEALTH ==="

  for attempt in $(seq 1 12); do
    status="$(curl --silent --show-error \
      --output /dev/null \
      --write-out '%{http_code}' \
      --max-time 5 \
      "$url/login")" || status="000"

    if [ "$status" = "200" ]; then
      echo "OPC_PRODUCTION_HEALTH_VERIFIED"
      return 0
    fi

    echo "Health check attempt $attempt: HTTP $status"
    sleep 5
  done

  echo "ERROR: OPC production health verification failed"
  return 1
}

# Run pending database migrations from the staged release.
run_production_migrations() {
  local stage_dir="$1"
  local node_bin="$HOME/nodevenv/opc-portal/22/bin/node"

  echo "=== RUNNING OPC DATABASE MIGRATIONS ==="

  validate_production_path || return 1

  if [ ! -f "$stage_dir/scripts/migrate.mjs" ]; then
    echo "ERROR: Migration runner missing"
    return 1
  fi

  if [ ! -d "$stage_dir/database/migrations" ]; then
    echo "ERROR: Migration directory missing"
    return 1
  fi

  if [ ! -x "$node_bin" ]; then
    echo "ERROR: Production Node.js 22 executable missing"
    return 1
  fi

  (
    set -a
    source "$CONFIG"
    set +a

    if [ -z "${DATABASE_URL:-}" ]; then
      echo "ERROR: DATABASE_URL is missing"
      exit 1
    fi

    cd "$stage_dir"
    "$node_bin" scripts/migrate.mjs
  )

  echo "OPC_DATABASE_MIGRATIONS_COMPLETED"
}

# Coordinate a complete OPC production deployment.
deploy_production() {
  local deployment_id
  local stage_dir
  local backup_root
  local database_backup_dir
  local application_backup_dir

  deployment_id="$(date -u +%Y%m%dT%H%M%SZ)-$$"
  stage_dir="$HOME/.opc-deploy/staging/$deployment_id"
  backup_root="$HOME/opc-backups/$deployment_id"
  database_backup_dir="$backup_root/database"
  application_backup_dir="$backup_root/application"

  echo "=== OPC DEPLOYMENT: $deployment_id ==="

  # Lock before checking or modifying deployment state.
  acquire_deployment_lock
  validate_deployment_inputs

  mkdir -p "$HOME/.opc-deploy/staging"
  chmod 700 "$HOME/.opc-deploy/staging"

  stage_production_release "$stage_dir"

  mkdir -m 700 "$backup_root"

  backup_production_database "$database_backup_dir"
  backup_production_application "$application_backup_dir"

  echo "=== DATABASE AND APPLICATION BACKUPS COMPLETE ==="

  run_production_migrations "$stage_dir"

  echo "=== ACTIVATING NEW APPLICATION ==="

  if ! activate_production_release "$stage_dir"; then
    echo "ERROR: Release activation failed"
    echo "Inspect any .opc-switch directory before retrying"
    return 1
  fi

  if ! verify_production_health; then
    echo "ERROR: Production health check failed"
    echo "=== ATTEMPTING APPLICATION ROLLBACK ==="

    if rollback_production_application "$application_backup_dir"; then
      echo "OPC_APPLICATION_ROLLBACK_SUCCESS"
    else
      echo "CRITICAL: Application rollback failed"
    fi

    return 1
  fi

  echo "OPC_DEPLOYMENT_COMPLETED"
  echo "Deployment ID: $deployment_id"
}


# Execute the deployment controller when this script is run directly.
if [ "${OPC_ENABLE_DEPLOYMENT:-}" != "YES" ]; then
  echo "ERROR: Deployment execution is disabled until safety checks pass"
  exit 1
fi

deploy_production "$@"
