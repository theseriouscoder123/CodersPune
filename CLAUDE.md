# CLAUDE.md — Baton (CodersInPune Hackathon, Round 2: The Build)

You are building **Baton**, an evidence-graded knowledge-handover tool for small software teams.
Team **LoneWolf** = one person, **Archit Dandavate** ("Arch"). You write the code; Arch makes decisions,
holds the accounts and keys, and submits.

**Hard deadline: Wednesday 11 Nov 2026, 10:00 AM IST.** Aim to be submission-ready by **Tue 10 Nov 23:00 IST**
(see `docs/05_BUILD_PLAN.md`). Every decision should favour a working end-to-end loop over breadth.

---

## 1. What is being judged (read this first)

Round 2 is scored on whether a judge, **with no walkthrough**, can open the live link and go:

> authorised sources → reconstructed knowledge → inspect evidence → review and approve → role-appropriate handover → see what remains unresolved

| Criterion | Points | What it means for you |
|---|---|---|
| Core workflow runs end to end | 30 | No broken step anywhere between Connect and Handover. A judge must reach the successor view. |
| Technical depth and reliability | 25 | Real ingestion, real access control enforced **server-side**, real AI pipeline, no crashes under normal use. |
| Progress against the plan | 20 | Build what the Round 1 PDF promised for Round 2 (`docs/reference/`). Log every deviation in `docs/DECISIONS.md`. |
| Three planned improvements | 15 | Already decided (see §9). Don't build them now, but don't block them either. |
| Usability so far | 10 | A first-time user understands where they are and what to do next. |

"A visually polished interface cannot compensate for missing evidence, unreliable output or a broken handover process."
**Correctness of evidence and permissions beats polish, every time.**

> Note: the organisers' Round 2 email mentions a "brand-governance product". That is a template error; Baton is a
> knowledge-handover product. The scored loop has the same shape: content goes in → it is checked against sources
> → issues are explained → a human makes the final decision. Make that loop obvious in the UI.

## 2. Non-negotiable product rules (trust requirements)

These come straight from the problem statement. Breaking any of them is a correctness bug, not a nice-to-have.

1. **Statuses come from deterministic rules, not from the LLM.** The LLM proposes claims and quotes;
   `apps/api/baton/status.py` decides `verified | supported | inferred | conflicting | missing`. See `docs/01_PRODUCT_SPEC.md §4`.
2. **No fabricated quotes.** Every evidence quote must be found in its cited chunk (normalised fuzzy match ≥ 90).
   If it isn't found, the evidence fails and the claim cannot be Supported.
3. **The generator never grades itself.** Verification is a separate call (or separate model) that sees only the
   claim text and the quoted span.
4. **Inferred claims are never shown as fact.** In the successor view they're hidden unless a reviewer promoted them
   with a note, and then they are labelled "Reviewer-confirmed (no source evidence)".
5. **Permissions are enforced on the server, in queries, at every read.** Never filter only in React.
   A claim is visible to a user only if **every** source it cites is visible to that user (§5 of the spec).
6. **Extraction batches never mix access groups.** Chunks are batched by identical ACL, so one claim can never blend
   restricted and public text.
7. **Secrets are scrubbed before storage and before any model call.** Personal emails and phone numbers are masked for
   anyone who isn't a reviewer.
8. **Nothing reaches the successor until a reviewer approves a version.** The successor sees the latest *approved* version only.
9. **Demo data is synthetic or public only**, and labelled as synthetic in the UI.

## 3. Stack (decided; don't swap without logging in DECISIONS.md)

| Layer | Choice |
|---|---|
| Frontend | Next.js (App Router, TypeScript), Tailwind CSS. shadcn/ui components are allowed. |
| Backend / AI pipeline | Python 3.12, FastAPI, Pydantic v2, SQLAlchemy 2 + Alembic, psycopg 3, httpx, rapidfuzz |
| Database | PostgreSQL 16 with pgvector and built-in full-text search (tsvector) |
| LLM | Provider-agnostic adapter (`apps/api/baton/llm/`) with JSON-schema structured output. Provider and models come from env. |
| Verification | rapidfuzz quote matcher (hard gate) + entailment verifier. Default `VERIFIER=llm` (separate isolated call); optional `VERIFIER=nli` (local cross-encoder) if hosting RAM allows. |
| Embeddings | Optional (`EMBEDDINGS=off|fastembed`). Full-text search is the primary retrieval. Don't let embeddings block anything. |
| Jobs | **Resumable, step-wise pipeline** + a `jobs` table. `pipeline.advance(run_id, budget_s≈45)` does a bounded slice of work and persists progress; the run page's poll (`POST /runs/{id}/advance`) drives it, so no single request nears Vercel's 300 s cap. Locally, a CLI loop (`seed_demo`) calls `advance` until done. **No Redis, Celery or in-process BackgroundTasks** (serverless can freeze them). See DECISIONS D8. |
| Auth (Round 2) | **No login.** A persona switcher ("Viewing as …") plus a per-visitor sandbox workspace, keyed by cookie. Identity is server-side; the API resolves the persona from the session and enforces ACLs. |
| Deploy | **All free tier, no Docker in production** (DECISIONS D8). Web = Vercel project rooted at `apps/web`; API = a second Vercel project rooted at `apps/api` (FastAPI as Python Functions, Fluid compute, 300 s max). Next.js rewrites `/api/*` → API project, so the browser sees one origin (first-party cookies, no CORS). Postgres on Neon free (pgvector; use the **pooled** connection string, SQLAlchemy `NullPool`). Local: Postgres via `docker compose up -d db` **or** a Neon `dev` branch (no Docker needed). Fallback if Vercel Python misbehaves: the same app on Render free + keep-warm ping (Dockerfile kept for that and for reproducibility). |

## 4. Repository layout

```
baton/
├── CLAUDE.md                  ← this file
├── README.md                  ← judge-facing: live link, 60-second tour, setup, disclosures
├── docker-compose.yml         ← local dev only: postgres+pgvector (optional; a Neon dev branch also works)
├── .env.example               ← every variable, with comments; NEVER commit real keys
├── apps/
│   ├── api/
│   │   ├── baton/
│   │   │   ├── main.py              FastAPI app, routers
│   │   │   ├── config.py            env settings
│   │   │   ├── db/                  models.py, session.py, alembic/
│   │   │   ├── auth.py              session → persona → membership; require_* deps
│   │   │   ├── acl.py               can_view_source, visible_claims(), projection
│   │   │   ├── ingest/              github.py, uploads.py, chat_export.py, fixtures.py, chunker.py, scrubber.py
│   │   │   ├── reconstruct/         extractor.py, checklist.py, conflicts.py, timeline.py
│   │   │   ├── verify/              quote_match.py, entailment.py
│   │   │   ├── status.py            PURE function: evidence + review state → status
│   │   │   ├── pipeline.py          orchestrates a run, writes job progress
│   │   │   ├── llm/                 base.py, anthropic.py, openai.py, gemini.py, prompts/
│   │   │   ├── sandbox.py           clone demo workspace per visitor
│   │   │   └── routers/             workspaces, sources, runs, claims, reviews, handovers
│   │   ├── tests/                   pytest
│   │   └── eval/                    eval_citations.py (vs golden ledger)
│   └── web/                         Next.js app
├── demo/                            synthetic dataset (see docs/04_DEMO_DATA.md)
│   ├── github_fixture/              GitHub-API-shaped JSON for the demo repo
│   ├── notes/                       meeting notes (.md)
│   ├── chat/                        slack_export.json
│   └── golden_ledger.json           expected claims = labelled test set
└── docs/
    ├── 00_KICKOFF_PROMPT.md
    ├── 01_PRODUCT_SPEC.md       ← what to build, statuses, permissions, screens, acceptance
    ├── 02_ARCHITECTURE.md       ← schema, API, data flow
    ├── 03_PIPELINE_AND_PROMPTS.md ← extraction/verification/checklist algorithms and prompts
    ├── 04_DEMO_DATA.md          ← the synthetic project and the planted scenarios
    ├── 05_BUILD_PLAN.md         ← timeline, milestones, cut list
    ├── 06_SUBMISSION_AND_HANDBACK.md ← deliverables and HANDBACK.md contents
    ├── DECISIONS.md             ← log every deviation from the Round 1 plan (append-only)
    ├── TESTING.md               ← you write it: tests, eval numbers, e2e results
    └── reference/               ← Round 1 proposal PDF, problem statement PDF
```

## 5. Commands (keep these working; update if you change them)

```bash
docker compose up -d db                       # Postgres + pgvector on host :5433
cd apps/api && uv sync                        # or: pip install -e ".[dev]"
cd apps/api && alembic upgrade head
cd apps/api && python -m baton.seed_demo      # load demo/ into the template demo workspace, run pipeline, freeze
cd apps/api && uvicorn baton.main:app --reload --port 8000
cd apps/api && pytest -q
cd apps/api && python -m eval.eval_citations  # prints citation precision/recall vs golden ledger
cd apps/web && pnpm install && pnpm dev       # :3000, expects NEXT_PUBLIC_API_URL
cd apps/web && pnpm exec playwright test      # judge-flow e2e
```

## 6. Working rules for you

- **Build in vertical slices.** Get Connect → Handover working crudely end to end first (M2 in the build plan), then deepen.
  Never have three half-finished steps.
- **Deploy on day one** (an empty app on all three hosts), then redeploy after every milestone. Deployment surprises are
  the biggest risk to a 66-hour build.
- **Commit early and often**, with clear messages. Judges may inspect commit history to confirm everything was built in the
  window (opened Sun 8 Nov 10:00 IST). Never squash history. Never import code written before the window.
- **Disclose scaffolding.** If you use `create-next-app`, shadcn/ui or any template or generator, add it to the README
  "Disclosures" section. The README must also state that the code was written with Claude Code (AI-assisted).
- **The LLM is unreliable; design for that.** Validate every LLM response against its Pydantic schema, retry once on
  invalid JSON, then mark the batch failed and continue. A failed batch must never crash a run.
- **Judges must never hit a cold LLM.** The demo workspace is precomputed at seed time. "Re-run pipeline" and
  "custom repo" are live but rate-limited, and they show clear errors when the LLM key is missing or exhausted.
- **Keep `status.py`, `acl.py`, `scrubber.py` and `quote_match.py` pure and unit-tested.** These are the trust core.
- **Ask Arch before:** changing the stack, dropping a Round 2 core feature, adding a paid service, or anything that
  touches his accounts. Otherwise decide, and log it in `docs/DECISIONS.md`.
- **Never commit secrets.** `.env` is gitignored. If you see a real key in a file, stop and tell Arch.

## 7. Things Arch must provide (ask for them at the start)

- GitHub account + an empty **public** repo (e.g. `baton`), and a fine-grained `GITHUB_TOKEN` (public read-only) for the API rate limit
- LLM API key (and which provider: Anthropic / OpenAI / Gemini)
- Vercel and Neon accounts, both free and no card needed (DECISIONS D8). A Render account only if we need the fallback.

## 8. Definition of done for Round 2

A first-time visitor on the deployed link can, without instructions:
1. Click **Try the demo** → land in their own sandbox copy of the synthetic "Campus Events App" workspace.
2. See the connected sources and who can access each one (Connect).
3. See a reconstructed ledger with counts by status and type, plus a decision timeline (Reconstruct).
4. Open any claim and see the exact quoted evidence with source location, and why it got its status (Verify).
5. As the reviewer: edit, reject, confirm or promote claims, resolve a conflict, preview what the successor will see,
   and approve a version (Review).
6. Switch to the successor and see only permitted, approved content, organised as a continuation plan with
   unresolved items clearly marked (Handover).
7. Optionally: create a workspace from **any public GitHub repo** plus uploaded notes and get a ledger in a few minutes.

Plus: a public repo with a README, `docs/TESTING.md` with real numbers, `docs/DECISIONS.md` and a filled `HANDBACK.md`.

## 9. Round 3 commitments (do not build now, but leave seams)

1. **Gap interview:** targeted questions from Missing/Conflicting claims go to the leaver (or the reviewer if the leaver is unavailable); answers become cited "leaver testimony" sources. *Seam:* `sources.type` already allows `testimony`.
2. **Conflict and supersession timeline:** distinguish a reversed decision from a genuine contradiction; interactive decision timeline. *Seam:* `claims.superseded_by` and `subject_key` exist; R2 does basic conflict flagging.
3. **Successor acknowledgement and visibility diff with re-rendering:** the successor acknowledges each item, open items are tracked to closure, and withheld claims are re-rendered from accessible sources only. *Seam:* the `acknowledgements` table exists.

In Round 2, the Missing/Conflicting items still produce a **copyable "Questions for the leaver" list**. That is the
manual precursor to improvement #1.

## 10. When you finish (or at any milestone Arch asks for)

Write or refresh `HANDBACK.md` at the repo root exactly as specified in `docs/06_SUBMISSION_AND_HANDBACK.md`.
Arch passes that file, the screenshots and `docs/DECISIONS.md` to another assistant, which writes the updated project
PDF and the submission form answers. Make it accurate. If something doesn't work, say so plainly.
