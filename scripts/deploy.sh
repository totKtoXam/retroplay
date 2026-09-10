#!/usr/bin/env bash
# Retro3D Automated Deployment Script (Bash)
# Usage: ./scripts/deploy.sh ["commit message"]

set -euo pipefail

REMOTE_HOST="${REMOTE_HOST:-192.168.56.70}"
REMOTE_PORT="${REMOTE_PORT:-2222}"
REMOTE_USER="${REMOTE_USER:-user}"
REMOTE_DIR="${REMOTE_DIR:-/home/user/projects/retro3d}"
BRANCH="${BRANCH:-feat/room-access-management}"
COMMIT_MSG="${1:-}"

echo "========================================="
echo "🚀 Retro3D Automated Deployment"
echo "========================================="

# 1. Run local tests
echo -e "\n[1/5] Running local test suite..."
npm test

# 2. Check TypeScript types
echo -e "\n[2/5] Checking TypeScript types..."
npx tsc --noEmit

# 3. Stage and commit changes if any
echo -e "\n[3/5] Checking git status..."
if [[ -n $(git status --porcelain) ]]; then
  if [[ -z "$COMMIT_MSG" ]]; then
    COMMIT_MSG="feat: automated deployment updates ($(date '+%Y-%m-%d %H:%M:%S'))"
  fi
  echo "Staging and committing: $COMMIT_MSG"
  git add .
  git commit -m "$COMMIT_MSG"
fi

# 4. Push to remote
echo -e "\n[4/5] Pushing to origin/$BRANCH..."
git push origin "$BRANCH"

# 5. Remote deployment via SSH
echo -e "\n[5/5] Deploying to $REMOTE_USER@$REMOTE_HOST:$REMOTE_PORT..."
ssh -p "$REMOTE_PORT" "$REMOTE_USER@$REMOTE_HOST" bash -c "'
set -e
export PATH=\"/home/user/tools/node-v22.23.2-linux-x64/bin:\$PATH\"
echo \"==> Updating repository in $REMOTE_DIR...\"
cd \"$REMOTE_DIR\"
git fetch origin
git checkout \"$BRANCH\"
git pull origin \"$BRANCH\"

echo \"==> Running server tests...\"
npm test

echo \"==> Restarting retro3d.service...\"
systemctl --user restart retro3d.service
sleep 2

echo \"==> Verifying service status...\"
systemctl --user is-active retro3d.service

echo \"==> Checking HTTP response on port 3001...\"
HTTP_CODE=\$(curl -s -o /dev/null -w \"%{http_code}\" http://localhost:3001/ || echo \"000\")
echo \"HTTP Status: \$HTTP_CODE\"

if [ \"\$HTTP_CODE\" != \"200\" ]; then
    echo \"ERROR: Service returned HTTP \$HTTP_CODE instead of 200\"
    journalctl --user -u retro3d.service -n 25 --no-pager
    exit 1
fi

COMMIT_HASH=\$(git rev-parse --short HEAD)
COMMIT_MSG=\$(git log -1 --pretty=%B | head -n 1)
echo \"==> Successfully deployed: \$COMMIT_HASH - \$COMMIT_MSG\"
'"

echo -e "\n✅ DEPLOYMENT SUCCESSFUL: http://$REMOTE_HOST:3001/"
