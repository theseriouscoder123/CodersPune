# Baton: design brief (for a UI/UX redesign)

Paste this whole document into the design tool. It describes every screen of a working product. We want a **new,
distinctive visual direction** for it, not new features, and not a generic SaaS dashboard.

---

## 1. The product in one paragraph

**Baton** is an evidence-graded knowledge-handover tool for small software teams. When someone leaves a project,
Baton reads what they left behind (GitHub repo, meeting notes, Slack or Discord chat) and rebuilds what they knew as a
**ledger of claims**. Every claim links to the **exact quote** it came from and gets a **status from fixed rules**, not
from the AI. A **reviewer** checks and approves it, and the **successor** gets a continuation plan filtered to what
they are allowed to see, with unknowns clearly marked.

**Tone:** trustworthy, calm, precise. Think "a well-kept engineering notebook" or "an archivist's ledger", not
"AI magic". Evidence, provenance and permissions are the heroes. Polish must never hide uncertainty.

## 2. People (personas you can switch between in the demo)

| Person | Role | What they need from the UI |
|---|---|---|
| **Meera** | Reviewer and admin (club coordinator) | Check claims fast, see why each has its status, resolve conflicts, preview exactly what the successor will get, approve |
| **Rohan** | Leaver (leaves 15 Nov) | Answer a short list of questions only he can answer, quickly |
| **Neha** | Successor | Know what to do first, what's risky, what nobody knows yet; acknowledge items; ask questions |
| **Kabir** | Ordinary member | Sees only what his access allows |

The demo uses a fictional student-club project, "Campus Events App", labelled **Synthetic demo data** everywhere.

## 3. Information architecture

A workspace has a **5-step stepper** that is the backbone of the app:

`1 Connect → 2 Reconstruct → 3 Verify → 4 Review → 5 Handover`

- Steps can be **locked** for a persona (for example, the successor only gets step 5). A locked step shows why on hover.
- Header utilities: Reset demo · Search (Ctrl+K) · Knowledge risk · Activity log · Team · Theme toggle · **"Viewing as" persona switcher** (shows name and a role badge).
- A small floating **Demo tour** pill (bottom right, for example "2/6") tracks the guided tour.
- Each step page starts with a dismissible **coach bar** ("Step 2 · Reconstruct. Baton broke the project down…").

## 4. Semantic system (must survive any redesign)

**Five claim statuses.** These are the core vocabulary. Each needs a distinct, accessible colour, an icon and a label,
and must be distinguishable in grayscale.

| Status | Meaning |
|---|---|
| **Verified** | Quote found, separate check agrees, and a person confirmed it |
| **Supported** | Quote found and a separate check agrees; not yet confirmed by a person |
| **Inferred** | Likely, but no passing evidence; never shown to the successor as fact |
| **Conflicting** | Two sources disagree (for example, 5 MB in notes vs 2 MB in code) |
| **Missing** | Something a successor needs that no source covers |

**Other states that must be unmissable:**
- **Withheld or restricted:** an item hidden from someone because a source it cites is restricted. Show a lock and the reason ("cites #core-team (Reviewers, Kabir, Rohan)").
- **History:** a decision since changed, or work probably done. Label it ("Earlier decision, since changed"). **Never strike text through**; testers read strike-through as "false".
- **Unresolved:** nobody has answered it yet; ask before relying on it.
- **Evidence quote:** a verbatim excerpt with its source location ("PR #88", "#dev · 12 Mar", "upload.ts:41"), with the quoted span highlighted.

## 5. Current look (what to keep, what to drop)

**Current tokens:**
- Warm paper background (#f7f4ee); ink navy text (#14213d); amber accent (#d9961b).
- Status colours: verified green, supported blue, inferred grey, conflicting burnt orange, missing red.
- Display serif **Fraunces** for headings, **Geist** for UI, **Geist Mono** for source references.
- Light and dark themes.

**Keep:**
- the paper-and-ink "ledger" identity;
- the serif headings;
- monospace source references;
- semantic status colours (they can be refined);
- the strong 5-step stepper.

**Feels generic, please replace:**
- the same rounded white card used for everything;
- pill chips everywhere;
- soft gradient bars;
- uniform 2-column card grids;
- weak hierarchy between "the main thing on this page" and supporting info;
- icon-plus-label rows that all look alike.

We want more editorial structure:
- real typographic hierarchy;
- rules and dividers like a printed ledger;
- tables where data is tabular;
- density where reviewers need speed;
- generous space where the successor needs calm.

## 6. Global constraints

- **Accessibility:** WCAG 2.1 AA contrast in both themes, visible focus, keyboard access throughout (the reviewer uses shortcuts j/k/c/r/e/x), touch targets of at least 40 px on phones.
- **Responsive:** desktop at 1440 px and phone at 375 px. No sideways scroll. On phones the sticky header plus stepper currently takes about 165 px of 812; please make it compact.
- **Light and dark** for every screen.
- **Honesty:** never hide counts, warnings or the reason something is withheld; never make an AI guess look like a fact.
- Built with Next.js and Tailwind CSS. Simple, implementable components please (no heavy illustration or 3D).

---

## 7. Screens

For each screen: purpose · content in priority order · key actions · states.

### 7.1 Landing page (`/`)
- **Purpose:** explain Baton in 10 seconds and get people into the demo.
- **Content:**
  - hero ("An evidence-graded knowledge handover") with **Try the demo** as the primary button and "Start from your own repo" as secondary;
  - a visual of a claim with its quote and status;
  - "Five steps, each with a clear owner";
  - "Five statuses, set by rules";
  - "Everything around the handover";
  - "Designed for the parts of a project people shouldn't see" (permissions);
  - closing CTA "See a full handover in two minutes";
  - footer with disclosures (synthetic data, AI-assisted).
- **States:** API offline banner.

### 7.2 Start from your own project (`/new`)
- **Purpose:** create a real workspace from a public GitHub repo plus optional notes and chat export.
- **Content:**
  - repo URL;
  - optional private-repo token (used once, never stored);
  - uploads (Markdown, PDF, Word, Slack or Discord export);
  - **People** (who is leaving, who takes over, who reviews);
  - **who can see each source** (access per source);
  - start button.
- **States:** validation errors, daily limit reached, AI not configured.

### 7.3 Join via invite (`/join/{token}`)
- Private invite link confirmation ("You'll join as Neha"). Error state for a revoked or used link.

### 7.4 Step 1 · Connect (`/w/{id}/sources`)
- **Purpose:** show what Baton may read and who can see each source.
- **Content:**
  - a list of 4 sources (GitHub repo, Meeting notes, #dev, #core-team), each with:
    - type icon;
    - item count;
    - **access label** ("All members" / "Reviewers, Kabir, Rohan");
    - preview of the first items;
    - **"N secrets removed before storage"** report;
  - a header badge with the total secrets removed;
  - admin action **Change access**, which opens a dialog of roles and members, with a warning when widening.
- **States:** no sources yet; the read-only shared template.

### 7.5 Run progress (`/w/{id}/runs/{run}`)
- **Purpose:** watch the pipeline: Ingest → Checklist → Extract → Cover → Match quotes → Verify → Conflicts → Status → Handover.
- **Content:** a step list with progress and messages, elapsed time, and errors explained in plain words (for example, AI quota used up), with retry.

### 7.6 Step 2 · Reconstruct (`/w/{id}/ledger`)
- **Purpose:** the reconstructed ledger at a glance, and how decisions evolved.
- **Content:**
  1. header: "The reconstructed ledger · 70 claims about Rohan's work", with actions *Inspect the evidence* (primary), *Knowledge risk*, *Re-run pipeline*;
  2. **counts by status**: 5 tiles with a number, a one-line meaning and a share bar;
  3. **counts by type**: decision, open work, ownership, next action, risk, contact, dependency, recurring issue;
  4. **Decision timeline**:
     - a vertical, dated list;
     - filters: Everything / Changed decisions / Contradictions / Probably done;
     - each event shows date · type · source refs · text, plus a relation label ("Current state", "Describes an earlier state", "Contradicts", "Probably done or parked");
     - clicking a label opens a **side drawer** with "Why Baton thinks so" (the exact signal), plus reviewer actions ("This is a reversal / These contradict / Unrelated", "It's still open");
  5. "How this ledger was built" run log.
- **States:** loading skeletons, an empty ledger, a run in progress.

### 7.7 Step 3 · Verify (`/w/{id}/review`): the reviewer's workbench, speed matters
- **Layout:** two panes, both sticky and viewport-height.
  - **Left:** claim list with tabs (To review · All · Conflicts · Missing · Inferred · Superseded) and search. Each row shows status, type and a short text. There's a progress meter ("12 of 70 reviewed") and bulk actions.
  - **Right:** the **claim panel**:
    - status chip, type, origin tags ("From the repo checklist", "Not explicitly stated");
    - the claim text, large;
    - **"Why supported: Quote found in PR #88 (match 100) · verifier: supports"**;
    - for a conflict: both sides side by side, with "This one is current" on each and "Keep both as an open risk";
    - **Evidence list**: each quote with its source ref, the highlighted span and the verifier verdict;
    - actions: Confirm (c), Edit (e), Reject (r), Promote with note, Comment; Undo in the toast; copy-link icon.
- **On the Missing and Conflicts tabs, a gap interview bar:** "Missing and conflicting items can be sent to the leaver as a short gap interview" → **Prepare questions for the leaver**, plus quiet export links (Copy · GitHub issue · .md).
- **States:**
  - nothing selected ("Select a claim to inspect its evidence");
  - resolving ("Marking … as current. Re-grading the claims…");
  - source changed after the claim was made (notice);
  - read-only template.

### 7.8 Gap interview (`/w/{id}/interview/{id}`): two faces
- **Reviewer (draft):** a list of questions generated from Missing and Conflicting items. Each can be edited or removed, and custom questions can be added. Then *Send to Rohan*, or *Answer on his behalf* (labelled as such).
- **Leaver (Rohan):** "A few questions before you hand over", "0 of 5 answered" progress, then one card per question:
  - a kind tag ("Missing from the sources" / "Sources disagree");
  - the question;
  - "Baton expected this because…";
  - a free-text answer (1,000 characters), or for conflicts a pick between the two quoted sides;
  - "I don't know" and "Someone else would know" (who?);
  - **Save answer** per card;
  - a sticky footer: "Answer at least one question to submit" with **Submit answers**.
- **After submit:**
  - "Submitted. 2 testimony claims added to the ledger";
  - "Resolve as Rohan says" for conflict picks;
  - "Open the testimony claim".
- Answers become **Leaver testimony**, a cited source.

### 7.9 Step 4 · Review: what the successor will see (`/w/{id}/review/preview`)
- **Header:** "What Neha will see". A handover picker ("Rohan → Neha · draft", "+ New handover"), then *Back to claims* and **Approve handover v1** (primary, green).
- **Two columns:**
  - **Left, "Neha will see (52 + 4 as history)":** items grouped by section (Start here · Who owns what · Key decisions · Risks and conflicts · Dependencies and contacts · Unresolved), each row a status plus text; history rows are labelled.
  - **Right, sticky and scrollable, "Withheld from Neha (10)":** each withheld item shows its text, the lock reason, and:
    - a flag **"Looks like Neha's own work · It names Neha / It has a deadline"**;
    - **Rewrite from Neha's sources** / **Change who can access the source**;
    - a nested result card **"Rewritten from sources Neha can read"** with its status, or an explanation ("Neha already sees this from a source she can read: …").
- **Below, "Compare what two people see":**
  - two person pickers;
  - three counts (both see · only A · only B);
  - two columns of differences, each "Hidden from X: cites …".
- **Approve dialog:**
  - three numbers (**52 items shared · 4 earlier decisions as history · 10 withheld**);
  - "47 of the 52 shared items passed the AI check but no person has confirmed them";
  - a "Before you approve" warnings box;
  - a "Show withheld items as Restricted stubs" checkbox;
  - an approval note;
  - Approve and share.
- After approving, a banner: "Version 1 approved" → **View as Neha**.

### 7.10 Step 5 · Handover, the successor's document (`/w/{id}/handover`): calm, readable, printable
- **Document header:**
  - "ROHAN → NEHA · VERSION 1";
  - large avatars "Rohan → Neha";
  - "Approved by Meera on 14 Nov 2026 · viewing as Neha";
  - the count line "52 items · 4 earlier decisions kept as history · 47 AI-checked, not yet confirmed by a person";
  - Print / Save as PDF; Export Markdown;
  - **section jump links** with counts;
  - **"Your progress: 5 of 52 items done · 1 question waiting"**.
- **What changed since v1** (when there's more than one version): added, updated, removed.
- **Ask the handover:** a question box plus suggestion chips; answers cite approved items only.
- **Sections:** Start here (wide, two columns), Who owns what, Key decisions, Risks and conflicts, Dependencies and contacts, Unresolved. Each item card has:
  - status and type, plus "not yet confirmed by a person" when that applies;
  - the text;
  - source ref links that open an **evidence drawer** with the highlighted quote;
  - history label and "Changed 9 Feb: …";
  - for Unresolved: "No source answers this. Ask Rohan or Meera.";
  - **for the successor only: Got it / Ask a question / Not mine**, with an inline question box; states are acknowledged, waiting for the reviewer, answered (with the answer), closed, and "changed since you acknowledged it in v1".
- **Reviewer view of the same page:** a "From Neha" questions panel to answer in place, and version history (a table of version, approved by, when, items, +/−, note).
- **States:**
  - not approved yet ("Your handover is being prepared by Meera"; in the demo, "Switch to Meera and approve");
  - restricted stubs ("Restricted item. Ask the reviewer").

### 7.11 Knowledge risk (`/w/{id}/risk`)
- **Purpose:** before anyone leaves, show where knowledge would be lost if one person left.
- **Content:**
  - **Services and accounts with no named owner** (Firebase, Cloudinary);
  - one card per person, ranked: a level badge ("High risk · 14") and a bar;
  - under each person: "Maintains alone" (`.github/workflows/deploy.yml`, 31 of 33 commits), "Open tasks", "Unanswered gaps", "Only they wrote it down";
  - **Start a handover for X** (pick a successor) or **Open X's handover**;
  - contributors outside the workspace shown as such;
  - a "How the score works" footnote (fixed rules, no AI).

### 7.12 Activity log (`/w/{id}/activity`)
- A filterable feed (Everything / Decisions / Comments / Approvals): who did what and when, the claim affected, the note. CSV export.

### 7.13 Team and access (`/w/{id}/team`)
- **People:** name, roles, email, private invite link (create, rotate, copy), joined state; a lock-identities mode.
- **Notifications:** Email, Slack and Discord webhooks (set, test, remove; the URL is shown masked), and a "Recent" delivery log.
- **Data:** export workspace JSON; delete workspace (danger).

### 7.14 Pipeline health (`/w/{id}/health`)
- An operations page: AI calls by purpose and model (counts, failures, latency) and recent runs.

### 7.15 Search (Ctrl+K overlay)
- A command palette over claims and sources, with status chips and type filters.

### 7.16 Planned pages (please design these too)
- **Before Rohan leaves:** for the reviewer and the leaver.
  - The leaver's last day with a **countdown** ("6 days left").
  - One ordered list of what must happen before then: transfers (Vercel ownership), unanswered gap questions, files only he maintains (walkthrough needed), open successor questions waiting on him.
  - Each item shows its status and a jump link.
- **Neha's first week:** for the successor.
  - Day 1 / Days 2–3 / Rest of week 1, built from Start here, Unresolved and her acknowledgements.
  - Each item has a reason ("Rohan leaves 15 Nov, do this first"), and there's a progress indicator.

---

## 8. What we'd like back

1. **One visual direction**, with a short rationale: typography scale, colour tokens (light and dark), spacing, radii, elevation, and component styles (buttons, status marks, tabs, tables, drawers, dialogs, toasts, empty states).
2. **Mockups**, desktop 1440 and phone 375, light and dark where it matters, of:
   - the Landing page;
   - Verify (both panes);
   - Review preview (with the withheld column and the approve dialog);
   - the Handover successor document (with acknowledgement states);
   - Reconstruct (counts plus timeline);
   - Knowledge risk;
   - the Leaver interview;
   - the workspace shell (header, stepper, persona switcher, compact phone header).
3. **Do not** add features, remove warnings or counts, or change the five statuses' meaning.
