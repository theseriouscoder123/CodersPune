# 00 — Kickoff prompt (paste this as your first message to Claude Code)

> Put this whole folder in an empty directory, open Claude Code there, and paste the prompt below.

---

You're the engineer on **Baton**, my Round 2 entry for the CodersInPune Hackathon. I'm Arch, a solo team (LoneWolf).
Deadline: **Wed 11 Nov 2026, 10:00 AM IST**. I want to submit by Wed 08:00.

Read, in this order: `CLAUDE.md`, `docs/01_PRODUCT_SPEC.md`, `docs/02_ARCHITECTURE.md`, `docs/03_PIPELINE_AND_PROMPTS.md`,
`docs/04_DEMO_DATA.md`, `docs/05_BUILD_PLAN.md`, `docs/06_SUBMISSION_AND_HANDBACK.md`, `docs/DECISIONS.md`.
The Round 1 proposal and the problem statement are in `docs/reference/` (PDFs). Treat them as the promise we're keeping.

Then:
1. Tell me in ≤ 10 bullets what you're going to build first and anything in the docs you think is wrong or risky.
2. List exactly which accounts, keys and repo names you need from me (CLAUDE.md §7), and wait for them before deploying.
3. While you wait, start **M0** locally: `git init`, monorepo skeleton, docker-compose with Postgres + pgvector, Alembic
   schema, FastAPI `/health`, Next.js landing. Commit as you go.
4. Work milestone by milestone (M0 → M6). At the end of each milestone: run the tests, redeploy, then give me a 5-line
   status (done / broken / next / any decision logged in DECISIONS.md).

Rules that override everything else: the trust rules in CLAUDE.md §2, a working end-to-end loop before depth, and honest
status. If something doesn't work, say so.
