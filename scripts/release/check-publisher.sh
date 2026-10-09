#!/usr/bin/env bash
set -euo pipefail
PUBLISHER="$(npm whoami --registry=https://registry.npmjs.org/)"
if [ "$PUBLISHER" != "gorkamolero" ]; then
  echo "Publication refused: sign in to npm as gorkamolero." >&2
  exit 1
fi
bash "$(dirname "$0")/check-package.sh"
