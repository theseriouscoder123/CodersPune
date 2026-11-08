from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime


@dataclass
class ChunkDraft:
    """A chunk before scrubbing/storage. `location` must let a user find the exact place in the source."""

    kind: str  # commit | pr | pr_comment | issue | issue_comment | file | note_para | chat_thread | commit_stats
    text: str
    location: dict = field(default_factory=dict)
    author: str | None = None
    occurred_at: datetime | None = None
