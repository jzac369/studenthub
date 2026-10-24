#!/usr/bin/env bash
# Import rozvrhu v Google Cloud Shell:  cd ~/studenthub && git pull -q && bash tools/import.sh
set -euo pipefail
cd ~/studenthub
[ -d functions/node_modules ] || (cd functions && npm ci --no-audit --no-fund --loglevel=error)
NODE_PATH=functions/node_modules node tools/import-schedule.js tools/rozvrh-zs-2026.json
