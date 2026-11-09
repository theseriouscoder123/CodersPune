# Testing — Baton (Round 2)

All numbers below were produced on **9–10 Nov 2026** by the commands shown. Nothing here is estimated.

| Layer | What | Result |
|---|---|---|
| API unit + integration tests | `cd apps/api && uv run pytest` | **164 passed, 0 failed** (local Postgres 16 + pgvector) |
| Citation eval vs golden ledger | `cd apps/api && uv run python -m eval.eval_citations` | recall **13/13**, status accuracy **13/13**, citation precision **9/10**, permission leaks **0**, secret leaks **0** |
| End-to-end, against production | `cd apps/web && pnpm exec playwright test` | **13 passed, 0 failed** (desktop Chrome + Pixel 7) |
| Accessibility (axe-core, WCAG 2.1 A/AA) | part of the e2e suite | **0 violations** on the landing page and 8 workspace screens (light), 4 screens (dark) |
| Dependency audit | `pnpm audit --prod`, `uvx pip-audit -r requirements.txt` | **No known vulnerabilities** in either |
| Production latency | 20 sequential requests to the ledger endpoint | p50 **0.64 s**, max **0.75 s**; new demo copy **≈1 s** |

## 1. API tests (164)

Run against a real Postgres (Docker on port 5433, or a Neon dev branch), not mocks. Grouped by what they protect:

| Area | Files | What they prove |
|---|---|---|
| **Trust core** (pure functions) | `test_status_and_match.py`, `test_scrubber.py`, `test_acl.py`, `test_reconstruct_pure.py` | Deterministic status rules for all five statuses; the quote matcher (≥ 90 normalised fuzzy match, offsets); secret and PII scrubbing; access rules (a claim is visible only if *every* cited source is); conflict and supersession rules |
| **Permissions end to end** | `test_loop.py`, `test_isolation.py`, `test_invites.py` | Full Connect → Handover loop through the HTTP API with personas; the successor never receives `#core-team` content (TechNova, ₹40,000) in the handover, Ask, the changelog or evidence; nothing before approval; **a 40-endpoint tenant-isolation sweep** (another visitor gets 403/404 and data stays unchanged, with own, foreign or no persona header); successor evidence limited to approved versions; locked identities can't be impersonated |
| **Concurrency** | `test_isolation.py` | 4 parallel approvals → 4 consecutive versions; 3 parallel "Try the demo" clicks → one sandbox |
| **Pipeline** | `test_pipeline_order.py`, `test_rerun.py`, `test_stale_evidence.py`, `test_ingest_demo.py`, `test_chunker.py`, `test_docx_upload.py`, `test_custom_workspace.py` | Steps run in order; refresh/full re-runs keep review work; evidence follows edited source text or the claim is flagged "source changed" and downgraded; all planted scenarios present in the demo data; Slack/Discord/Markdown/PDF/Word parsing; custom workspace creation and validation; private-repo tokens never stored |
| **AI adapter** | `test_llm_routing.py`, `test_ask_render.py`, `test_prompt_safety.py` | Key-pool rotation, per-minute vs daily quota handling, cross-provider fallback, malformed-output retry; Ask citations renumbered and validated; the model's output schema can't set a status; injected quotes fail the gate; every prompt marks sources untrusted |
| **Operations** | `test_limits.py`, `test_health.py`, `test_security.py`, `test_notify.py`, `test_api_sources.py`, `test_snapshot.py` | Abuse limits and clean-up; pipeline health page; security headers, request ids, no tracebacks; notifications off by default, never break actions, Slack URL allow-list (no SSRF), masked logs; approved snapshot immutability |

## 2. Citation eval

`apps/api/eval/eval_citations.py` compares the production demo ledger with `demo/golden_ledger.json` (the planted
scenarios in `docs/04_DEMO_DATA.md` §4).

```
claim recall       13/13 = 100%
status accuracy    13/13 = 100%
citation precision 9/10 = 90%
permission leaks   0 (must be 0)
secret leaks       0 (must be 0)
```

- **Models:** Google Gemini `gemini-3.5-flash` (extraction) and `gemini-3.5-flash-lite` (isolated verification and checklist coverage).
- **Which run:** the demo ledger is the frozen output of one real pipeline run (`demo/frozen_ledger.json`, DECISIONS D15). Statuses are recomputed by `status.py` on import.
- **The one citation miss:** G6 (leaderboard). The claim is correct and Supported, but it cites PR #126 rather than the issue #120 comment the golden ledger expects.
- **Not done: 3 independent live runs.** The build plan asked for three. The Gemini free tier allows about 20 requests/day on the main model and a full run needs about 100 calls, so they weren't possible in the window (DECISIONS D15, D16). Multi-key rotation and Groq fallback (D26) are built and would make repeated live runs feasible once more keys are configured.
- **Secret and PII checks:**
  - G9: both planted fake keys are redacted at ingestion and appear nowhere in the database.
  - G15: Rohan's phone number is masked for everyone except the reviewer.
  - Both are asserted by `test_scrubber.py` and the eval's leak counters.

## 3. End-to-end (Playwright, production `https://baton-lac.vercel.app`)

`apps/web/e2e/judge-flow.spec.ts`: the judge's path as a first-time visitor. The desktop tests share one sandbox so a
run doesn't consume the per-network demo limit.

1. Connect: sources, access labels, synthetic-data label.
2. Nothing reaches the successor before approval.
3. The successor can't open the draft ledger, in the UI **or** through the API.
4. Reconstruct: status counts and decision timeline.
5. Search (Ctrl+K) finds claims and source passages.
6. Verify: open a claim, see "Why supported" and the quoted evidence, then confirm it. The progress meter moves.
7. Review: preview shows withheld items, then approve v1.
8. Handover as Neha: approved content, Start here and Unresolved present, **no TechNova / ₹40,000 anywhere**, and the evidence drawer opens.
9. Getting-started checklist shows 6/6 after the loop.
10. Phone (Pixel 7): no page scrolls sideways.
11–13. Accessibility audits (`a11y.spec.ts`): landing page, workspace screens, dark mode.

Last full run: **13 passed (2.4–2.9 min)**. Known flake: one run, immediately after a deploy, stalled on a page whose
scripts didn't load (old and new assets briefly mixed). A re-run passed. Mitigation: a CSS-only "Reload" hint
appears after 8 s, and we don't deploy during judging.

## 4. Reliability checks done by hand on production

- **Fresh visitor journey:** checked repeatedly with curl and Playwright. Demo start ≈1 s; all workspace endpoints answer in ≈0.5–0.9 s.
- **Ask:**
  - "What should I do first?" returns a cited answer naming the Vercel transfer, admin access and the setup guide.
  - "Who owns deployments?" cites the roles note.
  - A sponsor question for Neha returns "not covered", which is correct.
- **One latency outlier:** a single ledger request took 58 s. It wasn't reproducible, and the free plan's logs didn't keep it. Since then:
  - per-transaction statement/lock timeouts (25 s / 10 s);
  - browser reads time out at 20 s and retry once.
  - Re-measured: p50 0.64 s, max 0.75 s over 20 requests.

## 5. User sessions (to be added by Arch)

Plan (docs/06 §3): 3–5 sessions of 10 minutes. Give only the link and the task *"You're Neha, taking over this
project. Find out what to do first and what's risky."* Don't help. Record where people got stuck, time to reach the handover,
whether they noticed withheld and unresolved items, and one quote.

| # | Who (role) | Time to handover | Got stuck at | Noticed withheld / unresolved? | Quote |
|---|---|---|---|---|---|
| 1 | | | | | |
| 2 | | | | | |
| 3 | | | | | |

## 6. How to reproduce

```bash
docker compose up -d db                                   # Postgres + pgvector on :5433
cd apps/api && uv sync && uv run alembic upgrade head
cd apps/api && uv run python -m baton.seed_demo --frozen  # load the demo template from the frozen ledger (no LLM needed)
cd apps/api && uv run pytest
cd apps/api && uv run python -m eval.eval_citations
cd apps/web && pnpm install && pnpm exec playwright install chromium
cd apps/web && pnpm exec playwright test                  # E2E_BASE_URL=http://localhost:3000 for a local run
```
