#!/usr/bin/env bash
# Retro3D Automated Deployment Script (Bash)
# Usage: ./scripts/deploy.sh ["commit message"]

set -euo pipefail

REMOTE_HOST="${REMOTE_HOST:-192.168.56.70}"
REMOTE_PORT="${REMOTE_PORT:-2222}"
REMOTE_USER="${REMOTE_USER:-user}"
REMOTE_DIR="${REMOTE_DIR:-/home/user/projects/retro3d}"
BRANCH="${BRANCH:-main}"
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

# 5. Remote deployment via SSH: pull, then scripts/server-deploy.sh from the new
# revision runs migrations, tests, the production build and the restart.
echo -e "\n[5/5] Deploying to $REMOTE_USER@$REMOTE_HOST:$REMOTE_PORT..."
ssh -p "$REMOTE_PORT" "$REMOTE_USER@$REMOTE_HOST" bash -s -- "$REMOTE_DIR" "$BRANCH" <<'EOF'
set -e
echo "==> Updating repository in $1..."
cd "$1"
PREV_HEAD=$(git rev-parse HEAD)
git fetch origin
git checkout "$2"
git pull --ff-only origin "$2"
bash scripts/server-deploy.sh "$PREV_HEAD"
EOF

echo -e "\n✅ DEPLOYMENT SUCCESSFUL: http://$REMOTE_HOST:3001/"
