#!/usr/bin/env bash
# Runs on the LAN server after `git pull` (called by deploy.ps1 / deploy.sh).
# Usage: bash scripts/server-deploy.sh [previous HEAD]
# Installs dependencies when package-lock.json changed, migrates local D1,
# runs tests, builds the production bundle and restarts retro3d.service.

set -euo pipefail
export PATH="/home/user/tools/node-v22.23.2-linux-x64/bin:$PATH"
export WRANGLER_SEND_METRICS=false
cd "$(dirname "$0")/.."

PREV_HEAD="${1:-}"
PORT=3001

if [ ! -d node_modules ] || { [ -n "$PREV_HEAD" ] && ! git diff --quiet "$PREV_HEAD" HEAD -- package-lock.json; }; then
  echo "==> package-lock.json changed, running npm ci..."
  npm ci --no-audit --no-fund
fi

echo "==> Applying D1 migrations to the local database..."
npx wrangler d1 migrations apply site-creator-d1 --local --config wrangler.local.json

echo "==> Running server tests..."
npm test

echo "==> Building production bundle..."
npm run build

echo "==> Restarting retro3d.service..."
systemctl --user restart retro3d.service
sleep 2
systemctl --user is-active retro3d.service

echo "==> Checking HTTP response on port $PORT (waiting up to 45s for wrangler to start)..."
HTTP_CODE="000"
for i in $(seq 1 45); do
  HTTP_CODE=$(curl -s -o /dev/null -m 20 -w "%{http_code}" "http://localhost:$PORT/" || true)
  [ "$HTTP_CODE" = "200" ] && break
  sleep 1
done
echo "HTTP Status: $HTTP_CODE (after $i attempt(s))"

if [ "$HTTP_CODE" != "200" ]; then
  echo "ERROR: Service returned HTTP $HTTP_CODE instead of 200"
  journalctl --user -u retro3d.service -n 25 --no-pager
  exit 1
fi

echo "==> Successfully deployed: $(git log -1 --pretty='%h - %s')"
