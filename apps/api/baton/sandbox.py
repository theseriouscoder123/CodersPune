"""Per-visitor sandbox: deep-copy the precomputed demo template in ONE transaction with fresh UUIDs (docs/02 §4).

Copied: workspace, members, memberships, sources, chunks, claims, evidence, conflict groups, claim relations, handover
(no versions, review events, interviews or acknowledgements: a visitor starts the review from scratch). Uses INSERT ... SELECT through a temp id map, so it's a handful of statements regardless of size.
"""

from __future__ import annotations

import uuid

from sqlalchemy import text
from sqlalchemy.orm import Session

_MAP = "(SELECT new FROM _idmap WHERE old = {col})"


def _m(col: str) -> str:
    return _MAP.format(col=col)


def clone_workspace(db: Session, template_id: uuid.UUID, visitor_id: str) -> uuid.UUID:
    t = str(template_id)
    db.execute(text("CREATE TEMP TABLE IF NOT EXISTS _idmap (old uuid PRIMARY KEY, new uuid NOT NULL) ON COMMIT DROP"))
    db.execute(text("DELETE FROM _idmap"))
    db.execute(text("""
        INSERT INTO _idmap (old, new)
        SELECT id, gen_random_uuid() FROM (
            SELECT id FROM workspaces WHERE id = :t
            UNION ALL SELECT id FROM members WHERE workspace_id = :t
            UNION ALL SELECT id FROM sources WHERE workspace_id = :t
            UNION ALL SELECT id FROM chunks WHERE workspace_id = :t
            UNION ALL SELECT id FROM claims WHERE workspace_id = :t
            UNION ALL SELECT e.id FROM evidence e JOIN claims c ON c.id = e.claim_id WHERE c.workspace_id = :t
            UNION ALL SELECT id FROM conflict_groups WHERE workspace_id = :t
            UNION ALL SELECT id FROM handovers WHERE workspace_id = :t
        ) ids"""), {"t": t})

    new_ws = db.execute(text(f"""
        INSERT INTO workspaces (id, name, is_demo_template, sandbox_of, visitor_id, synthetic)
        SELECT {_m('w.id')}, w.name, false, w.id, :v, w.synthetic FROM workspaces w WHERE w.id = :t
        RETURNING id"""), {"t": t, "v": visitor_id}).scalar_one()

    stmts = [
        f"""INSERT INTO members (id, workspace_id, display_name, handle, avatar_color)
            SELECT {_m('id')}, {_m('workspace_id')}, display_name, handle, avatar_color FROM members WHERE workspace_id = :t""",
        f"""INSERT INTO memberships (member_id, workspace_id, role)
            SELECT {_m('member_id')}, {_m('workspace_id')}, role FROM memberships WHERE workspace_id = :t""",
        # Source ACLs reference member ids: remap them inside the JSON.
        f"""INSERT INTO sources (id, workspace_id, type, name, uri, meta, acl, acl_key, scrub_report, ingested_at)
            SELECT {_m('s.id')}, {_m('s.workspace_id')}, s.type, s.name, s.uri, s.meta,
                   jsonb_build_object('roles', COALESCE(s.acl->'roles', '[]'::jsonb),
                       'members', COALESCE((SELECT jsonb_agg(to_jsonb((SELECT new FROM _idmap WHERE old = m::uuid)::text))
                                            FROM jsonb_array_elements_text(COALESCE(s.acl->'members', '[]'::jsonb)) m), '[]'::jsonb)),
                   '', s.scrub_report, s.ingested_at
            FROM sources s WHERE s.workspace_id = :t""",
        f"""INSERT INTO chunks (id, source_id, workspace_id, kind, text, location, author, occurred_at, acl_key)
            SELECT {_m('c.id')}, {_m('c.source_id')}, {_m('c.workspace_id')}, c.kind, c.text, c.location, c.author,
                   c.occurred_at, '' FROM chunks c WHERE c.workspace_id = :t""",
        f"""INSERT INTO conflict_groups (id, workspace_id, subject_key, resolved, resolution)
            SELECT {_m('id')}, {_m('workspace_id')}, subject_key, resolved, resolution FROM conflict_groups WHERE workspace_id = :t""",
        f"""INSERT INTO claims (id, workspace_id, run_id, type, text, subject_key, value, occurred_at, origin, stated,
                               supersedes_hint, superseded_by, conflict_group_id, review_state, reviewer_note, status,
                               status_reason, about_member_id, meta, stale_reason)
            SELECT {_m('id')}, {_m('workspace_id')}, NULL, type, text, subject_key, value, occurred_at, origin, stated,
                   supersedes_hint, NULL, {_m('conflict_group_id')}, review_state, reviewer_note, status, status_reason,
                   {_m('about_member_id')}, meta, stale_reason
            FROM claims WHERE workspace_id = :t""",
        f"""UPDATE claims n SET superseded_by = {_m('o.superseded_by')}
            FROM claims o WHERE o.workspace_id = :t AND o.superseded_by IS NOT NULL AND n.id = {_m('o.id')}""",
        f"""UPDATE claims n SET derived_from = {_m('o.derived_from')}
            FROM claims o WHERE o.workspace_id = :t AND o.derived_from IS NOT NULL AND n.id = {_m('o.id')}""",
        f"""INSERT INTO claim_relations (workspace_id, from_claim_id, to_claim_id, relation, decided_by, signal, note)
            SELECT {_m('workspace_id')}, {_m('from_claim_id')}, {_m('to_claim_id')}, relation, decided_by, signal, note
            FROM claim_relations WHERE workspace_id = :t""",
        f"""INSERT INTO evidence (id, claim_id, chunk_id, quote, match_score, quote_found, match_start, match_end, verdict,
                                 verdict_reason, verifier)
            SELECT {_m('e.id')}, {_m('e.claim_id')}, {_m('e.chunk_id')}, e.quote, e.match_score, e.quote_found,
                   e.match_start, e.match_end, e.verdict, e.verdict_reason, e.verifier
            FROM evidence e JOIN claims c ON c.id = e.claim_id WHERE c.workspace_id = :t""",
        f"""INSERT INTO handovers (id, workspace_id, leaver_member_id, successor_member_id, scope, name, show_restricted_stubs)
            SELECT {_m('id')}, {_m('workspace_id')}, {_m('leaver_member_id')}, {_m('successor_member_id')}, scope, name,
                   show_restricted_stubs FROM handovers WHERE workspace_id = :t""",
    ]
    for s in stmts:
        db.execute(text(s), {"t": t})

    # acl_key embeds member ids, so recompute it for the copy (same function as ingestion).
    from baton.acl import acl_key
    from baton.db.models import Source

    for src in db.query(Source).filter(Source.workspace_id == new_ws):
        src.acl_key = acl_key(src.acl)
        db.execute(text("UPDATE chunks SET acl_key = :k WHERE source_id = :s"), {"k": src.acl_key, "s": str(src.id)})
    db.flush()
    return new_ws
