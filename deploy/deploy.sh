#!/usr/bin/env bash
# Pull the latest code and restart, safely.
#
# The database is backed up before anything else, because migrations run on
# startup and a bad one would otherwise hit the only copy of the real data.
# Run by hand, or on a timer, or from a webhook. Safe to run when nothing changed.
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/envelope}"
SERVICE="${SERVICE:-envelope}"
BACKUP_DIR="${BACKUP_DIR:-$APP_DIR/backups}"
KEEP_BACKUPS="${KEEP_BACKUPS:-30}"

cd "$APP_DIR"

say() { printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"; }

# 1. Back up the database first, always, even if the deploy turns out to be a no-op.
if [ -f data/budget.db ]; then
  mkdir -p "$BACKUP_DIR"
  stamp=$(date '+%Y%m%d-%H%M%S')
  # The .backup command copes with a live database and WAL, unlike cp.
  if command -v sqlite3 >/dev/null 2>&1; then
    sqlite3 data/budget.db ".backup '$BACKUP_DIR/budget-$stamp.db'"
  else
    cp data/budget.db "$BACKUP_DIR/budget-$stamp.db"
  fi
  say "backed up to $BACKUP_DIR/budget-$stamp.db"
  # Keep the most recent N and drop the rest.
  ls -1t "$BACKUP_DIR"/budget-*.db 2>/dev/null | tail -n +$((KEEP_BACKUPS + 1)) | xargs -r rm --
fi

# 2. Is there anything new?
git fetch --quiet origin
local_rev=$(git rev-parse HEAD)
remote_rev=$(git rev-parse '@{u}')
if [ "$local_rev" = "$remote_rev" ]; then
  say "already up to date at ${local_rev:0:7}, nothing to do"
  exit 0
fi

say "updating ${local_rev:0:7} -> ${remote_rev:0:7}"
git merge --ff-only '@{u}'

# 3. Only reinstall when the lockfile actually moved. npm ci wipes node_modules,
#    so doing it every time would make a no-change deploy needlessly slow.
if ! git diff --quiet "$local_rev" "$remote_rev" -- package-lock.json package.json; then
  say "dependencies changed, running npm ci"
  npm ci
fi

# 4. Build, then swap. Building first keeps the old version serving until the
#    new one is actually ready.
say "building"
npm run build

say "restarting $SERVICE"
sudo systemctl restart "$SERVICE"

sleep 2
if systemctl is-active --quiet "$SERVICE"; then
  say "deployed ${remote_rev:0:7} and $SERVICE is running"
else
  say "WARNING: $SERVICE did not come back up"
  systemctl status "$SERVICE" --no-pager --lines 20 || true
  exit 1
fi
