"""Live GitHub connector (public repos; server-side GITHUB_TOKEN raises the rate limit).

Fetches a capped, judge-speed slice of a repository (docs/02 §6) into RepoData, which then goes through the same
normaliser as the demo fixture.
"""

from __future__ import annotations

import asyncio
import base64
import fnmatch
import re

import httpx

from baton.config import get_settings
from baton.ingest.github_normalise import RepoData

API = "https://api.github.com"
MAX_COMMITS = 300
MAX_COMMIT_DETAILS = 100  # per-commit file lists (1 request each) for ownership stats
MAX_PULLS = 60
MAX_ISSUES = 60
MAX_DOC_FILES = 30
MAX_FILE_BYTES = 200_000
CONCURRENCY = 8

FILE_PATTERNS = [
    "README*", "docs/**/*.md", "docs/*.md", "CODEOWNERS", ".github/CODEOWNERS", ".github/workflows/*.yml",
    ".github/workflows/*.yaml", ".env.example", "package.json", "requirements*.txt", "pyproject.toml",
]


class GitHubError(RuntimeError):
    """User-facing message (shown in the run's error state)."""


def parse_repo(url_or_slug: str) -> tuple[str, str]:
    s = url_or_slug.strip().removesuffix(".git").rstrip("/")
    m = re.match(r"^(?:https?://)?(?:www\.)?github\.com/([\w.-]+)/([\w.-]+)", s) or re.match(r"^([\w.-]+)/([\w.-]+)$", s)
    if not m:
        raise GitHubError("That doesn't look like a GitHub repository. Use https://github.com/owner/repo")
    return m.group(1), m.group(2)


def _wanted(path: str) -> bool:
    return any(fnmatch.fnmatch(path, p) for p in FILE_PATTERNS)


class _Client:
    def __init__(self, token: str):
        headers = {"Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28",
                   "User-Agent": "baton-handover"}
        if token:
            headers["Authorization"] = f"Bearer {token}"
        self.http = httpx.AsyncClient(base_url=API, headers=headers, timeout=20)
        self.sem = asyncio.Semaphore(CONCURRENCY)

    async def get(self, path: str, **params):
        async with self.sem:
            r = await self.http.get(path, params=params or None)
        if r.status_code == 404:
            raise GitHubError("Repository not found. It must be public (private repos aren't supported in this build).")
        if r.status_code in (403, 429) and r.headers.get("x-ratelimit-remaining") == "0":
            raise GitHubError("GitHub rate limit reached. Try again in a few minutes.")
        if r.status_code >= 400:
            raise GitHubError(f"GitHub API error {r.status_code} for {path}")
        return r.json()

    async def pages(self, path: str, limit: int, **params) -> list:
        out: list = []
        page = 1
        while len(out) < limit:
            batch = await self.get(path, per_page=min(100, limit), page=page, **params)
            if not batch:
                break
            out.extend(batch)
            if len(batch) < min(100, limit):
                break
            page += 1
        return out[:limit]


async def _fetch(owner: str, name: str, token: str) -> RepoData:
    c = _Client(token)
    try:
        base = f"/repos/{owner}/{name}"
        repo = await c.get(base)
        if repo.get("private"):
            raise GitHubError("Private repositories aren't supported in this build.")
        branch = repo.get("default_branch", "main")

        tree_task = c.get(f"{base}/git/trees/{branch}", recursive="1")
        commits_task = c.pages(f"{base}/commits", MAX_COMMITS)
        pulls_task = c.pages(f"{base}/pulls", MAX_PULLS, state="all", sort="updated", direction="desc")
        issues_task = c.pages(f"{base}/issues", MAX_ISSUES, state="all", sort="updated", direction="desc")
        pcom_task = c.pages(f"{base}/pulls/comments", 100, sort="created", direction="desc")
        icom_task = c.pages(f"{base}/issues/comments", 200, sort="created", direction="desc")
        tree, commits, pulls, issues, pull_comments, issue_comments = await asyncio.gather(
            tree_task, commits_task, pulls_task, issues_task, pcom_task, icom_task)

        paths = [t["path"] for t in tree.get("tree", []) if t.get("type") == "blob" and _wanted(t["path"])
                 and t.get("size", 0) <= MAX_FILE_BYTES][:MAX_DOC_FILES]

        async def file(path: str):
            body = await c.get(f"{base}/contents/{path}", ref=branch)
            try:
                return path, base64.b64decode(body.get("content", "")).decode("utf-8")
            except (UnicodeDecodeError, ValueError):
                return path, None

        async def detail(sha: str):
            return await c.get(f"{base}/commits/{sha}")

        files_res, details = await asyncio.gather(
            asyncio.gather(*(file(p) for p in paths)),
            asyncio.gather(*(detail(cm["sha"]) for cm in commits[:MAX_COMMIT_DETAILS])),
        )
        by_sha = {d["sha"]: d for d in details}
        for cm in commits:
            cm["files"] = [{"filename": f["filename"]} for f in by_sha.get(cm["sha"], {}).get("files", [])]

        known_prs = {p["number"] for p in pulls}
        issues = [i for i in issues if not i.get("pull_request")]
        known_issues = {i["number"] for i in issues}
        issue_comments = [ic for ic in issue_comments
                          if int(ic.get("issue_url", "0").rsplit("/", 1)[-1]) in known_prs | known_issues]
        pull_comments = [pc for pc in pull_comments
                         if int(pc.get("pull_request_url", "0").rsplit("/", 1)[-1]) in known_prs]

        return RepoData(repo=repo, commits=commits, pulls=pulls, pull_comments=pull_comments, issues=issues,
                        issue_comments=issue_comments, files={p: t for p, t in files_res if t is not None})
    except httpx.HTTPError as exc:
        raise GitHubError(f"Couldn't reach GitHub ({type(exc).__name__}). Try again.") from exc
    finally:
        await c.http.aclose()


def fetch_repo(url_or_slug: str, token: str | None = None) -> RepoData:
    owner, name = parse_repo(url_or_slug)
    return asyncio.run(_fetch(owner, name, get_settings().github_token if token is None else token))
