# HANDBACK — Baton Round 3 (The Finish)

Written by Claude Code on 14 Nov 2026 (IST) and checked against production, the test suite and a clean clone. Where
something is not done, estimated or simulated, it says so. Arch uses this file, `docs/DECISIONS.md`, `docs/TESTING.md`,
`docs/ARCHITECTURE.md`, `docs/ROADMAP.md` and `docs/screenshots/` for the final PDF and the submission form.

## 1. Links

- Live app: https://baton-lac.vercel.app (click **Try the demo**; no sign-up)
- Repo: https://github.com/theseriouscoder123/CodersPune (public)
- API health: https://baton-lac.vercel.app/api/health
- API (direct): https://baton-api-peach.vercel.app (the web app proxies `/api/*` to it)

## 2. Judge tour (works on production; the e2e suite drives the same paths)

1. **Try the demo** opens your own copy of the synthetic "Campus Events App" on **Connect**: 4 sources with their access lists, `#core-team` restricted, and 2 fake secrets removed.
2. **Reconstruct:** counts by status and type. The **decision timeline** shows "Describes an earlier state" on the Supabase line, a contradiction on the upload limit, and "Probably done or parked" on Rohan's old push-reminder task. Click a label to see why, and override it.
3. **Verify** (as Meera): open a claim to see the highlighted quote and why it has its status. On the **Missing** or **Conflicts** tab, **Prepare questions for the leaver** starts the gap interview. Switch to **Rohan** to answer it; the answers become cited leaver testimony.
4. **Review:** what Neha will see, with counts (**52 shared · 4 earlier decisions as history · 10 withheld**). The sponsor deal is withheld with the reason. "Neha needs to add the TechNova logo…" is flagged *Looks like Neha's own work* and already has a rewrite from #dev that Neha can read. Approve v1.
5. **Handover** as **Neha**: Start here, owners, decisions (with "Earlier decision, since changed"), risks, dependencies, Unresolved. She marks items *Got it*, *Ask a question* or *Not mine*. As Meera, answer her question in place; as Neha, close it.

## 3. Complete feature list (one per line)

**Connect**
- Connect a public GitHub repo (README, docs, commits with per-file stats, PRs, issues, review comments, CODEOWNERS, workflows, `.env.example`, manifests)
- Connect a private GitHub repo with a read-only token that is used once and never stored
- Upload notes as Markdown, text, PDF or Word (.docx)
- Import Slack and Discord chat exports
- An access list on every source (default deny), shown on Connect
- Change a source's access list after creation (admin, audited, effective immediately everywhere)
- Secrets scrubbed before storage and before any AI call, with a per-source scrub report

**Reconstruct**
- Typed claims (decision, ownership, open work, next action, risk, recurring issue, dependency, contact, open question) with exact quotes
- Expected-knowledge checklist from the repo; uncovered items become Missing
- Resumable, checkpointed pipeline with a live run page
- Re-run modes: Refresh keeps all review work; evidence follows edited source text or flags "source changed"
- Duplicate claims merged by rules, only when access is identical (audited)
- **Decision timeline (#2):** reversal vs earlier state vs contradiction, each with its deciding signal, filters and a "why" drawer
- **Stale open work (#2):** overtaken tasks flagged "Probably done or parked" with the reason; the reviewer can keep them open
- Reviewer override of how two claims relate (audited, survives re-runs)

**Verify and review**
- Five statuses from a pure rules function: verified, supported, inferred, conflicting, missing
- Quote check (≥ 90 fuzzy match) as a hard gate; separate isolated AI verifier
- Evidence panel with the quote highlighted in its source, and "why this status"
- Confirm, edit (re-verified), reject, promote with a note; resolve conflicts (resolving counts as a review)
- Bulk actions, keyboard shortcuts, Undo, auto-advance, a progress meter, copy-link to a claim
- Ctrl+K search over claims and sources; an activity log with CSV export
- **Gap interview (#1):** questions from Missing and Conflicting items, editable, sent to the leaver (or answered on their behalf, labelled so)
- **Leaver testimony (#1):** answers become a cited source whose access is never wider than the items answered; conflict picks propose a resolution
- Copy, GitHub-issue or .md export of open questions

**Handover**
- Visibility preview: exactly what the successor will see, what is withheld and why
- One count for every screen: shared, history and withheld
- **Withheld items that look like the successor's own work, flagged (#3)**, with rewrite or change-access actions
- **Re-rendering a withheld item from the successor's accessible sources only (#3)**, quote-checked, verified and approved before sharing
- Versioned approvals with notes; "what changed since vN"; version history
- Successor view: Start here (their own tasks first), owners, decisions with history, risks, dependencies, Unresolved
- "Not yet confirmed by a person" marker on AI-checked items
- **Successor acknowledgement (#3):** Got it / Ask a question / Not mine per item, per version, with progress
- **Questions tracked to closure (#3):** the reviewer answers in place and the successor closes; responses carry over or reset between versions
- Several scoped handovers per project
- Ask the handover: answers cite approved, permitted items only
- Print / PDF and Markdown export (labelled history, key quotes)

**Teams and operations**
- Per-visitor demo sandbox; persona switcher resolved server-side
- Private invite links and locked identities for real teams
- Optional email (Gmail SMTP) and Slack notifications
- Workspace JSON export and deletion
- Abuse limits, daily clean-up, pipeline-health page
- AI key pools with Gemini → Groq fallback
- Security headers, timeouts, row locks; WCAG 2.1 AA checked in light and dark

## 4. Improvements completed since Round 2

**The three named improvements**

| # | As named in Round 2 | Delivered | Decision |
|---|---|---|---|
| 1 | Gap interview: targeted questions from Missing and Conflicting items; answers become a cited "leaver testimony" source | **Done.** Reviewer drafts, edits and sends; the leaver answers on their own page; testimony source with intersected access; testimony claims with explicit status rules; conflict picks propose a resolution; the successor sees testimony only after approval. No AI needed. | D50 |
| 2 | Conflict and supersession timeline: reversed decision vs genuine contradiction; interactive timeline | **Done.** Pure relation rules with recorded signals, date sanity, stale open work, reviewer overrides that survive re-runs, an interactive timeline, and the successor sees history and "changed on". No AI. | D52 |
| 3 | Successor acknowledgement and visibility diff with re-rendering | **Done**, except a person-to-person diff screen (see §10). Acknowledgement per version with carry-over and reset; questions answered and closed; withheld-but-theirs warnings; re-rendering from accessible sources only, with a test that pins what the AI receives. | D53, D54, D59 |

**Round 2 tester findings fixed (F1–F15 in `docs/07_ROUND3_PLAN.md`)**
- One count for every screen (F1)
- "Not confirmed by a person" marker, and resolving a conflict counts as a review (F2)
- Duplicate merge (F3)
- Start here without stale or other people's tasks (F4)
- No duplicate citations (F5)
- Reviewer named in the successor's "Ask" line (F6)
- Clickable cards and section pills (F7)
- Word-prefix search (F8)
- No persona-switch 403s (F9)
- Locked-step tooltips (F10)
- Instant conflict-resolve feedback (F11)
- Faster pages (F12)
- Full-height evidence panel (F13)
- Gap interview entry point (F14)
- Successor wording for conflicts (F15)

**Other**
- Admin can change source access (D48)
- History labelled instead of struck through, and key quotes in the export (D59)
- API moved next to the database (D58)
- A broken decisions table fixed

## 5. Architecture and implementation summary

See `docs/ARCHITECTURE.md` (as built, with a diagram). In short:
- **Web:** Next.js 16 on Vercel, proxying `/api/*` to FastAPI on Vercel Python Functions (region `cle1`).
- **Database:** Neon Postgres 16 with pgvector and full-text search; 23 tables over migrations 0001–0006.
- **Pipeline:** a resumable 9-step pipeline driven by polling.
- **Trust core:** `status.py`, `acl.py`, `quote_match.py` and `scrubber.py`, all pure and unit-tested.
- **AI** proposes claims, verifies them separately, and rewrites withheld items. It never decides statuses, relations, permissions or interview answers.

## 6. Testing details

From `docs/TESTING.md` §Round 3, all produced on 14 Nov 2026:
- **API tests:** 214 passed, 0 failed (real Postgres).
- **Production e2e:** 17/17 passed, covering the judge flow, interview, timeline, acknowledgements and rewrites, and counts across screens, plus axe accessibility in light and dark.
- **Citation eval** (production demo ledger):
  - recall 13/13, status accuracy 13/13, citation precision 9/10 (target ≥ 90% met);
  - 0 permission leaks, 0 secret leaks;
  - Round 3 checks: relations correct for G3 and G7, stale work flagged, re-rendered claim 1/1 clean.
- **Permission sweep:** every GET route as the successor, for every id in an approved full demo copy: 0 leaks in 179 requests.
- **Successor readiness (simulated, 6 blind AI testers):**
  - with Baton: 10/10 in about 14 s, opening 1–2 files;
  - raw sources: 10/10 in about 37 s, opening 12 files;
  - the first Baton run scored 9/10 and led to two fixes (D59).
  - Not real people; limits stated in TESTING.
- **Leaver effort:** **estimate** about 10–15 min for the 5-question demo interview. Not measured with a person.
- **Performance** (production, from India): warm API calls 0.4–0.55 s; hard loads 1.5–2.0 s; revisiting a step about 0.1 s.
- **Clean clone:** README setup verified with no AI key: migrations, frozen demo, eval, API, web build and demo sandbox.
- **Reliability matrix:** for every new screen (bad input, HTML, repeats, wrong persona, AI down, empty, phone). See TESTING.

## 7. Roadmap

See `docs/ROADMAP.md`.
- **Phase 1 (17 Nov – 20 Dec 2026):** real user sessions and one real DevClub handover.
- **Phase 2 (Jan – Feb 2027):** GitHub sign-in, GitHub App for private repos, scheduled Refresh, a live Slack connector, overdue question tracking.
- **Phase 3 (Mar – Apr 2027):** extraction quality across models, a person-to-person diff, larger repos, a knowledge-risk panel.

Each phase has effort estimates, exit tests and risks with mitigations.

## 8. Stack, services and disclosures

Unchanged from Round 2 except where noted.

**Backend:** Python 3.12, FastAPI 0.162, Pydantic 2.14, SQLAlchemy 2.1, Alembic 1.20, psycopg 3.3 (LGPL-3.0), pgvector 0.5, httpx 0.28, rapidfuzz 3.14, pypdf 7.0, python-multipart; pytest, ruff, uv.

**Frontend:** Next.js 16.4, React 19.3, Tailwind CSS 4.3, TypeScript 5, lucide-react (ISC), Playwright 1.56, @axe-core/playwright (MPL-2.0). Fonts: Fraunces, Geist, Geist Mono (OFL).

**AI models:**
- Google Gemini API: `gemini-3.5-flash` (extraction), `gemini-3.5-flash-lite` (verification, coverage, Ask, rewrites), `gemini-3.1-flash-lite` (fallback).
- Groq: `openai/gpt-oss-120b` and `openai/gpt-oss-20b` (fallbacks).
- Blind testers for the readiness study: Claude Sonnet via Claude Code (testing only, not in the product).

**Services:**
- Vercel: 2 projects, Hobby; the API is in region `cle1` since 14 Nov.
- Neon Postgres: free, us-east-2.
- GitHub REST API.
- Optional: Gmail SMTP, Slack webhooks.

**Data:** the synthetic "Campus Events App" dataset written for this project. One #dev message was added in Round 3 (D55, documented in `docs/04_DEMO_DATA.md`).

**Scaffolding:** `create-next-app`; no UI kit.

**AI coding assistance:** Claude Code (Anthropic) wrote the code under Arch's direction.

## 9. Changes from the plan

Round 3 deviations are D47–D59 in `docs/DECISIONS.md`:
- **No demo video** (not required) (D47).
- **Access-list editing added** (D48).
- **Testimony status rules** (D50).
- **Count, duplicate and speed fixes** (D56–D58).
- **Changes from the readiness test** (D59).

The successor-readiness measurement uses simulated testers rather than the 35 user tests the Round 1 PDF planned.

## 10. Not done, estimated or limited (honest)

- **Person-to-person visibility diff screen:** not built (Round 3 cut list item 2). The preview shows the successor's view and withheld items, and the version changelog shows changes after the permission filter.
- **Real people:** none have tested Round 3 yet. The readiness numbers come from simulated AI testers, and leaver effort is an estimate. The product logs real interview durations automatically.
- **Email delivery of the interview link:** uses the existing optional Gmail SMTP path. Copying the link is the default.
- **Live re-rendering on custom workspaces:** works but uses the AI (rate-limited, with a clear message when the quota is out). The demo's rewrites are precomputed.
- **Live AI depends on free quotas**, and extraction recall is lower on the Groq fallback (9–10/13 in Round 2 runs). The demo never calls the AI.
- **No real sign-in:** a persona switcher for the demo, plus invite links for real teams. Sources are snapshots; private repos can't auto-refresh.
- **A deploy drops in-flight requests.** Runs resume on the next poll. No deploys after the freeze.
- **Keys to rotate after the hackathon:** Neon password, 4 Gemini keys, 2 Groq keys, the GitHub token, the Gmail app password.

## 11. Role and contribution

Arch writes this in his own words (form rule). Facts he can use:
- Team LoneWolf is one person.
- Arch set the product direction and the trust rules, chose the scope, approved the Round 3 plan, made the calls on cuts and deviations, held all accounts and keys, ran the reviews of each milestone, and submits.
- Claude Code wrote the code, tests and documents under his direction.

## 12. Commit-history facts

- Round 2's last commit: `2772dae`, 2026-11-11 09:11 IST. No commits between then and the Round 3 window.
- Round 3's first commit: `f5c56ae`, **2026-11-14 00:06 IST** (the plan), 7 minutes after the window opened. The first code followed at 00:15 (`5f5c51a`).
- 85 commits in total at the time of writing, 14 of them in Round 3, plus this documentation commit. History is never squashed.
- No code was written outside the build windows; Round 3 builds on our own Round 2 code.
