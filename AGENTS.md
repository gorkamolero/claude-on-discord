# Repository identity and Git operations

This repository belongs to the public GitHub account `gorkamolero`.
Use author and committer `Gorka Molero <1006865+gorkamolero@users.noreply.github.com>`.
Never use another account, name, email, coauthor trailer, or old repository history here.

After cloning, run `sh scripts/configure-git.sh` before making changes.
The configured hooks require Python 3, Git, and an authenticated GitHub CLI.
They reject an unexpected author, committer, active GitHub login, push destination,
project ownership link, credential file, or imported commit history.
Commit only your own changed files, explicitly by path:
`git add <new files>` followed by `git commit -m "message" -- <changed paths>`.
Do not disable hooks, use `--no-verify`, override `core.hooksPath`, or use plumbing
commands to bypass these checks.

For GitHub changes, use `scripts/github-safe.sh` (for example,
`scripts/github-safe.sh pr create`) so the account and repository are checked first.
Do not override `GH_REPO` or use raw GitHub write commands to bypass this wrapper.
Git hooks cannot intercept every GitHub CLI/API operation; the wrapper is required.
Never import pull request refs or merge an older checkout into this repository.
Use fresh clones for future work. Keep runtime credentials and databases outside Git.

Read `CLAUDE.md` for the application architecture and implementation rules.
