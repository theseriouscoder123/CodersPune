# Roadmap

Baton after the hackathon: dated phases, effort for one developer (Arch, part-time, about 15 h a week), the exit test
for each phase, and the risks. Ordered by what most limits real use today: people haven't used it yet, and real teams
need sign-in and live sources.

## Where it stands (16 Nov 2026)

The full loop works on production for the demo and for any public GitHub repo plus notes and chat exports: connect →
reconstruct → verify → review → approve → handover, plus the three Round 3 improvements. Known gaps are listed in
`HANDBACK.md` §10. The main ones:
- no real sign-in;
- sources are snapshots (no live sync);
- it hasn't been tested with real people;
- live AI runs on free quotas.

## Phase 1: Real users on the demo and one real team (17 Nov – 20 Dec 2026, about 4 weeks)

| Work | Effort | Exit test |
|---|---|---|
| 5 moderated sessions with club members (leaver, successor, reviewer roles) using the existing readiness questions (`apps/api/eval/readiness/`) | 1 week | Real times and accuracy replace the simulated numbers in TESTING; leaver interview duration measured from the activity log |
| One real handover in DevClub's next term change (real repo, real notes) | 1 week | A successor completes their acknowledgements; the questions they asked are logged |
| Fix what those sessions find (expected: wording, navigation, missing context in claims) | 1.5 weeks | No session gets stuck without help |
| Rotate every key used during the hackathon | 0.5 day | Done before anything else |

**Risks:** few volunteers before exams. *Mitigation:* 20-minute sessions, done remotely, with the demo needing no setup.

## Phase 2: Ready for a real small team (Jan – Feb 2027, about 6 weeks)

| Work | Effort | Exit test |
|---|---|---|
| Sign-in with GitHub (OAuth), mapping GitHub users to members; invite links stay as a fallback | 1.5 weeks | Server-side identity from a session, not a header; isolation tests pass unchanged |
| GitHub App instead of tokens: private repos refresh automatically (today their token is used once and dropped) | 1.5 weeks | A private repo re-runs Refresh without the user pasting a token |
| Scheduled Refresh (nightly) with "changed since you approved" alerts to the reviewer | 1 week | A new PR comment shows up as a claim flagged for review the next day |
| Slack slash command `/baton ask` and gap-interview questions delivered as Slack DMs (the read-only live connector already exists) | 1 week | A leaver answers in Slack and the answer becomes cited testimony |
| Overdue tracking for successor questions, plus a readiness view per successor | 0.5 week | The reviewer sees acknowledged, open and overdue per person |

**Risks:**
- *Slack API review and rate limits.* Mitigation: keep exports as the default and make live sync opt-in.
- *OAuth changes the auth model.* Mitigation: the permission projection is already server-side and tested by endpoint sweeps, so only identity resolution changes.

## Phase 3: Quality and scale (Mar – Apr 2027, about 5 weeks)

| Work | Effort | Exit test |
|---|---|---|
| Extraction quality on non-Gemini models (recall was 9–10/13 on Groq vs 13/13 on Gemini): better batching and retries, plus a small paid model budget for real teams | 2 weeks | Recall ≥ 12/13 on two providers |
| Larger repos: history beyond about 60k characters per run, using embeddings to prioritise (`EMBEDDINGS=fastembed` seam exists) | 2 weeks | A 2,000-commit repo completes within the free time limits |
| Knowledge risk over time: weekly snapshots from the GitHub Action, trend per person | 1 week | A falling bus factor is visible before anyone resigns |

**Risks:**
- *Free-tier limits* (Vercel function time, Neon storage, AI quotas). Mitigation: the pipeline already works in bounded slices; move AI to a paid key per team when a team adopts it.
- *Model drift changing quotes.* Mitigation: the quote gate and the eval catch it; run the eval on every model change.

## What will not change

The trust rules stay as they are:
- statuses come from rules;
- quotes must be found in their source;
- a separate verifier checks each claim;
- permissions are enforced on the server at every read;
- nothing reaches a successor before a person approves it.

Every phase keeps the leak sweep and the eval green.
