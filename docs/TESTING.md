# Testing — Baton (Round 2)

All numbers below were produced on **9–10 Nov 2026** by the commands shown. Nothing here is estimated.

| Layer | What | Result |
|---|---|---|
| API unit + integration tests | `cd apps/api && uv run pytest` | **173 passed, 0 failed** (local Postgres 16 + pgvector) |
| Citation eval vs golden ledger | `cd apps/api && uv run python -m eval.eval_citations` | Demo ledger (Gemini 3.5 Flash): recall **13/13**, status accuracy **13/13**, citation precision **9/10**. Three further live runs, Groq-heavy because Gemini was over quota or returning 503s: recall **9–10/13**. **0 permission leaks and 0 secret leaks in all four runs.** |
| End-to-end, against production | `cd apps/web && pnpm exec playwright test` | **13 passed, 0 failed** (desktop Chrome + Pixel 7) |
| Accessibility (axe-core, WCAG 2.1 A/AA) | part of the e2e suite | **0 violations** on the landing page and 8 workspace screens (light), 4 screens (dark) |
| Dependency audit | `pnpm audit --prod`, `uvx pip-audit -r requirements.txt` | **No known vulnerabilities** in either |
| Live AI keys (production) | model list + one structured call per model | **5/5 keys valid**. Verify works on `gemini-3.5-flash-lite`, `gpt-oss-20b` and `gpt-oss-120b`. Extraction on both Groq models gives verbatim quotes. Key rotation observed live on Ask. |
| Production latency | 20 sequential requests to the ledger endpoint | p50 **0.64 s**, max **0.75 s**; new demo copy **≈1 s** |
| Security assessment | exact-value secret scan of git history, working tree, web bundle and 25 live production responses; planted-secret leak tests | **0 leaks** of any real key, token or password |
| Custom repos on production | `pallets/markupsafe`, `sindresorhus/slugify` (+ a Word note) through the real UI flow | **Both completed**: 75 and 85 claims; 69/74 quotes found verbatim (markupsafe) |
| Cold start (fresh browser, production) | landing → demo → claims list | fast network: demo ready **4.7 s**, claims list **3.0 s**; slow 3G: **3.4 s** and **3.0 s**; a returning visitor lands back in their copy |

## 1. API tests (173)

Run against a real Postgres (Docker on port 5433, or a Neon dev branch), not mocks. Grouped by what they protect:

| Area | Files | What they prove |
|---|---|---|
| **Trust core** (pure functions) | `test_status_and_match.py`, `test_scrubber.py`, `test_acl.py`, `test_reconstruct_pure.py` | Deterministic status rules for all five statuses; the quote matcher (≥ 90 normalised fuzzy match, offsets); secret and PII scrubbing; access rules (a claim is visible only if *every* cited source is); conflict and supersession rules |
| **Permissions end to end** | `test_loop.py`, `test_isolation.py`, `test_invites.py` | Full Connect → Handover loop through the HTTP API with personas; the successor never receives `#core-team` content (TechNova, ₹40,000) in the handover, Ask, the changelog or evidence; nothing before approval; **a 40-endpoint tenant-isolation sweep** (another visitor gets 403/404 and data stays unchanged, with own, foreign or no persona header); successor evidence limited to approved versions; locked identities can't be impersonated |
| **Concurrency** | `test_isolation.py` | 4 parallel approvals → 4 consecutive versions; 3 parallel "Try the demo" clicks → one sandbox |
| **Pipeline** | `test_pipeline_order.py`, `test_rerun.py`, `test_stale_evidence.py`, `test_ingest_demo.py`, `test_chunker.py`, `test_docx_upload.py`, `test_custom_workspace.py` | Steps run in order; refresh/full re-runs keep review work; evidence follows edited source text or the claim is flagged "source changed" and downgraded; all planted scenarios present in the demo data; Slack/Discord/Markdown/PDF/Word parsing; custom workspace creation and validation; private-repo tokens never stored |
| **AI adapter** | `test_llm_routing.py`, `test_ask_render.py`, `test_prompt_safety.py` | Key-pool rotation, per-minute vs daily quota handling, cross-provider fallback, malformed-output retry; Ask citations renumbered and validated; the model's output schema can't set a status; injected quotes fail the gate; every prompt marks sources untrusted |
| **Operations and security** | `test_limits.py`, `test_health.py`, `test_security.py`, `test_secret_leaks.py`, `test_notify.py`, `test_api_sources.py`, `test_snapshot.py` | Abuse limits and clean-up; pipeline health page; security headers, request ids, no tracebacks; notifications off by default, never break actions, Slack URL allow-list (no SSRF), masked logs; approved snapshot immutability |

## 2. Citation eval

`apps/api/eval/eval_citations.py` compares a ledger with `demo/golden_ledger.json` (the 13 claim-producing planted
scenarios in `docs/04_DEMO_DATA.md` §4; G9 and G15 are checked separately as the secret and PII leak counters).

| Run | When | Extraction model (as it actually ran) | Claim recall | Status accuracy | Citation precision | Failed extraction batches | Permission leaks | Secret leaks |
|---|---|---|---|---|---|---|---|---|
| A: production demo ledger (frozen) | 8 Nov | Gemini `gemini-3.5-flash` | **13/13** | **13/13** | 9/10 | 0/7 | **0** | **0** |
| B: live, local | 10 Nov 14:18Z | Groq `gpt-oss-120b` (Gemini over daily quota / 503) | 9/13 | 9/13 | 5/6 | 1/7 | **0** | **0** |
| C: live, local | 10 Nov 14:23Z | same | 9/13 | 9/13 | 5/6 | 2/7 | **0** | **0** |
| D: live, local, with extraction retry (D44) | 10 Nov 14:32Z | same | 10/13 | 10/13 | 4/7 | 1/7 | **0** | **0** |

Verification ran on Gemini `gemini-3.5-flash-lite` / `gemini-3.1-flash-lite` and Groq `gpt-oss-20b` / `gpt-oss-120b` across all runs.

How to read this:
- **The safety properties held in every run:** zero permission leaks and zero secret leaks, whatever the model.
- **Status accuracy equals recall in every run.** Every planted claim that was produced got the correct status. Only missing claims cost points, never mis-graded ones.
- **Misses come from failed batches.** In runs B–D they map to extraction batches that failed on Groq's per-minute token limit (the notes and issues containing G10–G13). The run log reports these failures openly. The retry added after run C (failed batches are retried once, after the rate window) cut failures from 2 to 1 and raised recall from 9 to 10.
- **A "wrong" citation is not an unsupported claim.** It is a claim whose verified quote comes from a different source than the golden ledger names, for example PR #126 instead of issue #120 for the leaderboard.
- **Quality depends on the extraction model.** The Gemini run is clearly better. That is why Gemini 3.5 Flash leads the production chain and the demo ships a precomputed, eval-checked ledger (D15).

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

## 5. Custom repositories on production (10 Nov)

Created through `POST /api/workspaces` exactly as the New workspace form does, then driven by `POST /runs/{id}/advance`
like the run page:

| Repository | Sources | Result | Notes |
|---|---|---|---|
| `pallets/markupsafe` | repo (287 chunks: 300 commits, 60 PRs, 24 issues, 7 files) | **done**: 75 claims (64 Supported, 7 Inferred, 4 Missing); 69/74 quotes found verbatim | Gemini returned 503s for most of the run; Groq took over (D41). Slices 50–66 s. |
| `sindresorhus/slugify` | repo (316 chunks) + a Word `.docx` note | **done**: 85 claims (67 Supported, 15 Inferred, 3 Missing); the Word note ingested | The first attempt **failed** in "Match quotes" on Unicode text: a real bug, fixed (D42). The run was then **retried from the failed step** without redoing extraction and finished in about 6 minutes. |

Both runs survived deploys mid-run. A deploy drops the in-flight request, and the next poll continues from the checkpoint.

## 6. Security assessment (10 Nov)

| Check | Result |
|---|---|
| Every secret value in `.env` (9 keys/tokens, DB password) searched verbatim in full git history, the working tree and the built web bundle | **0 real leaks** (one hit was the local Docker default password `baton`, which is public by design) |
| The same values searched in 25 live production responses (all pages, every JS chunk, health, workspace, team, pipeline-health, the JSON export, OpenAPI, error responses) | **0 hits**, including the database hostname |
| Planted fake secrets driven through HTTP errors, stored run errors, AI-call logs and the health endpoint (`test_secret_leaks.py`) | Redacted everywhere |
| Scrubber coverage of current key formats (Gemini `AQ.`, Groq `gsk_`, GitHub, OpenAI, Anthropic, Slack webhooks, AWS, JWT, DB-URL credentials, PEM keys) | All detected; no false positives on ordinary URLs and words |
| Other fixes | constant-time cron secret; 300-page PDF cap; dedicated CSP only for the API reference |

## 7. User sessions (to be added by Arch)

Plan (docs/06 §3): 3–5 sessions of 10 minutes. Give only the link and the task *"You're Neha, taking over this
project. Find out what to do first and what's risky."* Don't help. Record where people got stuck, time to reach the handover,
whether they noticed withheld and unresolved items, and one quote.

| # | Who (role) | Time to handover | Got stuck at | Noticed withheld / unresolved? | Quote |
|---|---|---|---|---|---|
| 1 | | | | | |
| 2 | | | | | |
| 3 | | | | | |

## 8. How to reproduce

```bash
docker compose up -d db                                   # Postgres + pgvector on :5433
cd apps/api && uv sync && uv run alembic upgrade head
cd apps/api && uv run python -m baton.seed_demo --frozen  # load the demo template from the frozen ledger (no LLM needed)
cd apps/api && uv run pytest
cd apps/api && uv run python -m eval.eval_citations
cd apps/web && pnpm install && pnpm exec playwright install chromium
cd apps/web && pnpm exec playwright test                  # E2E_BASE_URL=http://localhost:3000 for a local run
```
