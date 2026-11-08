# 04 — Demo Data: the synthetic "Campus Events App" project

Everything here is **fictional and synthetic**, written for this hackathon. The UI must show a "Synthetic demo data" badge.
Generate the files under `demo/` exactly to this spec. Natural, slightly messy writing is good; real teams aren't tidy.
**Every planted scenario must be reliably findable.** It is both the judge's tour and the labelled test set.

## 1. Story

DevClub, a college tech club, maintains **Campus Events App** (Next.js web app + Firebase) for event listings, RSVPs and
push reminders during the annual fest. **Rohan** has led the app since January 2026 and leaves on **15 Nov 2026** for a
six-month internship. **Neha** (2nd-year member) takes over. **Meera** (club coordinator) reviews and approves the handover.
**Kabir** is the treasurer. **Dr. Rao** is the faculty coordinator (mentioned in sources, not an app user).

## 2. People and roles in the workspace

| Member | Handle | Roles |
|---|---|---|
| Meera | `meera` | admin, reviewer |
| Rohan | `rohan` | leaver, member |
| Neha | `neha` | successor, member |
| Kabir | `kabir` | member |

## 3. Sources and access

| Source | Type | Access (ACL) | Contents |
|---|---|---|---|
| `devclub/campus-events-app` | fixture (GitHub-shaped JSON) | all members | README, `docs/setup.md`, `.env.example`, `.github/workflows/deploy.yml`, `src/lib/upload.ts`, `package.json`, ~60 commits, ~12 PRs with comments, ~15 issues |
| Meeting notes | upload (3 × .md) | all members | `2026-02-10-kickoff.md`, `2026-04-02-fest-prep.md`, `2026-10-28-handover-sync.md` |
| `#dev` | chat_export (Slack JSON) | all members | ~120 messages, Jan–Nov 2026 |
| `#core-team` | chat_export (Slack JSON) | **reviewer + Kabir + Rohan only** (Neha excluded) | ~25 messages, incl. sponsor details |

Fixture format: mirror the GitHub REST shapes (`repo.json`, `commits.json` with `files[]`, `pulls.json`,
`pull_comments.json`, `issues.json`, `issue_comments.json`, `tree/` with file contents), so `ingest/fixtures.py` reuses
the same normaliser as the live GitHub connector. Locations get pseudo-permalinks such as
`https://github.com/devclub/campus-events-app/pull/88` (fictional org; the UI shows the excerpt inline, so links don't need to resolve).
*Optional, only if there's time:* push the fixture as a real public repo under Arch's account, so the links work.

## 4. Planted scenarios = golden ledger (the judge tour and the test set)

| ID | Type | Expected claim (gist) | Where the evidence lives | Expected status (before review) |
|---|---|---|---|---|
| G1 | decision | Push notifications moved from **OneSignal to Firebase Cloud Messaging** in March because OneSignal's free tier capped devices | PR #88 body ("…OneSignal free plan caps us at the device limit before fest…"); `#dev` 12 Mar thread | supported (→ verified once Meera confirms) |
| G2 | ownership | Rohan is effectively the only maintainer of the deploy workflow | `deploy.yml` commit stats: 33 commits, rohan 31, neha 2 (generated `commit_stats` chunk) | supported |
| G3 | risk / conflict | Image upload limit unclear: notes say **5 MB**, code enforces **2 MB** | `2026-04-02-fest-prep.md`: "agreed to raise the poster upload limit to 5 MB before the fest"; `src/lib/upload.ts` line 41: `export const MAX_BYTES = 2 * 1024 * 1024;` | conflicting (subject `upload.max_size`) |
| G4 | open_work | PR #142 (RSVP CSV export) is unfinished and blocked on review by Dr. Rao | PR #142 body + comment "waiting on Dr. Rao's review before merge" | supported |
| G5 | contact | Owner of the Firebase project and billing account: **unknown** | `.env.example` has `FIREBASE_PROJECT_ID`, `FIREBASE_SERVER_KEY`, `FIREBASE_BILLING_ALERT_EMAIL`; **no source names an owner** | missing |
| G6 | open_question | Leaderboard feature may be abandoned | Issue #120 "Leaderboard" last comment (41 days before export): "parking this for now, maybe after fest" | inferred if worded "abandoned"; supported if worded "on hold" (both acceptable) |
| G7 | decision (superseded) | Auth moved from **Supabase Auth to Firebase Auth** in Feb (supersedes January's choice) | `#dev` 18 Jan: "let's just go with Supabase auth"; PR #41 "Replace Supabase Auth with Firebase Auth — we're already on Firebase for hosting, one console instead of two" | Jan claim superseded by the Feb claim; **not** a conflict |
| G8 | dependency / risk (**restricted**) | Sponsor TechNova pays ₹40,000 only if the app is live for the fest by 20 Dec; the contract is with Meera | `#core-team` 5 Oct thread | supported; **visible to Meera, Rohan, Kabir; withheld from Neha** |
| G9 | (secret scrubbing) | No claim; a fake key must be redacted | `#dev` 22 Jul: Rohan pastes `FIREBASE_SERVER_KEY=AIzaSyD3m0-FAKE-KEY-n0t-real-000000000` (make it match the `AIza` pattern length); `docs/setup.md` contains `STRIPE_KEY=sk_test_FAKEFAKEFAKEFAKE1234` | scrub report shows 2 redactions; neither string exists anywhere in the DB |
| G10 | recurring_issue | Every fest, image uploads time out on campus Wi-Fi; workaround: compress client-side | Issue #97 reopened 3×; comment "same as last year, compress before upload" | supported |
| G11 | dependency | Images are hosted on Cloudinary's free plan under the club's account | README "Images: Cloudinary (free plan, club account)"; `package.json` `cloudinary` | supported |
| G12 | next_action | Rohan must transfer the Vercel project to Neha before leaving | `2026-10-28-handover-sync.md`: "Rohan to transfer Vercel project ownership to Neha before 15 Nov" | supported |
| G13 | risk | The RSVP flow has no automated tests | PR #142 review comment by Neha: "there are no tests for the RSVP flow at all" | supported |
| G14 | open_work | Issue #131 (duplicate reminder notifications on Android), assigned to Rohan: status unknown | Issue #131 open, assigned rohan; `#dev`: "I'll look at the duplicate notifs later" (doesn't establish status) | missing (checklist item not covered) |
| G15 | (PII masking) | No claim; Rohan's number must be masked for non-reviewers | `#dev`: "call me on +91 90000 00000 if deploy breaks" | masked in Neha's and Rohan's views of the quote |

Also generate realistic **noise**: routine commits, small talk, event-planning chatter and closed PRs, so the extractor
has to find the signal. Include 1–2 harmless decisions not in the golden set (e.g. switching to Tailwind). These are fine to surface.

## 5. `demo/golden_ledger.json` format

```json
{
  "version": 1,
  "claims": [
    {
      "id": "G3",
      "type": "risk",
      "subject_key": "upload.max_size",
      "gist": "Upload limit conflict: notes 5 MB vs code 2 MB",
      "expected_status": ["conflicting"],
      "evidence": [
        {"source": "notes/2026-04-02-fest-prep.md", "contains": "raise the poster upload limit to 5 MB"},
        {"source": "repo:src/lib/upload.ts", "contains": "2 * 1024 * 1024"}
      ],
      "visible_to": ["meera","rohan","neha","kabir"]
    }
  ],
  "secrets": ["AIzaSyD3m0-FAKE-KEY-n0t-real-000000000", "sk_test_FAKEFAKEFAKEFAKE1234"],
  "pii": ["+91 90000 00000"]
}
```

## 6. Judge tour (the README "60-second tour" and the Playwright e2e test follow this)

1. Landing → **Try the demo** → sandbox opens on **Connect**: 4 sources; `#core-team` shows "Core team only"; scrub report "2 secrets removed".
2. **Review** (as Meera): status bar shows counts. Open G1 → evidence from PR #88 + chat → **Confirm** → it turns Verified.
3. **Conflicts** tab → G3 shows both quotes side by side → **Keep as open risk** (or pick 2 MB as current).
4. **Missing** tab → G5 and G14 → **Copy questions for Rohan**.
5. **Timeline** tab → G7 shows the Jan choice as superseded by the Feb PR.
6. **Preview as Neha** → G8 (sponsor) is listed under "Withheld from Neha: cites #core-team (Core team only)".
7. **Approve v1** → switch persona to **Neha** → the handover shows Start here (G12, G4, G14…), owners (G2), decisions (G1, G7),
   risks (G3, G13, G10), dependencies (G11), unresolved (G5, G14, G6). The sponsor claim is nowhere. Phone numbers are masked.
8. Open any source ref → evidence drawer with the highlighted quote.
