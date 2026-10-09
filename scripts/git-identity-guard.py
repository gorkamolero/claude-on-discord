#!/usr/bin/env python3
"""Refuse Git operations with an unexpected identity or repository."""
import os
import re
import subprocess
import sys

LOGIN = "gorkamolero"
NAME = "Gorka Molero"
EMAIL = "1006865+gorkamolero@users.noreply.github.com"
REPO = "gorkamolero/claude-on-discord"
URLS = {f"https://github.com/{REPO}.git", f"git@github.com:{REPO}.git"}


def run(*args):
    return subprocess.check_output(args, text=True, stderr=subprocess.DEVNULL).strip()


def refuse(reason):
    sys.exit(f"Git operation refused: {reason}. Do not bypass this guard.")


def identity(value):
    return value.startswith(f"{NAME} <{EMAIL}> ")


def context():
    for variable in ("GIT_AUTHOR_IDENT", "GIT_COMMITTER_IDENT"):
        if not identity(run("git", "var", variable)):
            refuse("author and committer must use the configured public identity")
    if run("gh", "api", "user", "--jq", ".login") != LOGIN:
        refuse("the active GitHub login does not match this repository")
    if run("git", "remote", "get-url", "--push", "origin") not in URLS:
        refuse("origin does not point to the approved replacement repository")


def staged_content():
    paths = subprocess.check_output(["git", "diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"]).split(b"\0")
    for raw in paths:
        if not raw:
            continue
        path = os.fsdecode(raw)
        if re.search(r"(^|/)\.env($|\.)", path) and not path.endswith(".env.example"):
            refuse("runtime credentials cannot be committed")
        data = subprocess.check_output(["git", "show", f":{path}"])
        # Project ownership links must always refer to the public account.
        owners = re.findall(rb"github\.com[/:]([^/\s\"'<>]+)/claude-on-discord(?:-clean)?", data)
        if any(owner != LOGIN.encode() for owner in owners):
            refuse("a staged project link refers to an unapproved account")


def commit():
    context()
    git_dir = run("git", "rev-parse", "--git-dir")
    merging = any(os.path.exists(os.path.join(git_dir, name)) for name in
                  ("MERGE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD", "rebase-merge", "rebase-apply"))
    if not merging and not re.fullmatch(r"next-index-.*\.lock", os.path.basename(os.environ.get("GIT_INDEX_FILE", "index"))):
        refuse("commit by explicit file paths so another session's staged files cannot be included")
    staged_content()


def message(path):
    text = open(path, encoding="utf-8").read()
    for trailer in re.findall(r"(?im)^Co-authored-by:\s*(.+)$", text):
        if trailer.strip() != f"{NAME} <{EMAIL}>":
            refuse("a coauthor trailer uses an unapproved identity")


def push(remote, url):
    context()
    if remote != "origin" or url not in URLS:
        refuse("push destination is not the approved replacement repository")
    for line in sys.stdin:
        local_ref, local_sha, remote_ref, remote_sha = line.split()
        if local_sha == "0" * 40:
            continue
        # Inspect all ancestors, including histories introduced by a merge or tag.
        commits = run("git", "rev-list", local_sha).splitlines()
        for sha in commits:
            values = run("git", "show", "-s", "--format=%an%n%ae%n%cn%n%ce", sha).splitlines()
            if values != [NAME, EMAIL, NAME, EMAIL]:
                refuse("the outgoing history includes an unapproved author or committer")
            text = run("git", "show", "-s", "--format=%B", sha)
            for trailer in re.findall(r"(?im)^Co-authored-by:\s*(.+)$", text):
                if trailer.strip() != f"{NAME} <{EMAIL}>":
                    refuse("the outgoing history includes an unapproved coauthor")


if __name__ == "__main__":
    try:
        mode = sys.argv[1]
        if mode == "commit":
            commit()
        elif mode == "message":
            message(sys.argv[2])
        elif mode == "push":
            push(*sys.argv[2:4])
        elif mode == "context":
            context()
        else:
            refuse("unknown guard operation")
    except (subprocess.CalledProcessError, FileNotFoundError):
        refuse("identity or destination verification failed")
