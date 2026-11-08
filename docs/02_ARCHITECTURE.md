# 02 — Architecture

## 1. Data flow

```
 Sources                 Ingestion                         Reconstruction                Verification              Review & share
┌──────────────┐   ┌──────────────────────────┐   ┌───────────────────────────┐   ┌──────────────────────┐   ┌─────────────────────────┐
│ GitHub repo  │──▶│ normalise → SCRUB SECRETS│──▶│ extractor (LLM, batched   │──▶│ quote_match (fuzzy)  │──▶│ review events, versions │
│ uploads      │   │ → chunk (+timestamps,    │   │   by acl_key)             │   │ entailment verifier  │   │ visibility projection   │
│ chat export  │   │   locations) → ACL tag   │   │ checklist (deterministic) │   │ status.py (rules)    │   │ successor handover      │
│ demo fixture │   │ → index (tsvector, opt.  │   │ conflicts + timeline      │   │                      │   │                         │
└──────────────┘   │   embeddings)            │   └───────────────────────────┘   └──────────────────────┘   └─────────────────────────┘
                   └──────────────────────────┘
```

A **run** = one pipeline execution over a workspace's current sources. Runs are idempotent per workspace: a new run
replaces the unreviewed claims, and keeps claims that have review events (it re-attaches them by `subject_key` + text
similarity ≥ 85, and otherwise keeps them as "from previous run").

## 2. Database schema (Postgres)

Use Alembic. UUID primary keys (`gen_random_uuid()`). Every table has `created_at timestamptz default now()`.

```sql
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

workspaces(id, name, is_demo_template bool, sandbox_of uuid null, visitor_id text null, synthetic bool, created_at)

members(id, workspace_id, display_name, handle, avatar_color)
memberships(member_id, workspace_id, role text CHECK (role IN ('admin','reviewer','leaver','successor','member')))
  -- PK (member_id, workspace_id, role)

sources(id, workspace_id, type text CHECK (type IN ('github_repo','upload','chat_export','testimony','fixture')),
        name, uri, meta jsonb, acl jsonb,            -- {"members":[uuid...], "roles":["reviewer","all_members"]}
        acl_key text,                                -- canonical sorted string of acl, for batching
        scrub_report jsonb, ingested_at)

chunks(id, source_id, workspace_id, kind text,       -- 'commit','pr','pr_comment','issue','issue_comment','file','note_para','chat_thread','commit_stats'
       text, location jsonb,                         -- {"file":"src/upload.ts","line_start":41,"line_end":41,"sha":"…"} | {"pr":88,"comment_id":…,"url":…} | {"channel":"#dev","ts":"…","permalink":…}
       author text, occurred_at timestamptz, acl_key text,
       tsv tsvector GENERATED ALWAYS AS (to_tsvector('english', text)) STORED,
       embedding vector(384) NULL)
  -- INDEX gin(tsv), INDEX (workspace_id, acl_key)

runs(id, workspace_id, status text, started_at, finished_at, stats jsonb, error text)
jobs(id, run_id, step text, status text, progress int, total int, message text, updated_at)

claims(id, workspace_id, run_id, type text, text, subject_key text, value text null,
       occurred_at timestamptz null, origin text, supersedes_hint bool default false,
       superseded_by uuid null, conflict_group_id uuid null,
       review_state text default 'none' CHECK (review_state IN ('none','confirmed','edited','rejected','promoted')),
       reviewer_note text null,
       status text,                                   -- cached output of status.py; recomputed on every change
       status_reason text,                            -- plain-English explanation shown in UI
       about_member_id uuid null)                     -- whose work this is about (usually the leaver)

evidence(id, claim_id, chunk_id, quote text, match_score int, quote_found bool,
         verdict text CHECK (verdict IN ('supports','contradicts','insufficient','pending')), verifier text)

conflict_groups(id, workspace_id, subject_key, resolved bool default false, resolution text null, resolved_by uuid null)

review_events(id, claim_id, actor_member_id, actor_role, action text, before jsonb, after jsonb, note text, created_at)

handovers(id, workspace_id, leaver_member_id, successor_member_id, scope text null, show_restricted_stubs bool default false)
handover_versions(id, handover_id, version int, approved_by uuid, approved_at, note text,
                  snapshot jsonb)                     -- frozen claims+evidence refs at approval time (projection applied at READ time)

acknowledgements(id, handover_version_id, claim_id, member_id, state text, created_at)   -- R3 seam, unused in R2
visitors(id text primary key, sandbox_workspace_id uuid, created_at, last_seen_at)
```

**The projection is applied at read time, never baked into the snapshot.** If access changes after approval, the
successor's view changes with it (the safe direction).

## 3. API (FastAPI, prefix `/api`)

Every route resolves `ctx = (visitor, workspace, acting_member, roles)` from the session cookie plus the
`X-Baton-Persona` header, validated against `memberships`. Role guards: `require_admin`, `require_reviewer`, `require_member`.

| Method & path | Guard | Purpose |
|---|---|---|
| `POST /demo/start` | none | Create or return this visitor's sandbox (clone of the template). Sets cookie. Returns `workspace_id`. |
| `POST /demo/reset` | visitor owns sandbox | Re-clone from the template |
| `GET /workspaces/{id}` | member | Workspace, members, roles, current run, latest approved version |
| `POST /workspaces` | none (rate-limited per visitor: 3/day) | Custom workspace from repo URL + uploads + chat export + members/ACLs |
| `GET /workspaces/{id}/sources` | member | Sources the persona can see (admin/reviewer sees all) |
| `POST /workspaces/{id}/sources` | admin | Add a source (multipart for files) |
| `PATCH /sources/{id}/acl` | admin | Change access → recompute `acl_key` on chunks, recompute claim visibility |
| `POST /workspaces/{id}/runs` | admin | Create a pipeline run (queued). 409 if one is running. |
| `POST /runs/{id}/advance` | member | Do one bounded slice (≈45 s) of the run and return progress (see §8). Idempotent; no-op when done. |
| `GET /runs/{id}` | member | Run + job steps (UI polls every 1.5 s) |
| `GET /workspaces/{id}/claims?status=&type=&q=&tab=` | reviewer or leaver | Ledger list (leaver: only claims they can view) |
| `GET /claims/{id}` | visible(persona, claim) else 404 | Claim + evidence (with quote, excerpt ±300 chars, location, source access label, PII masked as needed) |
| `POST /claims/{id}/review` | reviewer (leaver may only `comment`) | `{action: confirm|edit|reject|promote|comment|restore, text?, note?}` → review_event → recompute status |
| `POST /conflicts/{id}/resolve` | reviewer | `{winner_claim_id}` or `{keep_as_risk: true, note}` |
| `GET /workspaces/{id}/timeline` | reviewer or leaver | Decision and change events ordered by `occurred_at`, superseded links |
| `GET /workspaces/{id}/questions` | reviewer | Questions for the leaver, generated from missing + conflicting claims (text, Markdown copy) |
| `GET /handovers/{id}/preview?as={member_id}` | reviewer | Visible vs withheld lists with reasons |
| `POST /handovers/{id}/approve` | reviewer | Freeze snapshot → new version |
| `GET /handovers/{id}` | successor/leaver/reviewer of that handover | Latest approved version, **projected through the requester** |
| `GET /handovers/{id}/export.md` | same | Markdown export of the projected view |
| `GET /handovers/{id}/versions` | reviewer | Version list + diff counts |
| `GET /health` | none | DB + LLM config check (never returns secrets) |

## 4. Sandbox cloning (judges must not collide)

- `seed_demo` builds one **template** workspace (`is_demo_template=true`): it ingests `demo/`, runs the pipeline once,
  and saves the results. Re-running `seed_demo` rebuilds the template.
- `POST /demo/start` deep-copies the template's members, memberships, sources, chunks, claims, evidence, conflict groups
  and handover (no versions yet) into a new workspace with fresh UUIDs (one transaction; use `INSERT … SELECT` with an id map).
  Target: < 2 s.
- The visitor id lives in an httpOnly cookie. Sandboxes idle for more than 7 days can be garbage-collected.
- **The demo works with no LLM key**, except for "Re-run pipeline" and edit re-verification. If the key is missing,
  edit re-verification sets the verdict to `pending` and shows "verification unavailable".

## 5. LLM adapter

```python
class LLM(Protocol):
    def structured(self, *, system: str, user: str, schema: type[BaseModel], model: str, temperature: float = 0) -> BaseModel: ...
```
- Implementations: Anthropic, OpenAI, Gemini (implement the one whose key Arch provides first; the others can be stubs).
- Env: `LLM_PROVIDER`, `LLM_API_KEY`, `LLM_MODEL_EXTRACT`, `LLM_MODEL_VERIFY`.
- Every call is logged to `llm_calls` (workspace, purpose, model, tokens in/out, latency, ok/error). **Log metadata only,
  never prompt text**: this is evidence for the "no secrets sent to model" test, which instead asserts on the scrubbed
  chunk text that is sent.
- Concurrency: at most 4 parallel calls per run; exponential backoff on 429.

## 6. Ingestion details

**GitHub (REST, server-side `GITHUB_TOKEN`)**, capped for speed and to stay within API limits:
- Repo meta, default branch tree; files: `README*`, `docs/**/*.md` (≤ 30 files, ≤ 200 KB each), `CODEOWNERS`,
  `.github/workflows/*`, `.env.example`, `package.json`, `requirements*.txt`, `pyproject.toml`.
- Commits: latest 300 (message, author, date, files changed via the list endpoint where cheap; compute per-path author stats from
  up to 300 commits' file lists, or skip files if the rate limit is tight).
- PRs: latest 60 (all states) with body + review comments + issue comments; issues: latest 60 with comments.
- Each item becomes a chunk with a permalink in `location.url`.
- A repo is one source; ACL default = `all_members` (the admin can change it).

**Uploads:** `.md`/`.txt` split by heading, then paragraph (chunk ≤ 1,200 chars, keep the heading path in `location`);
`.pdf` via `pypdf` text, split by page then paragraph. Dates come from the front-matter/heading if present (e.g. `# Meeting — 2026-04-02`).

**Chat export (Slack format):** a JSON array of messages with `ts`, `user`, `text`, `thread_ts`, plus `channel`. Group
by thread (or by a 20-minute window for unthreaded messages) into chunks of ≤ 1,500 chars; keep message ts values for citation.
Each **channel** becomes its own source, so channels can have different ACLs (this is how `#core-team` becomes restricted).

**Scrubber (`ingest/scrubber.py`), applied before insert:**
patterns for `sk_(live|test)_…`, `ghp_/gho_/github_pat_…`, `AKIA[0-9A-Z]{16}`, `AIza[0-9A-Za-z_-]{35}`, `xox[baprs]-…`,
JWTs, PEM private-key blocks, and generic `(?i)(api[_-]?key|secret|token|password)\s*[:=]\s*\S{8,}`. Replace with
`[REDACTED:<kind>]` and count by kind into `sources.scrub_report`. Unit-test with fixtures, including false-positive guards
(a commit SHA must not be redacted).

## 7. Environment variables (`.env.example`)

```
DATABASE_URL=postgresql+psycopg://baton:baton@localhost:5433/baton
GITHUB_TOKEN=                 # fine-grained, public repos read-only
LLM_PROVIDER=anthropic        # anthropic | openai | gemini
LLM_API_KEY=
LLM_MODEL_EXTRACT=            # set to a capable model
LLM_MODEL_VERIFY=             # can be a smaller/faster model
VERIFIER=llm                  # llm | nli
EMBEDDINGS=off                # off | fastembed
CORS_ORIGINS=http://localhost:3000   # only needed locally; prod is same-origin via rewrite
SESSION_SECRET=
CUSTOM_WORKSPACE_DAILY_LIMIT=3
PIPELINE_SLICE_SECONDS=45
API_ORIGIN=http://localhost:8000     # web: target of the /api/* rewrite (prod: the API Vercel project URL)
NEXT_PUBLIC_API_URL=/api
# prod DATABASE_URL = Neon *pooled* endpoint (…-pooler…), sslmode=require
```

## 8. Deployment

- **Neon:** create the DB, `CREATE EXTENSION vector;`, then run Alembic from CI or locally against the Neon URL; run `seed_demo` once against prod.
- **API (DECISIONS D8):** a separate Vercel project rooted at `apps/api`; FastAPI served as Python Functions on Fluid compute
  (Hobby: 300 s max per request). Keep runtime deps lean (no torch/fastembed in prod; check the Python bundle limit).
  Use Neon's **pooled** URL and SQLAlchemy `NullPool` (serverless instances come and go). Alembic and `seed_demo` run from
  a laptop or CI against Neon, never inside a request.
- **Pipeline on serverless:** never rely on work continuing after a response. `POST /workspaces/{id}/runs` creates the run;
  `POST /runs/{id}/advance` performs one bounded slice (≈ 45 s budget: e.g. ingest one source, or 2–4 extraction batches in
  parallel) and returns progress. The run page calls it in a loop while it polls. Every step is idempotent and
  checkpointed in `jobs`, so a killed request just repeats its slice. A row lock (`SELECT … FOR UPDATE SKIP LOCKED` on the
  run) stops two tabs advancing the same run at once. If nobody is watching, the run pauses and resumes on the next visit.
- **Web:** Vercel project rooted at `apps/web`. `next.config` rewrites `/api/:path*` → the API project URL (env `API_ORIGIN`),
  so cookies are first-party and no CORS is needed in prod. `NEXT_PUBLIC_API_URL` defaults to `/api`.
- **Fallback:** if the Vercel Python runtime blocks us, deploy the same app from the Dockerfile (python:3.12-slim, uv,
  uvicorn) to Render free with a keep-warm ping every 10 min (cron-job.org or GitHub Actions). The resumable pipeline works
  unchanged there.
- After every deploy, run the Playwright judge-flow test against the production URL.
