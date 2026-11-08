"""Deterministic expected-knowledge checklist from repository signals (spec §7, docs/03 §4). PURE.

Each item becomes a `checklist`-origin claim. Ownership items backed by commit statistics carry their evidence
directly (the generated commit_stats chunk); every other item must be covered by the `cover` step or it stays MISSING.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

OWNERSHIP_SHARE = 0.8
OWNERSHIP_MIN = 5
MAX_DEP_ITEMS = 3
_BORING_DEPS = {"next", "react", "react-dom", "typescript", "tailwindcss", "eslint", "vite", "vue", "svelte",
                "@types/node", "@types/react", "prettier", "postcss", "autoprefixer"}
_PRETTY = {"FIREBASE": "Firebase", "CLOUDINARY": "Cloudinary", "AWS": "AWS", "STRIPE": "Stripe", "SUPABASE": "Supabase",
           "VERCEL": "Vercel", "SENTRY": "Sentry", "OPENAI": "OpenAI", "GOOGLE": "Google", "MONGODB": "MongoDB",
           "DATABASE": "database", "REDIS": "Redis", "SMTP": "email (SMTP)", "TWILIO": "Twilio", "SLACK": "Slack"}


@dataclass
class ChecklistItem:
    type: str
    text: str  # the question/expectation shown while Missing
    subject_key: str
    signal: str  # "Expected because <signal>"
    terms: list[str] = field(default_factory=list)  # full-text search terms for the cover step
    stats_path: str | None = None  # set for commit-stats ownership items (evidence = that stats chunk)
    stats_line: str | None = None


def _slug(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", s.lower()).strip("_")


def _title_terms(title: str) -> list[str]:
    return [w for w in re.findall(r"[A-Za-z][A-Za-z0-9]{2,}", title or "") if w.lower() not in {"the", "and", "for", "with"}][:5]


def build_checklist(signals: dict, leaver_handle: str, leaver_name: str) -> list[ChecklistItem]:
    items: list[ChecklistItem] = []

    for pr in signals.get("open_prs", []):
        if pr.get("author") == leaver_handle:
            items.append(ChecklistItem(
                "open_work", f"Status and next step for PR #{pr['number']} '{pr['title']}'", f"pr.{pr['number']}.status",
                f"open PR #{pr['number']} is authored by {leaver_name}", [f"#{pr['number']}", *_title_terms(pr["title"])]))

    for issue in signals.get("open_issues", []):
        if leaver_handle in (issue.get("assignees") or []):
            items.append(ChecklistItem(
                "open_work", f"Status and next step for issue #{issue['number']} '{issue['title']}'",
                f"issue.{issue['number']}.status", f"open issue #{issue['number']} is assigned to {leaver_name}",
                [f"#{issue['number']}", *_title_terms(issue["title"])]))

    for prefix, keys in sorted((signals.get("env_prefixes") or {}).items()):
        name = _PRETTY.get(prefix, prefix.capitalize())
        items.append(ChecklistItem(
            "contact", f"Who owns the {name} account/project and its billing", f"{_slug(prefix)}.owner",
            f"{', '.join(keys[:3])} in .env.example", [name, "owner", "account", "billing"]))

    stats: dict = signals.get("path_stats") or {}
    for wf in signals.get("workflows", []):
        authors = stats.get(wf, {})
        if not _dominant(authors, leaver_handle):
            name = wf.rsplit("/", 1)[-1].rsplit(".", 1)[0]
            items.append(ChecklistItem(
                "ownership", f"Who maintains the '{name}' workflow and how to run it", f"workflow.{_slug(name)}.owner",
                f"{wf} exists", [name, "workflow", "deploy", "actions"]))

    for path, authors in sorted(stats.items()):
        if _dominant(authors, leaver_handle):
            total = sum(authors.values())
            breakdown = ", ".join(f"{a} {n}" for a, n in sorted(authors.items(), key=lambda kv: -kv[1]))
            subject = "deploy.owner" if path.startswith(".github/workflows/") and "deploy" in path else f"owner.{_slug(path)}"
            items.append(ChecklistItem(
                "ownership",
                f"{leaver_name} is effectively the only maintainer of {path} ({authors[leaver_handle]} of {total} commits)",
                subject, f"{leaver_name} authored at least 80% of commits to {path}",
                stats_path=path, stats_line=f"{path}: {total} commits; {breakdown}"))

    deps = [d for d in signals.get("dependencies", []) if d not in _BORING_DEPS and not d.startswith("@types/")]
    for dep in deps[:MAX_DEP_ITEMS]:
        items.append(ChecklistItem(
            "decision", f"Why {dep} was chosen", f"dependency.{_slug(dep)}", f"{dep} is a runtime dependency",
            [dep, "chose", "switch", "because"]))
    return items


def _dominant(authors: dict, handle: str) -> bool:
    total = sum(authors.values())
    return total >= OWNERSHIP_MIN and authors.get(handle, 0) / total >= OWNERSHIP_SHARE
