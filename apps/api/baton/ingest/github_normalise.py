"""GitHub REST-shaped data -> chunks + repo signals.

Shared by the live connector (ingest/github.py) and the demo fixture loader (ingest/fixtures.py), so the demo goes
through exactly the same code path as a real repository (DECISIONS D5).
"""

from __future__ import annotations

import json
import re
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import datetime

from baton.ingest.chunker import split_code, split_markdown
from baton.ingest.types import ChunkDraft

MAX_COMMIT_GROUP_CHARS = 1200
OWNERSHIP_MIN_COMMITS = 5


@dataclass
class RepoData:
    repo: dict
    commits: list[dict] = field(default_factory=list)
    pulls: list[dict] = field(default_factory=list)
    pull_comments: list[dict] = field(default_factory=list)
    issues: list[dict] = field(default_factory=list)
    issue_comments: list[dict] = field(default_factory=list)
    files: dict[str, str] = field(default_factory=dict)  # path -> decoded text


def parse_time(s: str | None) -> datetime | None:
    if not s:
        return None
    return datetime.fromisoformat(s)


def _day(s: str | None) -> str:
    return (s or "")[:10]


def _login(u: dict | None) -> str | None:
    return (u or {}).get("login")


def _num_from_url(url: str | None) -> int | None:
    m = re.search(r"/(?:issues|pulls)/(\d+)$", url or "")
    return int(m.group(1)) if m else None


def normalise(data: RepoData) -> tuple[list[ChunkDraft], dict]:
    repo_url = data.repo.get("html_url", "")
    drafts: list[ChunkDraft] = []

    # --- files
    for path, text in sorted(data.files.items()):
        url = f"{repo_url}/blob/{data.repo.get('default_branch', 'main')}/{path}"
        is_md = path.lower().endswith((".md", ".markdown", ".txt")) or "/" not in path and path.upper().startswith("README")
        pieces = split_markdown(text) if is_md else split_code(text)
        for piece, extra in pieces:
            drafts.append(ChunkDraft("file", f"File {path}\n\n{piece}", {"file": path, "url": url, **extra,
                                                                          "prefix_lines": 2}))

    # --- PRs
    pr_titles = {p["number"]: p.get("title", "") for p in data.pulls}
    for p in data.pulls:
        state = "merged" if p.get("merged_at") else p.get("state", "open")
        when = p.get("merged_at") or p.get("created_at")
        header = (f"PR #{p['number']} '{p.get('title', '')}' by {_login(p.get('user'))} "
                  f"({state}, opened {_day(p.get('created_at'))}"
                  + (f", merged {_day(p.get('merged_at'))}" if p.get("merged_at") else "") + ")")
        reviewers = [r.get("login") for r in p.get("requested_reviewers") or []]
        if reviewers:
            header += f"\nReview requested from: {', '.join(reviewers)}"
        drafts.append(ChunkDraft("pr", f"{header}\n\n{p.get('body') or ''}".strip(),
                                 {"pr": p["number"], "url": p.get("html_url")},
                                 _login(p.get("user")), parse_time(when)))

    for c in data.pull_comments:
        n = _num_from_url(c.get("pull_request_url"))
        where = f"{c.get('path')}:{c.get('line')}" if c.get("path") else ""
        text = (f"Review comment on PR #{n} '{pr_titles.get(n, '')}' {('at ' + where) if where else ''} "
                f"by {_login(c.get('user'))} ({_day(c.get('created_at'))}):\n{c.get('body', '')}")
        drafts.append(ChunkDraft("pr_comment", text, {"pr": n, "comment_id": c.get("id"), "url": c.get("html_url"),
                                                      "file": c.get("path"), "line": c.get("line")},
                                 _login(c.get("user")), parse_time(c.get("created_at"))))

    # --- issues
    issue_titles = {i["number"]: i.get("title", "") for i in data.issues}
    for i in data.issues:
        if i.get("pull_request"):
            continue  # the issues endpoint also lists PRs
        assignees = [a.get("login") for a in i.get("assignees") or []] or ([_login(i.get("assignee"))] if i.get("assignee") else [])
        header = (f"Issue #{i['number']} '{i.get('title', '')}' opened by {_login(i.get('user'))} on {_day(i.get('created_at'))} "
                  f"({i.get('state')}{', closed ' + _day(i.get('closed_at')) if i.get('closed_at') else ''}"
                  f"{', assigned to ' + ', '.join(assignees) if assignees else ', unassigned'})")
        drafts.append(ChunkDraft("issue", f"{header}\n\n{i.get('body') or ''}".strip(),
                                 {"issue": i["number"], "url": i.get("html_url")},
                                 _login(i.get("user")), parse_time(i.get("created_at"))))

    for c in data.issue_comments:
        n = _num_from_url(c.get("issue_url"))
        is_pr = n in pr_titles
        label = f"PR #{n} '{pr_titles.get(n, '')}'" if is_pr else f"issue #{n} '{issue_titles.get(n, '')}'"
        text = f"Comment on {label} by {_login(c.get('user'))} ({_day(c.get('created_at'))}):\n{c.get('body', '')}"
        loc = {("pr" if is_pr else "issue"): n, "comment_id": c.get("id"), "url": c.get("html_url")}
        drafts.append(ChunkDraft("issue_comment", text, loc, _login(c.get("user")), parse_time(c.get("created_at"))))

    # --- commits, grouped chronologically into readable chunks
    commits = sorted(data.commits, key=lambda c: c["commit"]["author"]["date"])
    group: list[dict] = []
    group_len = 0

    def flush():
        nonlocal group, group_len
        if not group:
            return
        lines = [f"- {_day(c['commit']['author']['date'])} {_commit_author(c)}: "
                 f"{c['commit']['message'].splitlines()[0]} ({c['sha'][:7]})" for c in group]
        text = f"Commits {_day(group[0]['commit']['author']['date'])} to {_day(group[-1]['commit']['author']['date'])}:\n" + "\n".join(lines)
        drafts.append(ChunkDraft("commit", text, {"shas": [c["sha"] for c in group], "url": group[-1].get("html_url")},
                                 None, parse_time(group[-1]["commit"]["author"]["date"])))
        group, group_len = [], 0

    for c in commits:
        line_len = len(c["commit"]["message"].splitlines()[0]) + 40
        if group and group_len + line_len > MAX_COMMIT_GROUP_CHARS:
            flush()
        group.append(c)
        group_len += line_len
    flush()

    # --- computed commit statistics per path (evidence for ownership checklist items, spec §7)
    stats = path_author_stats(data.commits)
    last_commit = parse_time(commits[-1]["commit"]["author"]["date"]) if commits else None
    for path, authors in sorted(stats.items()):
        total = sum(authors.values())
        if total < OWNERSHIP_MIN_COMMITS:
            continue
        breakdown = ", ".join(f"{a} {n}" for a, n in authors.most_common())
        text = f"{path}: {total} commits; {breakdown}"
        drafts.append(ChunkDraft("commit_stats", f"Commit statistics (computed from repository history)\n{text}",
                                 {"file": path, "computed": True, "url": f"{repo_url}/commits/main/{path}"},
                                 None, last_commit))

    return drafts, {"signals": repo_signals(data, stats)}


def _commit_author(c: dict) -> str:
    return _login(c.get("author")) or c["commit"]["author"].get("name", "unknown")


def path_author_stats(commits: list[dict]) -> dict[str, Counter]:
    stats: dict[str, Counter] = defaultdict(Counter)
    for c in commits:
        for f in c.get("files") or []:
            stats[f["filename"]][_commit_author(c)] += 1
    return stats


_ENV_LINE = re.compile(r"^\s*([A-Z][A-Z0-9_]*)\s*=", re.MULTILINE)


def repo_signals(data: RepoData, stats: dict[str, Counter]) -> dict:
    """Structured facts for the deterministic expected-knowledge checklist (reconstruct/checklist.py)."""
    open_prs = [{"number": p["number"], "title": p.get("title"), "author": _login(p.get("user")), "url": p.get("html_url")}
                for p in data.pulls if p.get("state") == "open"]
    open_issues = [{"number": i["number"], "title": i.get("title"), "url": i.get("html_url"),
                    "assignees": [a.get("login") for a in i.get("assignees") or []]}
                   for i in data.issues if i.get("state") == "open" and not i.get("pull_request")]
    env_keys = _ENV_LINE.findall(data.files.get(".env.example", ""))
    prefixes: dict[str, list[str]] = defaultdict(list)
    for k in env_keys:
        k2 = k.removeprefix("NEXT_PUBLIC_").removeprefix("VITE_")
        prefixes[k2.split("_")[0]].append(k)
    workflows = [p for p in data.files if p.startswith(".github/workflows/") and p.endswith((".yml", ".yaml"))]
    deps: list[str] = []
    if "package.json" in data.files:
        try:
            deps = sorted((json.loads(data.files["package.json"]).get("dependencies") or {}).keys())
        except json.JSONDecodeError:
            pass
    return {
        "repo": data.repo.get("full_name"),
        "open_prs": open_prs,
        "open_issues": open_issues,
        "env_prefixes": {p: ks for p, ks in prefixes.items() if len(ks) >= 1},
        "workflows": workflows,
        "path_stats": {p: dict(a) for p, a in stats.items() if sum(a.values()) >= OWNERSHIP_MIN_COMMITS},
        "dependencies": deps,
    }
