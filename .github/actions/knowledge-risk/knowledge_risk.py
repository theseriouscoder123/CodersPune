"""Baton knowledge-risk report for any GitHub repository (runs inside GitHub Actions; standard library only).

Uses the same rules as Baton's Knowledge risk panel (apps/api/baton/reconstruct/risk.py):
* files one person maintains alone (>= 75% of at least 5 commits), from `git log` of the checked-out repo
* open issues and pull requests assigned to each person, from the GitHub API (the workflow's own token)
* files covered by CODEOWNERS are marked, because a named owner lowers the risk

Writes a Markdown report to the job summary ($GITHUB_STEP_SUMMARY) and a JSON file. No AI, no hosted service, and
nothing leaves the runner except read-only calls to the GitHub API.
"""

from __future__ import annotations

import fnmatch
import json
import os
import subprocess
import sys
import urllib.request
from collections import Counter, defaultdict
from pathlib import Path

HERE = Path(__file__).resolve()
sys.path.insert(0, str(HERE.parents[3] / "apps" / "api"))  # the action ships inside the Baton repo

from baton.reconstruct.risk import SOLE_MIN_COMMITS, SOLE_SHARE, WEIGHTS, ClaimLite, FileStat, assess  # noqa: E402

BOTS = {"dependabot", "renovate", "github-actions", "pre-commit-ci"}
IGNORE = ("package-lock.json", "pnpm-lock.yaml", "yarn.lock", "uv.lock", "poetry.lock", "Cargo.lock", "go.sum")


def git_file_stats(repo: str, since: str | None) -> list[FileStat]:
    """Per-file commit counts by author (mailmap-aware), merges skipped, lock files ignored."""
    cmd = ["git", "-C", repo, "log", "--no-merges", "--format=@@%aN", "--name-only"]
    if since:
        cmd.insert(4, f"--since={since}")
    out = subprocess.run(cmd, check=True, capture_output=True, text=True, encoding="utf-8", errors="replace").stdout
    per: dict[str, Counter] = defaultdict(Counter)
    author = None
    for line in out.splitlines():
        if line.startswith("@@"):
            author = line[2:].strip().lower()
            if author.endswith("[bot]") or author in BOTS:
                author = None  # dependabot, renovate, github-actions: not people
        elif line.strip() and author and not line.endswith(IGNORE):
            per[line.strip()][author] += 1
    root = Path(repo)  # only files that still exist: a deleted file is no one's risk any more
    return [FileStat(p, sum(c.values()), dict(c)) for p, c in per.items() if (root / p).is_file()]


def codeowners(repo: str) -> list[tuple[str, list[str]]]:
    for rel in (".github/CODEOWNERS", "CODEOWNERS", "docs/CODEOWNERS"):
        f = Path(repo) / rel
        if f.exists():
            rules = []
            for line in f.read_text(encoding="utf-8", errors="replace").splitlines():
                parts = line.split("#", 1)[0].split()
                if len(parts) >= 2:
                    rules.append((parts[0], parts[1:]))
            return rules
    return []


def owners_for(path: str, rules: list[tuple[str, list[str]]]) -> list[str]:
    found: list[str] = []
    for pattern, owners in rules:  # last matching rule wins, as on GitHub
        pat = pattern.lstrip("/")
        if pat.endswith("/"):
            pat += "**"
        if fnmatch.fnmatch(path, pat) or fnmatch.fnmatch(path, f"**/{pat}") or path.startswith(pat.rstrip("*")):
            found = owners
    return found


def open_assignments(repo_slug: str, token: str | None) -> list[ClaimLite]:
    """Open issues and PRs with an assignee, as open-work items naming that person."""
    if not repo_slug:
        return []
    items: list[ClaimLite] = []
    url = f"https://api.github.com/repos/{repo_slug}/issues?state=open&per_page=100"
    req = urllib.request.Request(url, headers={"Accept": "application/vnd.github+json", "User-Agent": "baton-knowledge-risk",
                                               **({"Authorization": f"Bearer {token}"} if token else {})})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            data = json.load(r)
    except Exception as exc:  # noqa: BLE001 - the report still works from git history alone
        print(f"::warning::Could not read open issues ({exc}); the report covers git history only.")
        return []
    for it in data:
        kind = "PR" if "pull_request" in it else "issue"
        for a in it.get("assignees") or []:
            items.append(ClaimLite(id=f"{kind}{it['number']}:{a['login']}", type="open_work", status="supported",
                                   text=f"{kind} #{it['number']}: {it['title']}", signal=a["login"].lower()))
    return items


def build_report(repo: str, repo_slug: str, token: str | None, since: str | None) -> dict:
    files = git_file_stats(repo, since)
    rules = codeowners(repo)
    tasks = open_assignments(repo_slug, token)
    people_seen = {a for f in files for a in f.authors} | {t.signal for t in tasks}
    ranked, _ = assess(files, [], {p: p for p in people_seen})
    by_key = {p.key: p for p in ranked}
    for t in tasks:  # assigned work, matched by login
        p = by_key.get(t.signal)
        if p is not None:
            p.open_tasks.append(t)
    ranked.sort(key=lambda p: (-p.score, p.key))
    people = []
    for p in ranked:
        if p.score == 0:
            continue
        sole = [{**f, "codeowners": owners_for(f["path"], rules)} for f in sorted(p.sole_files, key=lambda f: -f["total"])]
        people.append({"person": p.key, "level": p.level, "score": p.score,
                       "sole_files": sole, "unowned_sole_files": sum(1 for f in sole if not f["codeowners"]),
                       "open_assigned": [t.text for t in p.open_tasks]})
    shallow = subprocess.run(["git", "-C", repo, "rev-parse", "--is-shallow-repository"], capture_output=True, text=True).stdout.strip()
    return {"repo": repo_slug or repo, "files_considered": len(files), "codeowners": bool(rules), "shallow_clone": shallow == "true",
            "people": people, "rules": {"sole_share": SOLE_SHARE, "sole_min_commits": SOLE_MIN_COMMITS, "weights": WEIGHTS}}


def to_markdown(rep: dict, top: int = 10) -> str:
    lines = [f"## Knowledge risk · {rep['repo']}", ""]
    if rep["shallow_clone"]:
        lines += ["> ⚠️ Shallow clone: only recent history was read. Use `actions/checkout` with `fetch-depth: 0`.", ""]
    if not rep["people"]:
        return "\n".join(lines + ["No file is maintained by one person alone, and no open work is concentrated on anyone."])
    lines += ["| Person | Level | Files they maintain alone | …of which no CODEOWNERS | Open assigned issues/PRs |",
              "|---|---|---|---|---|"]
    for p in rep["people"][:top]:
        lines.append(f"| {p['person']} | **{p['level']}** ({p['score']}) | {len(p['sole_files'])} | {p['unowned_sole_files']} | {len(p['open_assigned'])} |")
    for p in rep["people"][:3]:
        if p["sole_files"]:
            lines += ["", f"**{p['person']}** maintains alone:"]
            for f in p["sole_files"][:8]:
                owner = f" · CODEOWNERS: {', '.join(f['codeowners'])}" if f["codeowners"] else " · no CODEOWNERS entry"
                lines.append(f"- `{f['path']}` ({f['commits']} of {f['total']} commits){owner}")
    r = rep["rules"]
    lines += ["", f"<sub>Rules: a file is maintained alone when one person made ≥ {int(r['sole_share'] * 100)}% of at least "
                  f"{r['sole_min_commits']} commits. Score = {r['weights']['sole_files']} per such file + {r['weights']['open_tasks']} per open "
                  f"assigned item. Same rules as Baton's Knowledge risk panel; no AI. {rep['files_considered']} files considered.</sub>"]
    return "\n".join(lines)


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    repo = os.environ.get("INPUT_PATH") or "."
    rep = build_report(repo, os.environ.get("GITHUB_REPOSITORY", ""), os.environ.get("INPUT_TOKEN") or None,
                       os.environ.get("INPUT_SINCE") or None)
    md = to_markdown(rep)
    print(md)
    if os.environ.get("GITHUB_STEP_SUMMARY"):
        with open(os.environ["GITHUB_STEP_SUMMARY"], "a", encoding="utf-8") as f:
            f.write(md + "\n")
    out = os.environ.get("INPUT_JSON") or "knowledge-risk.json"
    Path(out).write_text(json.dumps(rep, indent=2), encoding="utf-8")
    if os.environ.get("GITHUB_OUTPUT"):
        high = sum(1 for p in rep["people"] if p["level"] == "high")
        with open(os.environ["GITHUB_OUTPUT"], "a", encoding="utf-8") as f:
            f.write(f"high-risk-people={high}\nreport={out}\n")
    if os.environ.get("INPUT_FAIL_ON_HIGH", "false").lower() == "true" and any(p["level"] == "high" for p in rep["people"]):
        print("::error::At least one person is a high knowledge risk (see the job summary).")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
