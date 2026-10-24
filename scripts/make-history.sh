#!/usr/bin/env sh
# Regenerates ../patchline-demo-game with planted bugs mid-history.
set -e
node "$(dirname "$0")/make-game-history.mjs" "$@"
