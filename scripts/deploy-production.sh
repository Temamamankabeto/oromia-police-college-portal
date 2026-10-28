#!/usr/bin/env bash
set -Eeuo pipefail

APP_PATH="${1:?Production application path required}"
ARCHIVE="${2:?Release archive required}"
EXPECTED_SHA="${3:?Expected release SHA required}"

DEPLOY_ROOT="$HOME/.opc-deploy"
CONFIG="$DEPLOY_ROOT/production.env"
BACKUP_ROOT="$HOME/opc-backups"
RELEASE_ROOT="$DEPLOY_ROOT/releases"
NODE_BIN="$HOME/nodevenv/opc-portal/22/bin/node"
PUBLIC_URL="https://opc.osdavc.com"

ITEMS=(server.js .next node_modules public)
DEPLOY_ID="$(date -u +%Y%m%dT%H%M%SZ)-$$"
RELEASE="$RELEASE_ROOT/$DEPLOY_ID"
BACKUP="$BACKUP_ROOT/$DEPLOY_ID"
TRANSACTION=""
ACTIVATION_STARTED=0
ACTIVATION_COMPLETE=0

die() {
  echo "ERROR: $*" >&2
  exit 1
}

restart_passenger() {
  mkdir -p "$APP_PATH/tmp"
  touch "$APP_PATH/tmp/restart.txt"
}

restore_transaction() {
  local item
  local failed=0

  [[ -n "$TRANSACTION" && -d "$TRANSACTION" ]] || return 0

  echo "Restoring previous runtime..."

  for item in "${ITEMS[@]}" .opc-release-id; do
    if [[ -e "$TRANSACTION/old-$item" ]]; then
      rm -rf -- "$APP_PATH/$item" || failed=1
      mv -- "$TRANSACTION/old-$item" "$APP_PATH/$item" || failed=1
    elif [[ -e "$TRANSACTION/installed-$item" ]]; then
      # Only remove a new component if installation actually occurred.
      if [[ ! -e "$TRANSACTION/new-$item" ]]; then
        rm -rf -- "$APP_PATH/$item" || failed=1
      fi
    fi
  done

  if (( failed == 0 )); then
    restart_passenger || failed=1
  fi

  if (( failed == 0 )); then
    rm -rf -- "$TRANSACTION"
    TRANSACTION=""
    echo "APPLICATION_ROLLBACK_SUCCESS"
  else
    echo "CRITICAL: Recovery incomplete. Inspect $TRANSACTION" >&2
    return 1
  fi
}

on_error() {
  local status=${1:-$?}
  trap - ERR EXIT INT TERM

  if (( ACTIVATION_STARTED == 1 && ACTIVATION_COMPLETE == 0 )); then
    restore_transaction || true
  fi

  echo "DEPLOYMENT_FAILED: $DEPLOY_ID" >&2
  exit "$status"
}

trap on_error ERR
on_exit() {
  local status=$?
  trap - ERR EXIT
  if (( status != 0 )); then
    on_error "$status"
  fi
}
trap on_exit EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

[[ "${OPC_ENABLE_DEPLOYMENT:-}" == "YES" ]] ||
  die "Deployment execution not enabled"

[[ "$HOME" == "/home/osdavcax" ]] ||
  die "Unexpected production account"

[[ -d "$APP_PATH" ]] ||
  die "Application directory missing"

[[ "$(realpath "$APP_PATH")" == "$HOME/opc-portal" ]] ||
  die "Unexpected application path"

[[ -f "$CONFIG" && -f "$ARCHIVE" ]] ||
  die "Missing environment configuration or release archive"

[[ "$(stat -c %a "$CONFIG")" == "600" ]] ||
  die "Production environment permissions must be 600"

[[ "$EXPECTED_SHA" =~ ^[0-9a-f]{40}$ ]] ||
  die "Invalid release SHA"

[[ -x "$NODE_BIN" ]] ||
  die "Production Node.js executable missing"

mkdir -p "$DEPLOY_ROOT" "$RELEASE_ROOT" "$BACKUP_ROOT"
chmod 700 "$DEPLOY_ROOT" "$RELEASE_ROOT" "$BACKUP_ROOT"

exec 9>"$DEPLOY_ROOT/deployment.lock"
flock -n 9 || die "Another deployment is running"

for existing in "$APP_PATH"/.opc-switch.*; do
  [[ -d "$existing" ]] || continue

  echo "Recovering interrupted deployment: $existing"

  # Refuse automatic recovery when transaction evidence is incomplete.
  for item in "${ITEMS[@]}"; do
    if [[ ! -e "$existing/old-$item" &&
          ! -e "$APP_PATH/$item" ]]; then
      die "Cannot safely recover missing component: $item"
    fi
  done

  TRANSACTION="$existing"
  ACTIVATION_STARTED=1
  ACTIVATION_COMPLETE=0

  restore_transaction ||
    die "Interrupted deployment recovery failed: $existing"

  ACTIVATION_STARTED=0
  ACTIVATION_COMPLETE=0
done

echo "=== STAGING RELEASE ==="

mkdir -m 700 "$RELEASE"

python3 - "$ARCHIVE" "$RELEASE" <<'PY'
import pathlib
import sys
import tarfile

archive, destination = sys.argv[1:]
root = pathlib.Path(destination)

with tarfile.open(archive, "r:gz") as tar:
    members = tar.getmembers()

    for member in members:
        path = pathlib.PurePosixPath(member.name)

        if (
            path.is_absolute()
            or ".." in path.parts
            or not (
                member.isfile()
                or member.isdir()
                or member.issym()
            )
        ):
            raise SystemExit(f"Unsafe archive entry: {member.name}")

        if member.issym():
            target = pathlib.PurePosixPath(member.linkname)

            if target.is_absolute():
                raise SystemExit(
                    f"Unsafe absolute symlink: {member.name}"
                )

            resolved = (root / path.parent / target).resolve(
                strict=False
            )

            if not resolved.is_relative_to(root.resolve()):
                raise SystemExit(
                    f"Unsafe symlink target: {member.name}"
                )

    tar.extractall(root, members=members, filter="data")
PY

for item in "${ITEMS[@]}"; do
  [[ -e "$RELEASE/$item" ]] ||
    die "Missing release component: $item"
done

[[ -f "$RELEASE/scripts/migrate.mjs" ]] ||
  die "Migration runner missing"

[[ -d "$RELEASE/database/migrations" ]] ||
  die "Database migrations missing"

[[ -f "$RELEASE/.opc-release-id" ]] ||
  die "Release identity missing"

[[ "$(cat "$RELEASE/.opc-release-id")" == "$EXPECTED_SHA" ]] ||
  die "Release SHA mismatch"

echo "=== BACKING UP DATABASE AND APPLICATION ==="

mkdir -m 700 "$BACKUP"
mkdir -m 700 "$BACKUP/application" "$BACKUP/database"

for item in "${ITEMS[@]}"; do
  [[ -e "$APP_PATH/$item" ]] ||
    die "Live component missing: $item"

  cp -a -- "$APP_PATH/$item" "$BACKUP/application/"
done

if [[ -f "$APP_PATH/.opc-release-id" ]]; then
  cp -a "$APP_PATH/.opc-release-id" "$BACKUP/application/"
fi

set -a
source "$CONFIG"
set +a

[[ -n "${DATABASE_URL:-}" ]] ||
  die "DATABASE_URL missing"

pg_dump --format=custom --no-password \
  --file="$BACKUP/database/production.dump" \
  "$DATABASE_URL"

chmod 600 "$BACKUP/database/production.dump"

pg_restore --list "$BACKUP/database/production.dump" >/dev/null

echo "DATABASE_BACKUP_VERIFIED"

echo "=== RUNNING MIGRATIONS ==="

(
  cd "$RELEASE"
  "$NODE_BIN" scripts/migrate.mjs
)

echo "=== ACTIVATING RELEASE ==="

TRANSACTION="$(mktemp -d "$APP_PATH/.opc-switch.XXXXXXXX")"

# Stage all replacement components before changing the live runtime.
for item in "${ITEMS[@]}" .opc-release-id; do
  cp -a -- "$RELEASE/$item" "$TRANSACTION/new-$item"
done

ACTIVATION_STARTED=1

for item in "${ITEMS[@]}" .opc-release-id; do
  if [[ -e "$APP_PATH/$item" ]]; then
    mv -- "$APP_PATH/$item" "$TRANSACTION/old-$item"
  else
    touch "$TRANSACTION/installed-$item"
  fi

  mv -- "$TRANSACTION/new-$item" "$APP_PATH/$item"
done

restart_passenger

echo "=== VERIFYING RELEASE IDENTITY ==="

[[ "$(cat "$APP_PATH/.opc-release-id")" == "$EXPECTED_SHA" ]] ||
  die "Installed release identity mismatch"

echo "=== VERIFYING PRODUCTION HEALTH ==="

healthy=0

for attempt in $(seq 1 12); do
  release_response="$(curl -fsS --max-time 10 \
    -H 'Cache-Control: no-cache' \
    "$PUBLIC_URL/api/deployment-health" || true)"

  if [[ "$release_response" == *'"release":"'"$EXPECTED_SHA"'"'* ]]; then
    healthy=1
    break
  fi

  sleep 5
done

(( healthy == 1 )) ||
  die "Production release identity verification failed"

ACTIVATION_COMPLETE=1

rm -rf -- "$TRANSACTION"
TRANSACTION=""

echo "OPC_DEPLOYMENT_COMPLETED"
echo "DEPLOYMENT_ID=$DEPLOY_ID"
echo "RELEASE_SHA=$EXPECTED_SHA"
echo "BACKUP_PATH=$BACKUP"
