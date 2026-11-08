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

_To be written once the judge flow is live (see `docs/04_DEMO_DATA.md §6`)._

## Workflow

Connect → Reconstruct → Verify → Review → Handover

## Local setup

```bash
cp .env.example .env                     # fill in keys
docker compose up -d db                  # or point DATABASE_URL at a Neon dev branch
cd apps/api && uv sync && uv run alembic upgrade head
cd apps/api && uv run uvicorn baton.main:app --reload --port 8000
cd apps/web && pnpm install && pnpm dev  # http://localhost:3000
```

## Architecture

See `docs/02_ARCHITECTURE.md`. Hosting is free tier only: Vercel (web and API as Python Functions) and Neon Postgres.
See `docs/DECISIONS.md` D8.

## Disclosures

- **AI-assisted:** the code in this repository was written with **Claude Code (Anthropic)** under Archit's direction.
- **Scaffolding:** `apps/web` was generated with `create-next-app` (Next.js, TypeScript, Tailwind CSS, ESLint).
- **Data:** all demo data is **synthetic**, written for this project. No real club or workplace data is used.
- No code was written before the official build window (opened Sun 8 Nov 2026, 10:00 IST). Planning documents in
  `docs/` predate the code, which the rules permit.
