# 01 — Product Spec (Round 2 scope)

Source of truth for *what* Baton does. Architecture is in `02`; algorithms and prompts are in `03`.

## 1. One-line pitch

Baton turns a departing member's project activity into a **ledger of evidence-graded claims**, which a reviewer approves
and which is then shown to the successor filtered by what they're allowed to see.

## 2. Roles

| Role | Who (in the demo) | Can do |
|---|---|---|
| **Admin** | Meera (club coordinator; also the reviewer in the demo) | Connect sources, set each source's access, manage members, start runs |
| **Reviewer** | Meera | See all claims and evidence; edit, reject, confirm, promote; resolve conflicts; preview visibility; approve versions |
| **Leaver** | Rohan (graduating app lead) | See claims about their own work and all sources they had access to; add comments or corrections (stored as review events, `actor_role=leaver`) |
| **Successor** | Neha (2nd-year member taking over) | See only the latest **approved** handover version, projected through their own access |
| **Member** (extra persona) | Kabir (treasurer, core team) | Exists so the demo has a restricted channel authored by someone else; can view handovers they're named in |

A user can hold several roles. Roles are per workspace (the `memberships` table).

## 3. Claim types

`decision`, `ownership`, `open_work` (unfinished work or PR), `next_action`, `risk`, `dependency`
(external service, account, library or person the project relies on), `contact`, `recurring_issue`, `open_question`.

Each claim has:
- `text`: one atomic statement in plain English (≤ 220 chars)
- `subject_key`: normalised topic, used for conflict grouping (e.g. `upload.max_size`, `notifications.provider`, `deploy.owner`)
- `value` (optional): normalised value used for conflict comparison (e.g. `5MB`, `FCM`)
- `occurred_at`: when the underlying event happened (from the evidence timestamp)
- `origin`: `extracted` | `checklist` | `testimony` (R3)
- `evidence[]`: zero or more evidence items (chunk + exact quote + match score + entailment verdict)
- `status` (computed), `review_state`, `superseded_by` (nullable)

## 4. Status rules (implement exactly; pure function; unit-test every row)

Definitions for one evidence item `e`:
- `e.quote_found` = normalised fuzzy match (rapidfuzz `partial_ratio`) of `e.quote` inside `e.chunk.text` ≥ **90**
  (normalisation: lowercase, collapse whitespace, strip Markdown emphasis and quote characters)
- `e.passes` = `e.quote_found AND e.verdict == "supports"`
- `e.contradicts` = `e.quote_found AND e.verdict == "contradicts"`

Evaluate in this order; the first match wins:

| # | Condition | Status |
|---|---|---|
| 1 | `review_state == rejected` | **rejected** (excluded from every view except the reviewer's "Rejected" filter) |
| 2 | Claim is in an **unresolved conflict group** (§6) | **conflicting** |
| 3 | `origin == checklist` and no `e.passes` | **missing** |
| 4 | `review_state == confirmed` and ≥1 `e.passes` | **verified** |
| 5 | `review_state == promoted` (reviewer note required) | **verified**, with flag `reviewer_confirmed_without_evidence = true` |
| 6 | ≥1 `e.passes` | **supported** |
| 7 | otherwise | **inferred** |

Notes:
- A reviewer **edit** to the claim text resets `review_state` to `edited`. Evidence is kept, but the verifier must be
  re-run on the edited text (synchronously, single claim). This stops edits from silently keeping a "supported" badge.
- A conflict is **resolved** when the reviewer picks a winner (the other claim gets `superseded_by` = winner and drops
  out of default views), or marks it "keep as open risk" (both stay, and one new `risk` claim is created that cites both).
- The UI must always explain the status: e.g. "Supported: quote found in PR #88 (match 97) and the verifier says it supports the claim. Not yet confirmed by a person."

## 5. Permissions model

- Every **source** has an ACL: a set of member ids and/or role names (`role:reviewer`, `role:all_members`). **Default deny.**
- Every **chunk** inherits its source's ACL. ACLs are stored as a normalised `acl_key` (sorted string) for batching.
- `can_view_source(user, source)` = the user is in the ACL, or has a listed role, or is a reviewer of that workspace.
- **Claim visibility** for user U: `visible(U, claim)` iff for every evidence item on the claim, `can_view_source(U, e.chunk.source)`.
  - Missing claims with no evidence: visible, unless the checklist item was derived from a restricted source (then
    treat that source as the evidence).
- **Successor projection** (handover view and visibility preview): from the approved version's claims, keep
  `visible(successor, c)`. Withheld claims are either omitted, or (if the reviewer turns on "show restricted stubs" for
  that handover) shown as `"Restricted item — ask Meera (reviewer)"`, with **no** claim text, type, quote or source name.
- **Evidence endpoints** check `can_view_source` for every chunk returned. A successor hitting `/api/claims/{id}` for a
  withheld claim gets **404**, not 403 (don't leak existence).
- **PII masking:** emails and phone numbers in quotes are masked (`r***@…`) for everyone except reviewers.

## 6. Conflicts (Round 2 level)

- After extraction, group non-rejected claims by `subject_key`.
- Within a group, if two claims have different normalised `value`s, **and** neither carries `supersedes_hint=true` with a
  later `occurred_at`, then create a `conflict_group` containing both → status **conflicting**.
- If the later claim has `supersedes_hint=true` (explicit reversal language, or it comes from a merged PR that changes the
  value), set `older.superseded_by = newer` automatically and show it as "Superseded" in the timeline. It is not a conflict.
- Every unresolved conflict adds a question to "Questions for the leaver".

## 7. Expected-knowledge checklist (Missing detection)

Built deterministically from the repo, before or alongside extraction. Each item becomes a `checklist`-origin claim and
is marked covered if extraction or retrieval finds passing evidence (algorithm in `03 §4`):

| Signal in the repo | Generated claim (template) | Type |
|---|---|---|
| Open PR authored by the leaver | "Status and next step for PR #N '<title>'" | open_work |
| Open issue assigned to the leaver | "Status and next step for issue #N '<title>'" | open_work |
| Key prefix group in `.env.example` (e.g. `FIREBASE_*`) | "Who owns the <Firebase> account/project and its billing" | contact |
| Each workflow in `.github/workflows/*` | "Who maintains the '<name>' workflow and how to run it" | ownership |
| File or dir where the leaver authored ≥ 80% of commits (min 5 commits) | "Leaver is the primary maintainer of <path>" (evidence: commit stats) | ownership |
| A dependency added by the leaver in `package.json`/`requirements*.txt` | "Why <pkg> was chosen" (only for ≤ 5 notable runtime deps) | decision |

Commit-stat ownership claims are **evidence-backed by computed stats**: the evidence chunk is a generated
"commit statistics" chunk whose text lists the counts, so the quote match still applies.

## 8. Screens (Round 2)

Global header on every workspace page:
- **Five-step stepper**: Connect · Reconstruct · Verify · Review · Handover. Shows the current step and completion.
- **"Viewing as" persona switcher** with role badges. Switching reloads data from the server under that persona.
- "Synthetic demo data" badge in the demo workspace. "Reset demo" in the menu.

| # | Screen | Content | Key interactions |
|---|---|---|---|
| S0 | Landing `/` | Product one-liner, the five steps as a strip, two CTAs: **Try the demo (no sign-up)** and **Start with a public GitHub repo**. | Try the demo → create sandbox → S2 |
| S1 | New workspace `/new` | Repo URL, file upload (md/txt/pdf), chat export (Slack JSON), member list (name + role), per-source access picker. | Create → S2; the run starts automatically |
| S2 | Connect `/w/:id/sources` | Source cards: type icon, name, item counts, access chips ("Visible to: all members" / "Core team only"), scrub report ("2 secrets removed"). | Add source, change access (admin), Run pipeline |
| S3 | Run progress `/w/:id/runs/:run` | Live steps with counts: Ingest → Chunk → Extract (batches n/m) → Checklist → Verify → Status. Errors shown inline per batch. | Auto-advance to S4 when done |
| S4 | Ledger and review `/w/:id/review` | Status count bar (clickable filters); type filter; search; left list of claims (type, status chip, text, source short-refs); right **evidence panel** (each quote with highlighted span, source, location, access, match score, verdict, and a plain-English status explanation). Tabs: **Claims · Conflicts · Missing · Timeline · Rejected**. | Confirm, Edit, Reject, Promote (requires a note), Resolve conflict (pick winner / keep as open risk), Copy "Questions for the leaver" |
| S5 | Visibility preview `/w/:id/review/preview?as=neha` | Two columns: "Neha will see" (N claims) / "Withheld from Neha" (M claims, each with the reason: "cites #core-team (Core team only)"). Toggle "show restricted stubs". | Approve version (opens a dialog: note + successor) |
| S6 | Handover `/w/:id/handover/:hid` | The successor's continuation plan: **Start here** (next actions + open work), **Who owns what**, **Key decisions** (with superseded history collapsed), **Risks and conflicts**, **Dependencies and contacts**, **Unresolved** (missing + open questions, visually distinct). Every item has a status chip + clickable source refs (evidence drawer, permission-checked). Version and approver shown at the top. Export to Markdown. | Open evidence, Export |
| S7 | Versions `/w/:id/versions` | Version list (v1, v2…), approver, time, claim counts, diff summary vs the previous version. | View any approved version |

**Empty and error states are required:** no sources yet; run failed (with the reason, e.g. "LLM key missing" or "GitHub rate limit");
no approved version yet (successor sees "Your handover is being prepared by Meera"); repo too large (we cap it, and say so).

**First-run hints (usability points):** a small dismissible coach bar on S2, S4 and S6 explaining that step in one
sentence, e.g. on S4: "Every claim is graded by its evidence. Open one to see the source, then confirm, fix or reject it. When you're done, preview what Neha will see."

## 9. Out of scope for Round 2

Login/OAuth, live Slack/Jira connectors, audio/video, multi-language, email notifications, acknowledgements (R3 #3),
the gap-interview flow (R3 #1; R2 only has the copyable question list), the interactive timeline editor (R3 #2; R2 has a
read-only timeline list).

## 10. Acceptance criteria (each must pass on the deployed link)

1. Try the demo creates an isolated sandbox. Two browsers do not see each other's edits.
2. The demo ledger shows **every** planted scenario from `04_DEMO_DATA.md` with the expected status (some LLM variance in wording is fine).
3. Opening any Supported or Verified claim shows ≥1 quote that is visibly present in the displayed source excerpt.
4. As Neha, the restricted sponsor claim is absent from S6 and from every API response (checked by an automated test).
5. A fake secret planted in the chat export never appears in the DB, the UI or any LLM request log.
6. The reviewer can confirm, edit, reject, promote, resolve a conflict and approve. The successor then sees exactly the preview contents.
7. Editing a claim triggers re-verification, and the status updates accordingly.
8. Custom-repo flow: a small public repo (< 300 commits) produces a ledger in under 5 minutes, or fails with a clear message.
9. No unhandled exception reaches the UI in the full judge flow (Playwright e2e passes against production).
