# Baton

**An evidence-graded knowledge handover for small software teams.**
Baton turns a departing member's project activity into a ledger of claims. Each claim links to its source evidence and
gets a status from deterministic rules. A reviewer approves the ledger, and the successor then sees it filtered by what
they are allowed to access.

> CodersInPune Hackathon · Round 2 (The Build) · Team LoneWolf (Archit Dandavate)

- **Live app:** https://baton-lac.vercel.app
- **API health:** https://baton-lac.vercel.app/api/health
- **Repo:** https://github.com/theseriouscoder123/CodersPune

## 60-second tour

1. Open the live app and click **Try the demo**. You get your own copy of a fictional student-club project ("Campus Events App"), so your edits don't affect anyone else.
2. **Connect:** 4 sources and who can read each one. `#core-team` is restricted, and 2 planted fake secrets were removed before storage.
3. **Reconstruct:** the ledger with counts by status, and a decision timeline in which reversed decisions show as superseded.
4. **Verify:** open any claim to see the exact quote highlighted in its source and why it got its status. Confirm, edit, reject or promote it, and resolve the 5 MB vs 2 MB conflict. The **Missing** tab gives you "Copy questions for the leaver".
5. **Review:** preview what Neha (the successor) will see. The sponsor deal from `#core-team` is withheld, with the reason. Then approve v1.
6. **Handover:** switch to Neha (top right). You'll see her continuation plan: start here, owners, decisions, risks, dependencies, and the unresolved items.

## Workflow

Connect → Reconstruct → Verify → Review → Handover

## Local setup

```bash
cp .env.example .env                     # fill in keys
docker compose up -d db                  # or point DATABASE_URL at a Neon dev branch
cd apps/api && uv sync && uv run alembic upgrade head
cd apps/api && uv run python -m baton.seed_demo     # ingest demo/ and run the AI pipeline once (needs LLM_* in .env)
cd apps/api && uv run uvicorn baton.main:app --reload --port 8000
cd apps/web && pnpm install && pnpm dev  # http://localhost:3000
```

## Architecture

See `docs/02_ARCHITECTURE.md`. Hosting is free tier only: Vercel (web and API as Python Functions) and Neon Postgres.
See `docs/DECISIONS.md` D8.

## Disclosures

- **AI-assisted:** the code in this repository was written with **Claude Code (Anthropic)** under Archit's direction.
- **Scaffolding:** `apps/web` was generated with `create-next-app` (Next.js, TypeScript, Tailwind CSS, ESLint).
- **UI libraries/assets:** icons from `lucide-react` (ISC licence); fonts Fraunces, Geist and Geist Mono (SIL Open Font
  License) loaded through `next/font/google`. The visual design and components were written for this project.
- **Data:** all demo data is **synthetic**, written for this project. No real club or workplace data is used.
- No code was written before the official build window (opened Sun 8 Nov 2026, 10:00 IST). Planning documents in
  `docs/` predate the code, which the rules permit.
