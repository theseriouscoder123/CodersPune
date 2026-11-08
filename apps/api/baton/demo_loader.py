"""Build the synthetic "Campus Events App" workspace from demo/ (docs/04_DEMO_DATA.md §2–3)."""

from __future__ import annotations

from sqlalchemy.orm import Session

from baton.db.models import Member, Membership, Source, Workspace
from baton.ingest.chat_export import parse_chat_export
from baton.ingest.fixtures import DEMO_DIR, load_fixture
from baton.ingest.github_normalise import normalise
from baton.ingest.service import store_chunks
from baton.ingest.uploads import parse_upload

PEOPLE = [  # handle, display name, colour, roles
    ("meera", "Meera", "#14213d", ["admin", "reviewer"]),
    ("rohan", "Rohan", "#0891b2", ["leaver", "member"]),
    ("neha", "Neha", "#16a34a", ["successor", "member"]),
    ("kabir", "Kabir", "#ea580c", ["member"]),
]


def build_demo_workspace(db: Session, *, template: bool = True, name: str = "Campus Events App") -> Workspace:
    ws = Workspace(name=name, is_demo_template=template, synthetic=True)
    db.add(ws)
    db.flush()

    members: dict[str, Member] = {}
    for handle, display, colour, roles in PEOPLE:
        m = Member(workspace_id=ws.id, display_name=display, handle=handle, avatar_color=colour)
        db.add(m)
        db.flush()
        members[handle] = m
        for role in roles:
            db.add(Membership(member_id=m.id, workspace_id=ws.id, role=role))

    everyone = {"roles": ["all_members"], "members": []}
    core_team = {"roles": ["reviewer"], "members": [str(members["kabir"].id), str(members["rohan"].id)]}

    # 1. GitHub-shaped fixture (same normaliser as the live connector)
    repo = load_fixture()
    drafts, meta = normalise(repo)
    src_repo = Source(workspace_id=ws.id, type="fixture", name=repo.repo["full_name"], uri=repo.repo["html_url"],
                      acl=everyone, meta={**meta, "synthetic": True})
    db.add(src_repo)
    db.flush()
    store_chunks(db, src_repo, drafts)

    # 2. Meeting notes (one upload source with three files)
    notes_dir = DEMO_DIR / "notes"
    note_files = sorted(notes_dir.glob("*.md"))
    src_notes = Source(workspace_id=ws.id, type="upload", name="Meeting notes", acl=everyone,
                       meta={"files": [p.name for p in note_files], "synthetic": True})
    db.add(src_notes)
    db.flush()
    note_drafts = [d for p in note_files for d in parse_upload(p.name, p.read_bytes())]
    store_chunks(db, src_notes, note_drafts)

    # 3. Chat export: one source per channel so each channel has its own ACL
    channels = parse_chat_export((DEMO_DIR / "chat" / "slack_export.json").read_bytes())
    for channel, acl in (("dev", everyone), ("core-team", core_team)):
        src = Source(workspace_id=ws.id, type="chat_export", name=f"#{channel}", acl=acl,
                     meta={"channel": channel, "synthetic": True})
        db.add(src)
        db.flush()
        store_chunks(db, src, channels.get(channel, []))

    db.flush()
    return ws
