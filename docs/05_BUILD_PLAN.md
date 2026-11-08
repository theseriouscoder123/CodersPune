# 05 — Build Plan (Sun 8 Nov → Wed 11 Nov 10:00 IST)

About 65 hours of wall-clock time, one human plus Claude Code. Times are IST targets. If a milestone slips by more than 3 hours,
apply the cut list instead of compressing testing.

| Milestone | Target | Done when |
|---|---|---|
| **M0 Skeleton + deploy** | Sun 23:00 | Monorepo, docker-compose, FastAPI `/health`, Next.js landing, Alembic schema (all tables in `02 §2`); **deployed** to Neon + Vercel (web project + API project, `/api` rewrite) and reachable; README stub; first commits pushed |
| **M1 Demo data + ingestion** | Mon 11:00 | `demo/` generated per `04`; fixture/GitHub/upload/chat ingestion; chunker; scrubber + tests; ACL tagging; sources screen (S2) reads real data |
| **M2 Thin end-to-end loop** | Mon 20:00 | Extraction → quote match → verifier → `status.py` (+ tests) → crude ledger list → approve → crude successor view with projection (+ ACL tests). **The whole loop works, even if ugly.** Redeploy. |
| **M3 Depth** | Tue 06:00 | Checklist + cover step (Missing); conflicts + supersession; timeline; run progress (S3); eval script with first numbers; `seed_demo` + sandbox clone + persona switcher |
| **M4 Review UX** | Tue 14:00 | S4 full (evidence panel, highlights, status reasons, all actions, tabs, questions list); S5 visibility preview; S7 versions; edit → re-verify |
| **M5 Handover UX + custom repo** | Tue 19:00 | S6 sectioned handover, evidence drawer, Markdown export, PII masking; S0/S1 custom-repo flow with limits and errors; coach hints; empty and error states |
| **M6 Harden + ship** | Tue 23:00 | Playwright judge-flow e2e green **against production**; eval run 3× → `docs/TESTING.md`; README final; `HANDBACK.md`; screenshots in `docs/screenshots/`; feature freeze |
| Buffer | Wed 00:00–08:00 | Fix-only. Arch tests with 3–5 people and records feedback. The submission PDF and form are prepared (by the other assistant). |
| **Submit** | **by Wed 08:00** | Two-hour safety margin before the 10:00 deadline |

## Cut list (cut in this order; never cut anything in the "never" row)

1. Embeddings (FTS only) — likely cut from the start
2. NLI verifier option (LLM verifier only)
3. PDF upload (keep .md/.txt)
4. Custom-repo flow → keep it backend-capable, but if time runs out show "Demo only in this build"
5. Versions diff summary (keep the version list)
6. Markdown export

**Never cut:** sandbox demo, scrubber, ACL enforcement + tests, quote matching, separate verifier, status rules,
conflicts and missing, review actions, visibility preview, approval, projected successor view, status explanations.

## Screenshots to capture at M6 (`docs/screenshots/`, 1440×900, light theme)

`01-landing.png`, `02-sources.png`, `03-run-progress.png`, `04-ledger.png`, `05-evidence-panel.png`, `06-conflict.png`,
`07-missing-questions.png`, `08-timeline.png`, `09-preview-withheld.png`, `10-handover-neha.png`, `11-versions.png`.
These go into the updated project PDF.
