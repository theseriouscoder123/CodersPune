"""ORM models. Mirrors docs/02_ARCHITECTURE.md §2; the authoritative DDL is the Alembic migration."""

from __future__ import annotations

import uuid
from datetime import datetime

from pgvector.sqlalchemy import Vector
from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Computed,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    func,
)
from sqlalchemy import (
    text as sql,
)
from sqlalchemy.dialects.postgresql import JSONB, TSVECTOR, UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

ROLES = ("admin", "reviewer", "leaver", "successor", "member")
SOURCE_TYPES = ("github_repo", "upload", "chat_export", "testimony", "fixture")
REVIEW_STATES = ("none", "confirmed", "edited", "rejected", "promoted")
VERDICTS = ("supports", "contradicts", "insufficient", "pending")


def _in(col: str, values: tuple[str, ...]) -> str:
    return f"{col} IN ({', '.join(repr(v) for v in values)})"


class Base(DeclarativeBase):
    pass


def pk() -> Mapped[uuid.UUID]:
    return mapped_column(UUID(as_uuid=True), primary_key=True, server_default=sql("gen_random_uuid()"))


def created() -> Mapped[datetime]:
    return mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


def fk(target: str, *, nullable: bool = False, ondelete: str | None = "CASCADE") -> Mapped:
    return mapped_column(UUID(as_uuid=True), ForeignKey(target, ondelete=ondelete), nullable=nullable)


class Workspace(Base):
    __tablename__ = "workspaces"
    id: Mapped[uuid.UUID] = pk()
    name: Mapped[str] = mapped_column(Text, nullable=False)
    is_demo_template: Mapped[bool] = mapped_column(Boolean, server_default=sql("false"), nullable=False)
    sandbox_of: Mapped[uuid.UUID | None] = fk("workspaces.id", nullable=True, ondelete="SET NULL")
    visitor_id: Mapped[str | None] = mapped_column(Text)
    synthetic: Mapped[bool] = mapped_column(Boolean, server_default=sql("false"), nullable=False)
    created_at: Mapped[datetime] = created()


class Member(Base):
    __tablename__ = "members"
    id: Mapped[uuid.UUID] = pk()
    workspace_id: Mapped[uuid.UUID] = fk("workspaces.id")
    display_name: Mapped[str] = mapped_column(Text, nullable=False)
    handle: Mapped[str] = mapped_column(Text, nullable=False)
    avatar_color: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = created()


class Membership(Base):
    __tablename__ = "memberships"
    __table_args__ = (CheckConstraint(_in("role", ROLES), name="memberships_role_check"),)
    member_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("members.id", ondelete="CASCADE"), primary_key=True
    )
    workspace_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("workspaces.id", ondelete="CASCADE"), primary_key=True
    )
    role: Mapped[str] = mapped_column(Text, primary_key=True)
    created_at: Mapped[datetime] = created()


class Source(Base):
    __tablename__ = "sources"
    __table_args__ = (CheckConstraint(_in("type", SOURCE_TYPES), name="sources_type_check"),)
    id: Mapped[uuid.UUID] = pk()
    workspace_id: Mapped[uuid.UUID] = fk("workspaces.id")
    type: Mapped[str] = mapped_column(Text, nullable=False)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    uri: Mapped[str | None] = mapped_column(Text)
    meta: Mapped[dict] = mapped_column(JSONB, server_default=sql("'{}'::jsonb"), nullable=False)
    acl: Mapped[dict] = mapped_column(JSONB, server_default=sql("'{}'::jsonb"), nullable=False)
    acl_key: Mapped[str] = mapped_column(Text, server_default=sql("''"), nullable=False)
    scrub_report: Mapped[dict] = mapped_column(JSONB, server_default=sql("'{}'::jsonb"), nullable=False)
    ingested_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = created()


class Chunk(Base):
    __tablename__ = "chunks"
    __table_args__ = (
        Index("chunks_tsv_idx", "tsv", postgresql_using="gin"),
        Index("chunks_ws_acl_idx", "workspace_id", "acl_key"),
        Index("chunks_source_idx", "source_id"),
    )
    id: Mapped[uuid.UUID] = pk()
    source_id: Mapped[uuid.UUID] = fk("sources.id")
    workspace_id: Mapped[uuid.UUID] = fk("workspaces.id")
    kind: Mapped[str] = mapped_column(Text, nullable=False)
    text: Mapped[str] = mapped_column(Text, nullable=False)
    location: Mapped[dict] = mapped_column(JSONB, server_default=sql("'{}'::jsonb"), nullable=False)
    author: Mapped[str | None] = mapped_column(Text)
    occurred_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    acl_key: Mapped[str] = mapped_column(Text, server_default=sql("''"), nullable=False)
    tsv = mapped_column(TSVECTOR, Computed("to_tsvector('english', text)", persisted=True))
    embedding = mapped_column(Vector(384), nullable=True)
    created_at: Mapped[datetime] = created()


class Run(Base):
    __tablename__ = "runs"
    id: Mapped[uuid.UUID] = pk()
    workspace_id: Mapped[uuid.UUID] = fk("workspaces.id")
    status: Mapped[str] = mapped_column(Text, server_default=sql("'queued'"), nullable=False)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    stats: Mapped[dict] = mapped_column(JSONB, server_default=sql("'{}'::jsonb"), nullable=False)
    error: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = created()


class Job(Base):
    __tablename__ = "jobs"
    __table_args__ = (Index("jobs_run_idx", "run_id"),)
    id: Mapped[uuid.UUID] = pk()
    run_id: Mapped[uuid.UUID] = fk("runs.id")
    step: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(Text, server_default=sql("'pending'"), nullable=False)
    progress: Mapped[int] = mapped_column(Integer, server_default=sql("0"), nullable=False)
    total: Mapped[int] = mapped_column(Integer, server_default=sql("0"), nullable=False)
    message: Mapped[str | None] = mapped_column(Text)
    state: Mapped[dict] = mapped_column(JSONB, server_default=sql("'{}'::jsonb"), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    created_at: Mapped[datetime] = created()


class ConflictGroup(Base):
    __tablename__ = "conflict_groups"
    id: Mapped[uuid.UUID] = pk()
    workspace_id: Mapped[uuid.UUID] = fk("workspaces.id")
    subject_key: Mapped[str] = mapped_column(Text, nullable=False)
    resolved: Mapped[bool] = mapped_column(Boolean, server_default=sql("false"), nullable=False)
    resolution: Mapped[str | None] = mapped_column(Text)
    resolved_by: Mapped[uuid.UUID | None] = fk("members.id", nullable=True, ondelete="SET NULL")
    created_at: Mapped[datetime] = created()


class Claim(Base):
    __tablename__ = "claims"
    __table_args__ = (
        CheckConstraint(_in("review_state", REVIEW_STATES), name="claims_review_state_check"),
        Index("claims_ws_idx", "workspace_id"),
        Index("claims_subject_idx", "workspace_id", "subject_key"),
    )
    id: Mapped[uuid.UUID] = pk()
    workspace_id: Mapped[uuid.UUID] = fk("workspaces.id")
    run_id: Mapped[uuid.UUID | None] = fk("runs.id", nullable=True, ondelete="SET NULL")
    type: Mapped[str] = mapped_column(Text, nullable=False)
    text: Mapped[str] = mapped_column(Text, nullable=False)
    subject_key: Mapped[str] = mapped_column(Text, nullable=False)
    value: Mapped[str | None] = mapped_column(Text)
    occurred_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    origin: Mapped[str] = mapped_column(Text, nullable=False)
    stated: Mapped[bool] = mapped_column(Boolean, server_default=sql("true"), nullable=False)
    supersedes_hint: Mapped[bool] = mapped_column(Boolean, server_default=sql("false"), nullable=False)
    superseded_by: Mapped[uuid.UUID | None] = fk("claims.id", nullable=True, ondelete="SET NULL")
    conflict_group_id: Mapped[uuid.UUID | None] = fk("conflict_groups.id", nullable=True, ondelete="SET NULL")
    review_state: Mapped[str] = mapped_column(Text, server_default=sql("'none'"), nullable=False)
    reviewer_note: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str | None] = mapped_column(Text)
    status_reason: Mapped[str | None] = mapped_column(Text)
    about_member_id: Mapped[uuid.UUID | None] = fk("members.id", nullable=True, ondelete="SET NULL")
    meta: Mapped[dict] = mapped_column(JSONB, server_default=sql("'{}'::jsonb"), nullable=False)
    created_at: Mapped[datetime] = created()


class Evidence(Base):
    __tablename__ = "evidence"
    __table_args__ = (
        CheckConstraint(_in("verdict", VERDICTS), name="evidence_verdict_check"),
        Index("evidence_claim_idx", "claim_id"),
        Index("evidence_chunk_idx", "chunk_id"),
    )
    id: Mapped[uuid.UUID] = pk()
    claim_id: Mapped[uuid.UUID] = fk("claims.id")
    chunk_id: Mapped[uuid.UUID] = fk("chunks.id")
    quote: Mapped[str] = mapped_column(Text, nullable=False)
    match_score: Mapped[int] = mapped_column(Integer, server_default=sql("0"), nullable=False)
    quote_found: Mapped[bool] = mapped_column(Boolean, server_default=sql("false"), nullable=False)
    match_start: Mapped[int | None] = mapped_column(Integer)
    match_end: Mapped[int | None] = mapped_column(Integer)
    verdict: Mapped[str] = mapped_column(Text, server_default=sql("'pending'"), nullable=False)
    verdict_reason: Mapped[str | None] = mapped_column(Text)
    verifier: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = created()


class ReviewEvent(Base):
    __tablename__ = "review_events"
    __table_args__ = (Index("review_events_claim_idx", "claim_id"),)
    id: Mapped[uuid.UUID] = pk()
    claim_id: Mapped[uuid.UUID] = fk("claims.id")
    actor_member_id: Mapped[uuid.UUID | None] = fk("members.id", nullable=True, ondelete="SET NULL")
    actor_role: Mapped[str] = mapped_column(Text, nullable=False)
    action: Mapped[str] = mapped_column(Text, nullable=False)
    before: Mapped[dict | None] = mapped_column(JSONB)
    after: Mapped[dict | None] = mapped_column(JSONB)
    note: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = created()


class Handover(Base):
    __tablename__ = "handovers"
    id: Mapped[uuid.UUID] = pk()
    workspace_id: Mapped[uuid.UUID] = fk("workspaces.id")
    leaver_member_id: Mapped[uuid.UUID] = fk("members.id")
    successor_member_id: Mapped[uuid.UUID] = fk("members.id")
    scope: Mapped[str | None] = mapped_column(Text)
    show_restricted_stubs: Mapped[bool] = mapped_column(Boolean, server_default=sql("false"), nullable=False)
    created_at: Mapped[datetime] = created()


class HandoverVersion(Base):
    __tablename__ = "handover_versions"
    id: Mapped[uuid.UUID] = pk()
    handover_id: Mapped[uuid.UUID] = fk("handovers.id")
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    approved_by: Mapped[uuid.UUID | None] = fk("members.id", nullable=True, ondelete="SET NULL")
    approved_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    note: Mapped[str | None] = mapped_column(Text)
    snapshot: Mapped[dict] = mapped_column(JSONB, nullable=False)
    created_at: Mapped[datetime] = created()


class Acknowledgement(Base):
    """Round 3 seam (improvement #3). Unused in Round 2."""

    __tablename__ = "acknowledgements"
    id: Mapped[uuid.UUID] = pk()
    handover_version_id: Mapped[uuid.UUID] = fk("handover_versions.id")
    claim_id: Mapped[uuid.UUID] = fk("claims.id")
    member_id: Mapped[uuid.UUID] = fk("members.id")
    state: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = created()


class Visitor(Base):
    __tablename__ = "visitors"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    sandbox_workspace_id: Mapped[uuid.UUID | None] = fk("workspaces.id", nullable=True, ondelete="SET NULL")
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    created_at: Mapped[datetime] = created()


class LlmCall(Base):
    """Metadata only, never prompt or response text (see 02 §5)."""

    __tablename__ = "llm_calls"
    id: Mapped[uuid.UUID] = pk()
    workspace_id: Mapped[uuid.UUID | None] = fk("workspaces.id", nullable=True, ondelete="SET NULL")
    run_id: Mapped[uuid.UUID | None] = fk("runs.id", nullable=True, ondelete="SET NULL")
    purpose: Mapped[str] = mapped_column(Text, nullable=False)
    provider: Mapped[str] = mapped_column(Text, nullable=False)
    model: Mapped[str] = mapped_column(Text, nullable=False)
    tokens_in: Mapped[int | None] = mapped_column(Integer)
    tokens_out: Mapped[int | None] = mapped_column(Integer)
    latency_ms: Mapped[int | None] = mapped_column(Integer)
    ok: Mapped[bool] = mapped_column(Boolean, nullable=False)
    error: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = created()
