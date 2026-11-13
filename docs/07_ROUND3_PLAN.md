# Round 3 plan: The Finish

**Window:** Fri 13 Nov 2026, 23:59 IST → Mon 16 Nov 2026, 23:59 IST (72 h).
**Target:** submission-ready by **Mon 16 Nov, 21:00 IST**. Freeze deploys at 21:00 and submit by 22:30.
**Rule:** no product code before the window opens. This plan is a planning document, like `docs/00–06` were for Round 2, and it is committed once the window opens.

---

## 1. How Round 3 is scored (from the event page) and what each criterion means for us

| Criterion | Points | What the page asks | What we do |
|---|---|---|---|
| Completeness of the product | 25 | Features finished, loose ends closed, main journeys tested. What is left undone, and did you say so? | Close the Round 2 gaps that testers found (§4). Add end-to-end tests for every new journey. HANDBACK gets a plain "not done" list. |
| The three improvements delivered | 20 | Measured against **exactly** what we named. | Build all three as named in the Round 1 PDF and the Round 2 HANDBACK (§3). The cut list trims depth, never one of the three. |
| Reliability under normal use | 20 | A judge uses it without the team steering. Bad input, an empty state and a repeated attempt all count. | A reliability matrix for every new screen and endpoint: bad input, empty, repeated or double submit, wrong persona, reload mid-action. Write requests can be retried safely. Any AI call can fail without breaking the page. |
| Usability and real-world fit | 20 | The intended user works it out without a walkthrough. | The leaver, successor and reviewer each get a page that tells them what to do next. A second round of blind agent testers. |
| Documentation and roadmap | 15 | Someone else could run it from the repo. The next step is a plan, not a wish list. | Verify the README setup from a clean clone. Write the architecture summary. Turn the roadmap into dated phases with effort estimates and risks. |

**Submission form:** https://forms.gle/FxhT5Z1NupvGTGSw6. One submission per team, made by the team leader (Arch). No late window and no extension. The organisers' Round 3 email adds: "A feature that half-works counts against you more than a feature you left out and declared". So we cut cleanly and say what we cut.

**Submission list:** final link, repo, final product PDF, complete feature list, architecture and implementation summary, improvements completed since Round 2 (including the three), testing details, roadmap, and each member's own role and contribution. Arch produces the PDF from `HANDBACK.md`. **No video** (the event page says none is required; the Round 1 PDF listed a "demo video", so we log that deviation).

**AI tools:** allowed, but must be disclosed (the README already does this). **Earlier work:** the product must be built during the event. Round 3 builds on our own Round 2 code, which was built during the event.

## 2. Measurements promised in the Round 1 PDF ("targets for Round 3 testing")

| Metric | Target | How we measure it in Round 3 |
|---|---|---|
| Citation precision of shared claims | ≥ 90% | `eval_citations` on the final demo ledger. Currently 9/10. Add the testimony and re-rendered claims to the golden set. |
| Leaver effort | < 30 min for the demo project | The interview page records the time from opening to submitting (no content, only duration). Report it from tester runs. |
| Successor readiness | Faster and more accurate with Baton | 10 continuation questions about the demo. Blind agent testers answer them **with** Baton (successor view) and **without** it (raw sources). Report time and accuracy, labelled honestly as simulated testers. Add real people if Arch can get them. |
| Permission safety | 0 restricted claims in successor views | The existing isolation and leak tests, extended to testimony, acknowledgements and re-rendered claims. |

## 3. The three improvements, as named

### #1 Gap interview with cited testimony
*Named:* "The leaver gets a short list of targeted questions generated only from Missing and Conflicting items. Answers are stored as a new, cited source labelled leaver testimony." If the leaver is unavailable, the reviewer answers instead.

**Build:**
- **Data:** an `interviews` table (workspace, handover, respondent member, status: draft, sent, answered or closed; started/submitted times) and `interview_questions` (claim id, kind: missing or conflict, question text, the options for a conflict, answer, answer kind: answered, don't know, or ask someone else, plus that name).
- **Reviewer:** "Send questions to the leaver" on Review. It builds the interview from the current Missing and Conflicting claims. The reviewer can edit, drop or add questions, then gets the leaver's existing locked invite link, or emails it when SMTP is configured. "Answer on the leaver's behalf" is offered too, and is labelled **reviewer testimony**.
- **Leaver page** (`/w/{id}/interview/{iid}`): one question per card, with progress shown as "3 of 7".
  - Conflict questions show both quoted sides (only quotes the leaver may see) and the choices "This one is current", "Both are wrong" and "Not sure".
  - Free-text answers have a 1,000-character limit, a draft is saved after each answer, and the leaver can resume later.
- **Answers to sources:**
  - Each submitted answer becomes a chunk in a `testimony` source ("Leaver testimony: Rohan, 14 Nov"), scrubbed for secrets.
  - The source's access list equals the **most restrictive** access list among the question's cited sources. A Missing item from repo structure gets all members. So testimony never widens access.
- **Turning answers into claims, with no AI needed:**
  - The answer **is** the quote, so the quote check passes by construction.
  - A `testimony` claim is created for the question's subject, with `origin=testimony`. The verifier still runs if quota allows, to check that the answer actually answers the question. If no verifier result is available, the claim stays Inferred until a reviewer confirms it.
  - `status.py` gets explicit testimony rules: testimony counts as source evidence, but is never "Verified" without reviewer confirmation, and its reason names "Leaver testimony".
- **Effect on the gaps:**
  - An answered Missing item covers its checklist item, and the Missing claim is marked answered and linked to the testimony claim.
  - An answered conflict **proposes** a resolution to the reviewer ("Rohan says 5 MB is current"). The human still resolves it (trust rule 8).
- **Successor view:** testimony items show a "Leaver testimony" badge and are cited like any other source.
- **Tests:**
  - Testimony access list is never wider than its cited sources.
  - The answer is scrubbed.
  - Answering twice is safe (idempotent).
  - Wrong persona gets 403.
  - Leaver-only access to the interview page.
  - Testimony status rules.
  - End-to-end: send, answer, review, approve, successor sees the testimony.

### #2 Conflict and supersession timeline
*Named:* "Detects when a later decision reverses an earlier one versus a genuine contradiction. Shows a decision timeline." It should be interactive.

**Build:**
- **Deterministic relationship classifier** (new pure module `reconstruct/relations.py`, unit-tested), for claims grouped by `subject_key`:
  - **reversal:** the later claim has reversal language or comes from a merged change, **and** is dated later.
  - **contradiction:** the claims disagree on the same value with no reversal signal.
  - **historical:** the claims describe different periods without disagreeing.
  - **unrelated:** grouped together by mistake.
  - Each relation stores the signal that decided it, for example "reversal word 'replaced' in PR #88, merged 2026-03-14".
- **Date sanity:** a claim can only be superseded by a *later* one. This fixes the backwards Supabase → Firebase dates the testers found. If the newer claim is older, it becomes a contradiction to review.
- **Stale open work:** `open_work` and `next_action` claims are marked **stale** (with the reason) when they are superseded by a later decision, or when their PR or issue is closed or merged. Stale items leave "Start here" and appear under "History". This fixes "Rohan is tasked with setting up push reminders".
- **AI only proposes:** an optional AI hint can propose a relation for ambiguous pairs. The rules decide (trust rule 1), and the reviewer can override with a note, which is logged in the activity log.
- **Interactive timeline** on Reconstruct:
  - One lane per subject, in date order. Edges show reversed or contradicts, colour-coded.
  - Filters by type and relation. Clicking a node opens its evidence.
  - Clicking an edge shows why the relation was decided, with Reviewer controls "This is a reversal", "These contradict" and "Unrelated".
  - Keyboard accessible, and readable on a phone as a vertical list.
- **Successor view:** decisions show "Changed on 14 Mar: Supabase Auth → Firebase Auth (PR #88)" instead of two separate items.
- **Tests:**
  - Classifier truth table, including date order, reversal words, merged PRs and values that disagree.
  - The stale rules.
  - Reviewer override is persisted and audited.
  - The golden ledger gains relation expectations (planted scenarios G3, G7 and G1 already cover this).

### #3 Successor acknowledgement and visibility diff with re-rendering
*Named:* "Successor acknowledges each item; open questions tracked to closure. Reviewer sees exactly what will be withheld and why, before approving." Re-rendering is promised too: "Round 3 adds re-rendering a claim from accessible sources only."

**Build:**
- **Acknowledgements** (the table already exists):
  - Every item in the successor view gets "Got it", "I have a question" (with a text box) or "Not mine" (with a reason).
  - A progress meter shows "12 of 47 acknowledged".
  - Acknowledgements are tied to the **version**. When a new version changes an item, its acknowledgement resets and the item shows as "changed since you acknowledged".
- **Open questions tracked to closure:**
  - A successor's question lands in the reviewer's **Open questions** queue.
  - The reviewer answers it. The answer is shown to the successor in place and PII-masked by the usual rules. Optionally the answer becomes testimony, reusing #1.
  - Status runs open → answered → closed by the successor. The reviewer's dashboard shows readiness per successor: acknowledged, open and overdue.
- **Visibility diff:**
  - Preview already shows what is withheld and why.
  - Add a comparison between two people (leaver vs successor, or successor vs teammate), and between versions after the permission filter is applied (building on the changelog).
- **Re-rendering withheld claims from accessible sources only:**
  - For a withheld claim, full-text retrieval searches **only the chunks the successor can see**, using the claim's subject terms.
  - When candidates exist, one constrained AI call sees only those chunks and writes a version of the claim that they support.
  - The result goes through the normal quote check, verifier and `status.py`. It is stored as a new claim linked to the original (`meta.derived_from`) and labelled "Re-rendered from sources you can see".
  - Restricted text **never** enters the call. A test enforces this: the prompt's chunk ids must be a subset of the successor-visible set.
  - If nothing qualifies, the item stays withheld, with a stub if allowed.
  - Re-rendered claims need the reviewer's approval before sharing (trust rule 8). The demo's re-renders are precomputed at seed time, so judges never hit a cold AI call.
- **"Withheld item assigned to the successor" warning:**
  - Preview flags withheld items that mention the successor or have a deadline, for example "Neha needs to add the TechNova logo".
  - It offers three fixes: re-render, add the successor to that source's access list (admin), or write a reviewer-confirmed note.
  - This needs **access-list editing for the admin** (`PATCH /sources/{id}/acl`, audited). That also closes the gap we found in the Round 2 feature list.
- **Tests:**
  - Acknowledgement reset on version change.
  - Question lifecycle.
  - Successor-only acknowledgement and reviewer-only answer.
  - Re-rendering never sends restricted chunks (enforced by the subset check above).
  - Access-list change audited, and its effect visible in the preview.
  - End-to-end: successor acknowledges, asks; reviewer answers; successor closes.

## 4. Round 2 fixes (blind-tester findings, 10–11 Nov) that count for Completeness, Reliability and Usability

| # | Finding | Fix |
|---|---|---|
| F1 | Counts disagree across the preview, the approve dialog, the successor page and version history (53/54/55/65/66) | One server function counts the handover. It reports superseded history separately and is used by every screen. |
| F2 | Unconfirmed "Supported" claims reach the successor, and resolving a conflict doesn't count as a review | Resolving counts as a review. The successor sees a subtle "AI-verified, not yet confirmed by a person" marker. The approve dialog breaks the counts down. |
| F3 | Duplicate claims ("15-minute timeout" twice, Firebase three times) | A deterministic merge in the status step: same type and subject, text similarity ≥ 90, evidence kept together. Audited. |
| F4 | "Start here" shows stale work and other people's tasks | Remove stale items (#2), put items assigned to the successor first, and move other people's tasks to "Owners". |
| F5 | Doubled citation "#core-team · 3 Nov · #core-team · 3 Nov" | Remove duplicate citations per item. |
| F6 | "Ask Rohan or the reviewer" doesn't name the reviewer | Name the reviewer. |
| F7 | Summary pills look clickable but aren't, and only the small source link opens the evidence | Pills jump to their section. The whole card opens the evidence. |
| F8 | Searching "MB" matches "December" | Use full-text search for words of 3 letters or more; short terms match whole words only. |
| F9 | A 403 in the console when switching to the successor | Cancel requests that belong to the previous persona. |
| F10 | Locked steps have no explanation | Add a tooltip saying what unlocks the step. |
| F11 | Resolving a conflict takes about 2.5 s with only greyed-out buttons | Update the screen immediately, show a spinner, and handle leaving the page mid-request. |
| F12 | Verify page loads in 3–4 s | Profile it. Paginate claims or load them lazily, and cache the evidence counts. |
| F13 | The claim panel is a short scrolling box, and evidence falls below the fold | Make the panel fill the viewport height and move the evidence up. |
| F14 | The questions-for-the-leaver list is hard to find | It becomes the gap interview (#1), with an entry point on Review and Handover. |
| F15 | The successor can see "Pick one, or keep both as an open risk", which is reviewer-only advice | Give the successor its own wording for conflicts. |

## 5. Reliability matrix (applied to every new screen and endpoint)

For each new action, check: bad input (empty, too long, wrong type, HTML or script), empty state (nothing to show), repeated attempt (double click, retry after timeout, back then resubmit), wrong persona or role (403 with a friendly message), reload mid-action, AI unavailable (clear message, nothing lost), and phone width. Results go into a table in `docs/TESTING.md` §Round 3.

## 6. Schedule (IST). Sleep is part of the plan.

| When | Milestone | Done means |
|---|---|---|
| Fri 23:59 – Sat 03:00 | **M0 Foundations** | Commit this plan. One migration adds interviews, questions, relations and stale fields, and adds a `version` column to acknowledgements. Access-list editing endpoint. Log DECISIONS entries D47 onwards. Deployed. |
| Sat 10:00 – 19:00 | **M1 #1 Gap interview** | Reviewer sends, leaver answers, testimony source and claims, reviewer resolves, successor sees testimony. Tests and e2e. Deployed. |
| Sat 19:00 – 24:00 | **M2a #2 rules** | `relations.py` with truth-table tests, date sanity, stale work, F4. Demo ledger recomputed **without AI**. Deployed. |
| Sun 10:00 – 16:00 | **M2b #2 timeline UI** | Interactive timeline, reviewer override, successor "changed on" items. Deployed. |
| Sun 16:00 – 24:00 | **M3a #3 acknowledgements** | Acknowledge, ask, Not mine; reset on version change; reviewer Open questions queue; readiness. Deployed. |
| Mon 10:00 – 14:00 | **M3b #3 re-rendering and visibility diff** | Withheld-for-successor warning, re-rendering (precomputed for the demo), person-to-person diff. Deployed. |
| Mon 14:00 – 17:00 | **M4 Fixes and reliability** | F1–F15, the reliability matrix, e2e for all journeys, accessibility checks. |
| Mon 17:00 – 19:00 | **M5 Measure** | Eval, leaver-effort timing, successor-readiness A/B with blind agent testers, permission tests. Real numbers in TESTING. |
| Mon 19:00 – 21:00 | **M6 Docs and freeze** | README checked from a clean clone, architecture summary, roadmap, HANDBACK, screenshots, feature list. Freeze at 21:00. |

## 7. Cut list (in order). The three improvements are never cut, only trimmed.

1. AI hints for ambiguous relations in #2 (the rules alone remain).
2. Person-to-person visibility diff in #3 (the preview and the version diff remain).
3. Live re-rendering for custom workspaces (keep it precomputed for the demo, and keep the warning plus the reviewer-note fix for everything else).
4. Email delivery of the interview link (copying the link remains).
5. Timeline filters and phone-specific layout beyond a plain vertical list.
6. F12 performance work beyond quick wins.

## 8. AI quota plan

The free tier is about 20 requests a day per Gemini key on Flash, with 3 Gemini and 2 Groq keys.
- #1 and #2 need **no AI** on the main path. The answer is the quote, and relations are decided by rules.
- Only re-rendering (#3) and the optional verifier on testimony use AI. The demo's AI outputs are produced once at seed time and frozen, like the Round 2 ledger.
- No casual live runs. Every new live AI path shows a clear message when quota is out.

## 9. Deviations to log when the window opens

- No demo video. The event page doesn't require one; the Round 1 PDF listed it.
- Access-list editing added. It's needed for the #3 fix, and it closes a gap in the Round 2 feature list.
- Testimony status rules (new rows in `status.py`): testimony is evidence, but never Verified without a reviewer.
- Successor-readiness measured with simulated blind testers, plus real people if Arch can get them. The Round 1 PDF planned 35 user tests.

## 10. Stretch (only if ahead of schedule, in this order)

1. Real email delivery of the interview link and notifications (SMTP for `baton.handovers@gmail.com`, verified at the window's start).
2. One-command local setup and a clean-clone check of the README.
3. A real PDF download of the handover.
4. Guided access setup when creating a real workspace.
5. Cancel a run, with clearer messages when the AI quota runs out.
6. A small, read-only "knowledge risk" panel (files maintained by a single person).
