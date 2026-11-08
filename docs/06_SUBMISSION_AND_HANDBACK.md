# 06 — Round 2 Submission and Handback

## 1. What must be submitted, and who produces it

| Deliverable (organiser's list + problem statement) | Produced by | Source material |
|---|---|---|
| Working project link | Claude Code (deploy) | — |
| Source-code repository link (public) | Claude Code (push) + Arch (make public, check access in incognito) | — |
| Updated project PDF (architecture, data flow, key technical decisions) | **Other assistant (claude.ai chat)** | `HANDBACK.md`, `docs/DECISIONS.md`, `docs/TESTING.md`, screenshots, Round 1 PDF source |
| List of completed features | Other assistant, from `HANDBACK.md §3` | — |
| Technology and implementation details, incl. **APIs, AI models, datasets, libraries, templates, external services** | Other assistant, from `HANDBACK.md §5` | — |
| Explanation of changes made to the original plan | Other assistant, from `docs/DECISIONS.md` | — |
| Evidence of testing or structured feedback | Claude Code (tests + eval) + Arch (3–5 user sessions) → other assistant writes it up | `docs/TESTING.md`, feedback notes |
| Three major improvements for Round 3 | Already fixed (see CLAUDE.md §9); the other assistant writes them up | — |
| Personal contribution answer (form) | **Arch, in his own words** (rule 14) | — |

## 2. `HANDBACK.md` (Claude Code writes this at the repo root at M6; keep it truthful)

```markdown
# HANDBACK — Baton Round 2

## 1. Links
- Live app: <url>   (demo path: Try the demo)
- Repo: <url>       (public: yes/no)
- API health: <url>/api/health

## 2. Final judge tour
(the exact click path that works on production, with any differences from docs/04 §6)

## 3. Feature status
| Feature (Round 1 plan name) | Status: done / partial / cut / deferred-R3 | Notes (what works, limits) |
(one row per feature from the Round 1 PDF §07 table, plus anything new)

## 4. Planted scenario results (production run)
| G-id | Produced? | Status shown | Correct? | Note |

## 5. Stack, services and disclosures (with versions and licences)
- Frameworks/libraries: name — version — licence
- AI models used (provider, exact model id, purpose: extraction / verification / coverage)
- External services: hosting, DB, APIs (GitHub REST)
- Datasets: synthetic demo dataset (written for this project); any public repo used in testing
- Templates/scaffolding/generators used (e.g. create-next-app, shadcn/ui)
- AI coding assistance: Claude Code (Anthropic) wrote most of the code under Arch's direction

## 6. Architecture as built
(short description + any differences from docs/02; a Mermaid diagram if possible)

## 7. Testing
- Unit tests: count, pass/fail, which modules
- Eval: claim recall, status accuracy, citation precision, permission leaks, secret leaks: 3 runs, ranges, models, date
- E2E: Playwright judge flow against production, pass/fail, date
- Known failures

## 8. Changes from the Round 1 plan
(summary; the full list is in docs/DECISIONS.md)

## 9. Known issues and limitations (honest)

## 10. Round 3 readiness
(for each of the 3 improvements: which seams exist, rough effort estimate)

## 11. Commit-history facts
(first commit timestamp, number of commits, confirmation that no pre-window code was imported)
```

## 3. Structured feedback (Arch, Wednesday morning)

Run 3–5 short sessions (10 min each, by video call or in person) with club members or classmates. Give them only the live
link and the task "You're Neha, taking over this project — find out what to do first and what's risky." Don't help them.
Record: where they got stuck, time to reach the handover, whether they noticed the withheld or unresolved items, and one quote.
Give the notes to the other assistant to turn into the "testing and feedback" section.
