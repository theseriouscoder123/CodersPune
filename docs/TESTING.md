# Testing — Baton

## Round 3 (13–16 Nov 2026)

Produced on **14 Nov 2026** by the commands shown. One number is an estimate, and it is labelled as one.

### Targets promised in the Round 1 PDF

| Metric | Target | Result | How |
|---|---|---|---|
| Citation precision of shared claims | ≥ 90% | **9/10 = 90%** on the production demo ledger. Claim recall 13/13, status accuracy 13/13. The one miss (G6, leaderboard) cites a real but different issue comment than the golden one. | `python -m eval.eval_citations` against the production template |
| Permission safety | 0 restricted claims in successor views | **0 leaks in 179 successor requests across all 29 GET routes**, for every claim, source and evidence id in an approved copy of the full demo ledger, including searches for "TechNova". Also 0 permission leaks and 0 secret leaks in the eval. | `tests/test_leak_sweep.py` (pins it); `eval_citations` |
| Successor readiness | Faster and more accurate with Baton | **With Baton (after fixes): 10/10 in 13.4 s and 13.9 s, opening 1–2 files. Raw sources: 10/10 in 36.6 s and 37.1 s, opening 12 files.** About 2.7× faster at equal accuracy. Before two fixes the Baton group scored 9/10 (details below). | 6 blind AI testers (simulated, see below) |
| Leaver effort | < 30 min for the demo project | **Estimate: about 10–15 min.** The demo interview has **5 questions** (4 Missing items and 1 conflict pick), about 60 words of question text plus the two quoted sides of the conflict. This is an estimate, not a timing of a real person. The interview page records the duration of every real run (activity log: "Answered the gap interview … N min"). | Interview built from the demo ledger via the API |

### Successor readiness, in detail (simulated testers)

The testers were fresh AI agents (Claude Sonnet) with no context from this project. They were not people, and we report them as simulated. Each got the same 10 continuation questions, written from the planted scenarios that Neha may see (`demo/golden_ledger.json`). Each question asked for the answer, where it was found, and a confidence, and told testers to say "Not established" rather than guess.
- **With Baton:** Neha's approved handover, as her own Markdown export from production. This is the successor projection, so nothing is withheld from her by mistake and nothing restricted is included.
- **Without Baton:** the raw sources Neha may read: the GitHub fixture (JSON), the three meeting notes and the #dev channel. #core-team was removed, so both groups had the same permissions.

| Group | Tester | Score | Time | Files opened |
|---|---|---|---|---|
| Baton (first run) | A1 | 9/10 | 15.4 s | 2 |
| Baton (first run) | A2 | 9/10 | 15.8 s | 1 |
| Raw sources | B1 | 10/10 | 36.6 s | 12 |
| Raw sources | B2 | 10/10 | 37.1 s | 12 |
| Baton (after fixes) | A3 | 10/10 | 13.4 s | 1 |
| Baton (after fixes) | A4 | 10/10 | 13.9 s | 2 |

**What the first run found, and what changed:**
- **The reason for a decision was missing.** For "why FCM over OneSignal?", both Baton testers answered "not established": the claim text omits the reason, and the export carried only a citation. The export now carries each item's key quote, which contains the reason.
- **Strike-through read as "false".** History items were struck through, and both testers treated "previously used Supabase" (and a parked PR #142 line) as unreliable. History is now labelled ("Earlier, changed on 9 Feb … Now: Firebase Auth"; "Probably done or parked") on the page, the timeline and the export, never struck through.
- **A duplicate item.** The handover listed "Neha takes over the app." next to "Neha is taking over the app from Rohan.". It came from re-rendering: the rewrite restated a fact Neha already sees. Re-rendering now returns `already_visible` instead of adding a copy (D59).

**Honest limits:**
- The project is small: the raw sources are 137 KB, which an AI reads in seconds. A person reading 12 JSON files would take far longer, so the time gap for humans is likely bigger. That is untested until real people try it.
- Baton's graded answers were no more accurate than reading everything carefully. The gain is speed and being pointed at what is open (every Baton tester flagged the upload-limit conflict and the unknown Firebase owner as things to ask about).
- 6 runs is a small sample.

### Round 3 checks (part of `eval_citations`, production template)

| Check | Result |
|---|---|
| G7 auth change classified (improvement #2) | `historical` (the later claim says "previously used"), never `contradiction`: **ok** |
| G3 upload limit classified | `contradiction`: **ok** |
| Stale open work | 3 items; the old "set up push reminders" task is flagged: **ok**. A 4th (the sponsor-logo task) was wrongly flagged because its own rewrite looked like "a later update"; fixed (D59) and pinned by a test. |
| Re-rendered claims (improvement #3) | **1/1** quote found, visible to Neha, no sponsor name or amount. Of the 4 withheld items that look like Neha's: 1 created, 1 already visible to her, 1 a different topic, 1 not stated in her sources. |

### Automated tests

| Layer | Result |
|---|---|
| API (`uv run pytest`) | **213 passed, 0 failed** (local Postgres 16). Round 3 added: interview (6), relations rules (9) and API (5), acknowledgements (3, with a reliability matrix), re-render (5), source access (6), counts and export (2), duplicates (2), leak sweep (1). |
| End-to-end on production (`pnpm exec playwright test`) | **17 passed, 0 failed.** Round 3 added: gap interview, decision timeline, acknowledgements and rewrites, and counts agreeing across screens. Accessibility (axe) still has 0 serious violations in light and dark. |

### Performance (production, measured from India)

| What | Before | After |
|---|---|---|
| Warm API call (ledger, claims, relations) | 0.7–0.9 s | 0.4–0.55 s (API moved next to the database, D58) |
| Hard load, Verify | 3–4 s (Round 2 testers) | 2.0 s |
| Hard load, other steps | – | 1.5–2.0 s |
| Going back to a step already visited | skeleton again | about 0.1 s (cached, refreshed in the background) |

### Reliability matrix (new screens and endpoints)

| Check | Interview | Timeline / relations | Acknowledgements | Re-render | Source access |
|---|---|---|---|---|---|
| Bad input (empty, too long, wrong type) | 422 with a readable message | 422 | 422 (note over 500, unknown state, empty question) | n/a (no input) | 422 |
| HTML or script in text | stored as text, rendered escaped | – | stored as text, rendered escaped; secrets scrubbed | – | – |
| Repeated attempt | create and submit are idempotent | override is idempotent | re-sending gives one row | returns `exists` | same list saves no new audit row |
| Wrong persona or role | 403 with a sentence | 403 | 403 / 404 for withheld items | 403 | 403 |
| AI unavailable | no AI on this path | no AI on this path | no AI on this path | 503 with a message; nothing saved | no AI on this path |
| Empty state | "Nothing to ask: there are no open Missing or Conflicting items" | "Nothing in this view." for an empty filter | progress hidden until approved | "Nothing is withheld" | – |
| Phone width (375 px, dark) | checked | checked | checked | checked | checked |

---

# Round 2 (kept for the record)

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
