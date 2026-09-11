#!/usr/bin/env bash
# LAN production server (retro3d.service): serves the `npm run build` output
# through wrangler/workerd on port 3001. scripts/server-deploy.sh rebuilds it.
set -e
export PATH=/home/user/tools/node-v22.23.2-linux-x64/bin:/usr/local/bin:/usr/bin:/bin:$PATH
export WRANGLER_SEND_METRICS=false
cd /home/user/projects/retro3d

if [ ! -f dist/server/wrangler.json ]; then
  npm run build
fi

# --persist-to is required: by default wrangler keeps D1 next to
# dist/server/wrangler.json, i.e. in an empty database instead of the one in
# .wrangler/state that `npm run db:local` migrates.
exec npx wrangler dev --config dist/server/wrangler.json \
  --ip 0.0.0.0 --port 3001 \
  --persist-to .wrangler/state \
  --show-interactive-dev-session=false
