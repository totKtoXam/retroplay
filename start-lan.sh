#!/usr/bin/env bash
set -e
export PATH=/home/user/tools/node-v22.23.2-linux-x64/bin:/usr/local/bin:/usr/bin:/bin:$PATH
cd /home/user/projects/retro3d
exec npx vinext dev -H 0.0.0.0 -p 3001
