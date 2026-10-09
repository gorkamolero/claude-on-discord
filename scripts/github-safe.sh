#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
python3 scripts/git-identity-guard.py context
export GH_REPO='gorkamolero/claude-on-discord'
exec gh "$@"
