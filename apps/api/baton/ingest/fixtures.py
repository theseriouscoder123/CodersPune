"""Load the GitHub-shaped demo fixture (demo/github_fixture) into RepoData."""

from __future__ import annotations

import base64
import json
from pathlib import Path

from baton.ingest.github_normalise import RepoData

DEMO_DIR = Path(__file__).resolve().parents[4] / "demo"


def _load(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def load_fixture(fixture_dir: Path | None = None) -> RepoData:
    d = fixture_dir or DEMO_DIR / "github_fixture"
    files = {
        f["path"]: base64.b64decode(f["content"]).decode("utf-8")
        for f in _load(d / "contents.json")
        if f.get("type") == "file" and f.get("encoding") == "base64"
    }
    return RepoData(
        repo=_load(d / "repo.json"),
        commits=_load(d / "commits.json"),
        pulls=_load(d / "pulls.json"),
        pull_comments=_load(d / "pull_comments.json"),
        issues=_load(d / "issues.json"),
        issue_comments=_load(d / "issue_comments.json"),
        files=files,
    )
