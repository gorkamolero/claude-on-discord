#!/usr/bin/env python3
"""Exercise the installed hooks in disposable repositories; no network writes."""
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

SOURCE = Path(__file__).resolve().parent


def run(repo, *args, env=None):
    return subprocess.run(args, cwd=repo, env=env, text=True,
                          stdout=subprocess.PIPE, stderr=subprocess.STDOUT)


with tempfile.TemporaryDirectory(prefix="discord-identity-check-") as tmp:
    root = Path(tmp)
    repo = root / "checkout"
    repo.mkdir()
    fake_bin = root / "bin"
    fake_bin.mkdir()
    gh = fake_bin / "gh"
    gh.write_text('#!/bin/sh\nprintf "%s\\n" "${GUARD_TEST_LOGIN:-gorkamolero}"\n')
    gh.chmod(0o755)
    env = {k: v for k, v in os.environ.items()
           if not k.startswith("GIT_") and not k.startswith("GH_")}
    env["PATH"] = str(fake_bin) + os.pathsep + env["PATH"]
    assert run(repo, "git", "init", "-b", "main", env=env).returncode == 0
    shutil.copytree(SOURCE / "githooks", repo / "scripts" / "githooks")
    shutil.copy(SOURCE / "git-identity-guard.py", repo / "scripts")
    for key, value in [("user.name", "Gorka Molero"),
                       ("user.email", "1006865+gorkamolero@users.noreply.github.com"),
                       ("core.hooksPath", "scripts/githooks")]:
        assert run(repo, "git", "config", key, value, env=env).returncode == 0
    url = "https://github.com/gorkamolero/claude-on-discord.git"
    assert run(repo, "git", "remote", "add", "origin", url, env=env).returncode == 0
    (repo / "example.txt").write_text("safe example\n")
    assert run(repo, "git", "add", "example.txt", env=env).returncode == 0

    def blocked(label, args, extra=None):
        result = run(repo, *args, env={**env, **(extra or {})})
        assert result.returncode != 0 and "Git operation refused:" in result.stdout, result.stdout
        print("PASS:", label)

    command = ["git", "commit", "-m", "Example", "--", "example.txt"]
    blocked("wrong author email", command, {"GIT_AUTHOR_EMAIL": "wrong@example.invalid"})
    blocked("wrong committer email", command, {"GIT_COMMITTER_EMAIL": "wrong@example.invalid"})
    blocked("wrong active GitHub account", command, {"GUARD_TEST_LOGIN": "wrong-account"})
    blocked("bare commit", ["git", "commit", "-m", "Example"])
    blocked("unexpected coauthor", ["git", "commit", "-m", "Example\n\nCo-authored-by: Wrong <wrong@example.invalid>", "--", "example.txt"])
    assert run(repo, "git", "remote", "set-url", "origin", "https://github.com/wrong-account/example.git", env=env).returncode == 0
    blocked("wrong origin", command)
    assert run(repo, "git", "remote", "set-url", "origin", url, env=env).returncode == 0
    (repo / "example.txt").write_text("https://github.com/" + "wrong-account" + "/claude-on-discord\n")
    blocked("wrong project ownership link", command)
    (repo / "example.txt").write_text("safe example\n")
    assert run(repo, *command, env=env).returncode == 0
    print("PASS: explicit-path commit with public identity")
    sha = run(repo, "git", "rev-parse", "HEAD", env=env).stdout.strip()
    payload = f"refs/heads/main {sha} refs/heads/main {'0' * 40}\n"
    guard = ["python3", str(repo / "scripts" / "git-identity-guard.py"), "push", "origin", url]
    result = subprocess.run(guard, cwd=repo, env=env, input=payload, text=True, capture_output=True)
    assert result.returncode == 0, result.stderr
    print("PASS: outgoing public history")
    blocked("alternate push destination", guard[:-1] + ["https://github.com/wrong-account/example.git"])
    # Exercise Git's pre-push invocation, and prove no refs reach the destination.
    destination = root / "remote.git"
    assert run(root, "git", "init", "--bare", str(destination), env=env).returncode == 0
    blocked("Git push invokes the destination guard", ["git", "push", str(destination), "main"])
    refs = run(root, "git", "--git-dir", str(destination), "show-ref", env=env)
    assert not refs.stdout.strip()
    print("PASS: rejected push transmitted no refs")
