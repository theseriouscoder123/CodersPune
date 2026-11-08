# DECISIONS — deviations from the Round 1 plan (append-only)

Format: `D<n> · date · decision · why · impact on the plan`. Claude Code: append a row whenever you deviate from the
Round 1 PDF or these docs. This file becomes the "changes made to the original plan" section of the submission.

## Pre-decided before the build (from planning, 8 Nov 2026)

- **D1 · 8 Nov · No login (GitHub OAuth) in Round 2. Persona switcher + per-visitor sandbox instead.**
  Why: judges must use the product without a walkthrough or accounts, and the permission model is best demonstrated by switching between Meera, Rohan and Neha. ACLs are still enforced server-side per persona. Impact: OAuth moves to the roadmap.
- **D2 · 8 Nov · The verifier defaults to an isolated LLM call; the local NLI cross-encoder becomes optional.**
  Why: a torch-based model needs more RAM than affordable hosting provides. The key property from the plan (the generator never grades itself; a separate check sees only the claim + quote) is preserved, and deterministic quote matching remains the hard gate.
- **D3 · 8 Nov · Full-text search is the primary retrieval; embeddings are optional.**
  Why: the pipeline processes every chunk directly (team-sized data), so vector retrieval adds little in Round 2. Postgres FTS covers checklist evidence search.
- **D4 · 8 Nov · The demo is precomputed and cloned per visitor.**
  Why: reliability. Judges never wait on, or depend on, a live LLM call to see the core loop. Live runs remain available.
- **D5 · 8 Nov · The demo GitHub source is a GitHub-shaped synthetic fixture, ingested by the same normaliser as the live connector.**
  Why: the problem statement requires synthetic/public data, and planted scenarios must be deterministic. The live GitHub connector is offered for any public repo.
- **D6 · 8 Nov · Extraction batches are grouped by access list.**
  Why: this guarantees no claim blends restricted and unrestricted text. It strengthens the Round 1 permission design.
- **D7 · 8 Nov · Round 2 includes a copyable "Questions for the leaver" list** (generated from Missing + Conflicting items), the manual precursor to the Round 3 gap interview.

## During the build

| # | Date | Decision | Why | Impact |
|---|---|---|---|---|
| D8 | 8 Nov | Host everything on free tiers with no Docker in production: Next.js web and FastAPI API as two Vercel projects (API = Python Functions on Fluid compute), with Next.js rewriting `/api/*`; Postgres on Neon free. The pipeline becomes resumable, advanced in bounded slices (≈45 s) by the run page's polling, in place of FastAPI BackgroundTasks. | No budget for paid hosting. Free Docker hosts were checked (Nov 2026): Hugging Face Docker Spaces now need a paid plan; Render free sleeps after 15 min with ~1 min wake-up; Koyeb free needs a card and sleeps; Railway is trial credit only; Cloud Run needs a card and throttles post-response work. Vercel gives no-card hosting, fast cold starts and one origin for cookies. Round 1 promised "frontend on Vercel, API and Postgres on a managed host"; Vercel and Neon satisfy that. | Pipeline runs survive restarts (checkpointed per step). A run only moves forward while someone has the run page open; the demo is precomputed, so judges are unaffected. Docker Compose remains optional for local Postgres; a Dockerfile is kept for a Render-free fallback. |
