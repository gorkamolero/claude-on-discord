#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
git config --local user.name 'Gorka Molero'
git config --local user.email '1006865+gorkamolero@users.noreply.github.com'
git config --local user.useConfigOnly true
git config --local core.hooksPath scripts/githooks
git config --local --replace-all credential.helper ''
git config --local --add credential.helper '!gh auth git-credential'
python3 scripts/git-identity-guard.py context
echo 'Repository identity checks and commit/push hooks are installed.'
