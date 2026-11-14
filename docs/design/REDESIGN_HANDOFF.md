# Baton redesign: handoff spec for the coding agent

**Status:** current. It replaces `docs/design/DESIGN_BRIEF.md`, which is outdated. **Ignore DESIGN_BRIEF.md entirely.**
**Scope:** the whole web app in `apps/web`, in light and dark themes.
**Inputs you get:** this file, plus an HTML export (zip) of the design canvas with 4 screens × 2 themes:

| Canvas artboard | Route | Persona shown |
|---|---|---|
| `Connect` / `ConnectDark` | `/w/[id]/sources` | Meera (reviewer, admin) |
| `Reconstruct` / `ReconstructDark` | `/w/[id]/ledger` | Meera |
| `Main` / `MainDark` (Verify) | `/w/[id]/review` | Meera, with a conflict selected |
| `Handover` / `HandoverDark` | `/w/[id]/handover` | Neha (successor) |

---

## 0. How to use the HTML export

- The export is a **visual reference**, not code to paste. It was built in a design tool with its own runtime (`<x-dc>`, `<sc-for>`, `<sc-if>`, `<dc-import>`, `support.js`). Ignore those tags and the script blocks.
- **Do read it for exact values.** The CSS custom properties in each file's `<style>` block (`.bt` and `.bt.dark`) are the design tokens. Inline styles give the spacing, sizes and type. The inline `<svg>` paths are the status icons, so copy them exactly.
- Rebuild everything in the existing stack: Next.js App Router, TypeScript, Tailwind, `lucide-react`. Use the existing components (`components/ui.tsx`, `WorkspaceShell.tsx`, and the rest), restyled.
- Demo text in the mockups (claims, counts, names) is illustrative. Always render real API data.

## 1. The golden rule: presentation changes, behaviour does not

**The old UI is the reference for features. The mockups are the reference for looks.**

1. **Never remove a feature because it isn't in the mockups.** Five screens can't show everything. If the old UI has a button, panel, state, dialog, banner, export, shortcut or flow that the mockups leave out, **keep it and restyle it with this system**. Example: *Getting started* is a restyled `TourChecklist`, not a new feature. It keeps all its logic (server-backed progress, visited pages, switching persona, the hide flag, "Try it on your own repo").
2. Keep every `data-testid`, `aria-*` attribute, `role`, route, URL query parameter, API call, keyboard shortcut and permission check exactly as it is. The Playwright suite (`apps/web/e2e`) must pass unchanged. If a test can't pass because markup moved, move the `data-testid` to the equivalent new element. Never delete a test or weaken an assertion.
3. Never move an access check into the client. Permissions stay enforced on the server. The UI only reflects what the API returns.
4. If the mockups and the old UI disagree about *what* a screen does (not how it looks), the old UI wins. Note the disagreement in `docs/DECISIONS.md`.
5. If you're unsure whether something is a feature or decoration, treat it as a feature.

### Feature inventory that must survive (non-exhaustive)
Persona switcher and its locked "signed in as" variant (`persona-locked`) · Reset demo (with its confirm dialog) · synthetic and read-only labels · theme toggle · Ctrl+K search palette · Knowledge risk, Activity and Team links (reviewer and admin only) · leaver banner · offline banner and API status · toasts · confirm dialogs · the per-step persona restrictions with explanations (`NotForPersona`, locked steps) · the old CoachBar text (now in page descriptions and Getting started, see §7) · Verify: tabs with counts, status and type filters, text search, bulk select with the bulk bar, the keyboard shortcuts j/k/c/r/e/x/? and their help panel, auto-advance to the next unreviewed claim, the questions bar (copy Markdown, GitHub issue, download, start a gap interview, on behalf), the source-changed and stale chips, copy claim link, the edit/confirm/reject/promote/restore actions, the conflict resolution flow, the evidence drawer · Reconstruct: re-run dialog (refresh or full), the timeline filters, relation chips with the detail drawer and reviewer override, pipeline steps, pipeline health link · Connect: change access (`AccessEditor`), Slack import, scrub report, per-source item counts and file list · Review: preview as successor, compare views, withheld list with reasons, rewrite from the successor's sources (`rerender`), approve with warnings and counts, versions · Handover: handover picker (several scoped handovers), versions and the "what changed" changelog, print/PDF, Markdown export, ask the handover, acknowledgements (got it / ask a question / not mine, with question threads), first-week link, all sections, the withheld count · Interview (reviewer and leaver views), Leaving countdown and checklist, First week, Risk, Activity (with CSV export), Team (invites, identity, notifications), Health, Runs progress, New workspace (custom repo plus uploads), Join via invite link, the error, 404 and global-error pages, the OG image and icons.

## 2. Design principles

- It should look like a professional tool (Linear, GitHub, Notion, Loom), not a marketing page. Use neutral greys, one accent colour, hairline borders, almost no shadows, and dense but calm layouts.
- **Show the trust rules, don't explain them.** Rule checks appear as pass/fail rows, evidence as a file view with line numbers and highlights, access as an explicit property.
- Statuses differ by **shape and** colour (see §5.1), never by colour alone.
- A first-time judge must always know where they are (sidebar plus breadcrumb) and what to do next (Getting started plus a "Next:" row at the bottom of each step page).
- **Hard bans:** purple or violet; gradients and gradient text; cream or "paper" backgrounds and paper grain; serif display fonts (`font-display`); cards with a coloured left border; emoji; big drop shadows; pill-shaped primary buttons; glassmorphism; animated sparkles or "AI" icons.

## 3. Tokens

Replace the token set in `apps/web/src/app/globals.css`. Delete `--paper*`, `--amber*`, `--strong`, `--grain`, `--logo-tile` and the `font-display` utility. Map the Tailwind theme to these names.

| Token | Light | Dark | Use |
|---|---|---|---|
| `--bg` | `#FFFFFF` | `#121213` | content background |
| `--bg-side` | `#F7F7F5` | `#0C0C0D` | sidebar |
| `--bg-sunk` | `#FAFAF9` | `#0F0F10` | headers of boxed lists, code, inputs |
| `--hover` | `rgba(20,20,15,.045)` | `rgba(255,255,255,.045)` | row and button hover |
| `--active` | `rgba(20,20,15,.075)` | `rgba(255,255,255,.08)` | selected row, active nav, active tab |
| `--line` | `#E8E8E5` | `#242427` | hairline borders, dividers |
| `--line-2` | `#D8D8D4` | `#323236` | input and button borders, empty rings |
| `--fg` | `#191918` | `#EDEDEB` | primary text |
| `--fg-2` | `#45454A` | `#BEBEB9` | secondary text |
| `--fg-3` | `#6A6A66` | `#8F8F8A` | muted text, labels (passes 4.5:1 on bg and bg-side) |
| `--fg-4` | `#A3A39E` | `#5E5E5A` | **decorative only** (line numbers, separators, disabled). Never body text. |
| `--accent` | `#0B6BDE` | `#1F6FE0` | primary button fill, focus, current step (white text on it passes AA) |
| `--accent-hover` | `#0959BD` | `#3A82EE` | |
| `--accent-soft` | `#EBF3FE` | `rgba(47,128,237,.14)` | "next step" row background |
| `--accent-ink` | `#0A5BC0` | `#6EA8FE` | links, inline actions |
| `--ver` / `--ver-soft` | `#1A7F37` / `#E8F5EB` | `#3FB950` / `rgba(63,185,80,.13)` | verified and supported |
| `--inf` | `#6E7781` | `#8B949E` | inferred |
| `--con` / `--con-soft` | `#BC4C00` / `#FFF1E5` | `#E58A3E` / `rgba(229,138,62,.13)` | conflicting, deadlines, restricted |
| `--mis` / `--mis-soft` | `#CF222E` / `#FFEBE9` | `#F2685E` / `rgba(242,104,94,.13)` | missing, unknown |
| `--hl` / `--hl-line` | `#FFF1B8` / `#E9C552` | `rgba(214,163,40,.26)` / `#A27C1E` | quoted-evidence highlight with a 2px inset bar |
| `--ring` | `rgba(11,107,222,.35)` | `rgba(110,168,254,.4)` | focus outline: 2px, offset 1px |

Avatar colours (deterministic per handle): `#B45309 #0E7490 #4D7C0F #475569 #9F1239 #1D4ED8 #6D4C41 #0F766E`, white initial.

**Theme switching:** keep the existing `ThemeToggle` behaviour (system, light, dark). Apply the dark tokens under `.dark` / `[data-theme=dark]`, whichever the current code uses.

## 4. Type, spacing, radius, motion

- **Fonts:** Inter (UI) with `font-feature-settings: 'cv11','ss01'`, and JetBrains Mono (IDs, file paths, refs, code, dates in timelines). Load both with `next/font/google`. Drop the serif.
- **Scale:** 11.5 mono meta · 12 small and meta · 12.5 chips · **13 base UI (line-height 20)** · 14 section headings in panels · 15 lead paragraph on Handover · 16–18 section titles · 20 inspector title · 24 page title · 32 Handover document title. Weights: 400, 500, 600, plus 650 for page titles. Letter-spacing −0.01 to −0.025em on 18px and up.
- **Spacing:** a 4px grid. Common values are 2, 4, 6, 8, 10, 12, 14, 16, 20, 24, 32 and 40.
- **Radius:** 4 (tags, kbd), 6 (buttons, rows, inputs), 8 (boxed lists, cards, evidence), 10 (large panels). Pills only for status pills and small counters.
- **Heights:** button 28 · top bar 48 · nav item 28 · list row two lines with 8px vertical padding · property row 28–30.
- **Shadows:** none on cards. Popovers, menus and dialogs only: `0 1px 2px rgba(0,0,0,.05), 0 4px 12px rgba(0,0,0,.04)` (dark: `0 6px 16px rgba(0,0,0,.4)`).
- **Motion:** 120–160ms ease-out for hover, popovers and drawers. Respect `prefers-reduced-motion`. No staggered entrance animations and no "lift" on hover.

## 5. Components

### 5.1 Status icon set (custom SVG components; copy the paths from the export)
| Status | Shape | Colour |
|---|---|---|
| Verified | solid circle with a white check | `--ver` |
| Supported | ring (1.5px) with a filled centre dot | `--ver` |
| Inferred | dashed ring (`stroke-dasharray 2.2 1.8`) | `--inf` |
| Conflicting | solid rounded triangle with a white "!" | `--con` |
| Missing | dashed ring with a "?" | `--mis` |
| Reviewer-confirmed (no source evidence) | the Supported icon plus the text label "Reviewer-confirmed, no source evidence". Never shown as plain fact. | |

Sizes: 12 (meta), 14 (rows), 16 (Handover risks and unknowns). **Status pill:** 22px tall, `--x-soft` background, `--x` text, icon plus label, 600 weight, 12px. Use pills only in the inspector header. Elsewhere use icon plus text. Keep `StatusChip` as the component name and API, and change only its rendering.

### 5.2 App shell (`WorkspaceShell`)
- **Sidebar** (236px, `--bg-side`, right hairline). From top to bottom:
  1. Workspace switcher: a 20px monogram tile in `--fg` on `--bg`, the name, and an up/down chevron. If there's no switcher behaviour yet, it's static, but keep the element.
  2. A search button that looks like an input, with `Ctrl` `K` kbd. It opens the existing `SearchPalette` and keeps `search-open`.
  3. Section label "Handover" with a leaver → successor mini avatar pair (and the `HandoverPicker` when there are several handovers).
  4. **The five workflow steps as nav items:** Connect, Reconstruct, Verify, Review & approve, Handover. Each has a step-state icon (done = solid `--fg-3` circle with a check; current = `--accent` ring with a half fill; in progress = ring with a partial arc; todo = empty `--fg-4` ring; locked = lock icon with `--fg-4` text and the old tooltip explaining why) and a right-aligned live count ("4 sources", "68", "27 left", "Draft", "5 / 52"). Keep `step-*` test ids and `aria-current`.
  5. For the successor: sub-items under Handover for "Your first week" and "Your questions" (with an accent count badge) when those features apply.
  6. Section label "Workspace": Knowledge risk, Activity, Team & access, under the same role rules as today (keep `risk-link`, `activity-link`, `team-link`).
  7. **Getting started** (see §7).
  8. A spacer, then the synthetic demo notice (dashed border box: "Synthetic demo data · A fictional student-club project. Your copy is private. · Reset demo"). Show the read-only notice here as well when it applies.
  9. Footer: the person switcher (24px avatar, name, "Viewing as · Role") opening the existing persona menu as a popover. Keep its explanatory line ("Switch person to see exactly what each person is allowed to see. The server enforces it."). The locked variant says "Signed in as". The theme toggle is an icon button.
- **Top bar** (48px, bottom hairline): breadcrumb "Leaver → Successor / Page" (current page in `--fg` 500) plus any version selector, then the page actions on the right (at most one primary button).
- **Content:** pages with a split view (Verify) fill the height, and both panes scroll on their own. Document-like pages use a centred column (max 1120–1160px, padding 32px 40px). The Handover uses a 760px document column plus a 232px right rail.
- **Phone width:** the sidebar becomes a top drawer (a hamburger in the top bar), split panes stack, tables scroll inside their box, toolbars wrap, and there's no horizontal page scroll.

### 5.3 Primitives (`components/ui.tsx`)
- **Button:** `primary` (accent fill, white), `secondary` (bg with a `--line-2` border), `ghost` (transparent, `--fg-2`), `danger` (secondary style with `--mis` text; fill only inside a confirm dialog), `success` (secondary with a `--ver` icon). 28px tall, radius 6, weight 500, 13px, 14px icons with stroke 1.5. Loading state: a spinner replaces the icon. Keep the API (`variant`, `size`, `loading`).
- **Icon button:** 28×28, `--fg-3`, hover fill. Always has an `aria-label`.
- **Kbd:** 17px tall, a 1px border plus a 1.5px bottom border, 10.5px text.
- **Tabs:** text tabs 26px tall. The active one gets the `--active` fill and `--fg`. Counts in `--fg-3`, or in the status colour for Conflicts and Missing. Keep `role=tab`.
- **Chips / filters:** 26px, radius 6, hairline border, label plus a bold count.
- **Property list (Notion style):** a two-column `dl` with a 120–128px label column, 28–30px rows, an icon plus label in `--fg-3`, and the value in `--fg`.
- **Boxed list:** 1px `--line` border, radius 8, rows divided by hairlines, row hover `--hover`, and an optional `--bg-sunk` header and footer ("Show N more").
- **Row (claim list):** a status icon, then line 1 (claim text, one line with ellipsis) and line 2 (`ID · Type · ref`, mono for the ID and ref), and a right-side review state. Selected = `--active` background. **No left-border accent.**
- **Rule checks block** (GitHub checks style): header "Why it's <Status>" plus "Decided by fixed rules, not by the AI", then one row per rule: pass (solid green check), fail or flag (status icon on a `--x-soft` row), pending (dashed ring). The right side shows the mono measurement ("match 100 · needs ≥ 90", "supports", "5 MB ≠ 2 MB"). Build it from the claim's evidence and review data the API already returns (`status_reason`, `match_score`, `verdict`, conflict info). Don't invent rules the backend doesn't apply.
- **Evidence file card:** a header (file or channel icon, mono path, a right-side tag such as "says 5 MB"), a mono body at 11.5/19 with a line-number gutter (34px, `--fg-4`), the matched lines in `--hl` with a 2px `--hl-line` inset bar, and a footer (source type, date or author, access). Two cards sit side by side for conflicts and stack at narrow widths. Keep `evidence-card`, `evidence-highlight` and `source-ref`.
- **Radio cards:** bordered options. Selected = accent border plus a 1px accent ring and a filled radio.
- **Inputs and textarea:** 28–32px, radius 6, `--line-2` border, focus ring.
- **Stat strip:** one bordered box, a proportional 8px stacked bar on top, five equal columns divided by hairlines (icon plus label, 26px number, 12px help text). Each column links to the filtered Verify view. Keep `status-counts`.
- **Timeline:** a mono date column (92px, right-aligned), a 1px rail with 9px ring dots (status-coloured for conflicts, muted for superseded), and the content. A relation annotation is an inline box with an uppercase tag (CHANGED DECISION / PROBABLY DONE / CONTRADICTION), an explanation, "by rule" or "by Meera", and an action ("Change", "Why?", "Resolve in Verify"). A superseded item gets a line-through and `--fg-3`. Keep `relation-chip`, `relation-detail` and `stale-chip`.
- **Notice / alert:** a bordered box on `--bg-sunk`, with a 16–18px icon in the semantic colour and text in `--fg`/`--fg-3`. No full-colour backgrounds except the `-soft` tint for warnings.
- **Dialogs and drawers** (`Confirm`, `Modal`, `Drawer`): `--bg`, radius 10, popover shadow, 14px title in 600. The drawer slides from the right at 480–560px.
- **Toast:** bottom-left, dark (`--fg` background, `--bg` text) in both themes, radius 8.
- **Empty / loading / error states:** a 16px icon in a 32px rounded square with a hairline border, a 13px 600 title, a 12.5px `--fg-3` line, and an optional button. Skeletons are `--hover` blocks with a subtle shimmer.
- **Avatars:** circles at 16/18/20/22/24px with initials. Stacked avatars overlap by −5px with a 2px `--bg` ring.

## 6. Screen notes

**Connect** (`sources`): a page title and description; a secrets notice (the scrub report summed across sources, by type and location); the sources table (Source · Contents · Visible to · Secrets · menu). A restricted source shows a `--con` lock pill "N people" plus stacked avatars, and expands inline into the access editor (checkboxes, reviewer always included, "What this changes" explanation, Save/Cancel). That's the restyled `AccessEditor`, admin only. Then "Add a source" tiles (GitHub repo, notes and documents, chat export, Slack live) wired to the existing flows; Slack import keeps its own dialog. End with a "Next: Reconstruct" row. Non-reviewers see only their sources with the old description.

**Reconstruct** (`ledger`): title and description; meta (last run, number of sources, "computed in advance" note for the demo); the stat strip; "By type" chips; then a two-column layout: the decision timeline (filters plus timeline) and a right rail with "How this ledger was built" (pipeline steps as GitHub Actions-style check rows from `runs/latest`, plus the Pipeline health link) and a "Next: inspect the evidence" box. Top bar: Knowledge risk (ghost), Re-run (secondary, opens the existing dialog restyled as radio cards), Inspect the evidence (primary).

**Verify** (`review`): the top bar holds the breadcrumb, a review progress mini bar ("41 / 68 reviewed"), Select (bulk), a `?` shortcuts button and the primary "Preview <successor>'s view". The left pane has tabs, then a filter row (search with a `/` hint, Type filter, "Group: Status"), then rows **grouped by status** with sticky group headers (Conflicting, Missing with an "Ask <leaver>" action, Supported with "N confirmed", Inferred with "Hidden from <successor>"). The right pane is the inspector: a header (ID, position "2 of 68", prev/next, copy link, more), status pill plus type, the 20px claim text, a one-line plain explanation, the property list (Subject, Conflicts with, Stated, Visible to, Review), the rule checks block, Evidence cards, Resolve (radio cards plus a "Note for <successor>" field) **for conflicts only**, and a sticky action bar (primary action with a kbd hint, Edit E, Reject R; Confirm C and Promote for other statuses; "Next unreviewed opens automatically"). The bulk bar appears above the list when items are picked. The questions bar sits under the tabs on the Missing and Conflicts tabs.

**Handover** (`handover`): breadcrumb plus a version selector ("v1 · approved"), Print, Export ▾ (Markdown and the others). The document column has an approval line, a 32px title, a lead paragraph, a property list (Leaving + last-day pill, Taking over, Reviewed by, Not shown = withheld count **without naming the restricted source**), the Ask box (input, suggestions, "Answers cite approved items only"), then the sections: Start here (an ack circle per item, text, meta with status, ref link and question thread, hover actions "Ask a question" / "Not mine", due pill, owner avatar), Who owns what (table), Key decisions (timeline style, changed decisions struck through), Risks and conflicts (resolved conflicts show the reviewer's note), Dependencies and contacts, and **Still unknown** (a dashed box with Missing icons and "Asked <leaver>" status). The right rail has progress (got it / questions waiting), the "On this page" outline, a "<Leaver> leaves tomorrow → Ask <leaver>" card (from the leaving date), and the sources you can see. Keep the "what changed since vN" changelog as a collapsible block under the properties when it applies.

**Screens not in the mockups** (restyle them with the same system, keep all behaviour):
Review & approve preview (`review/preview`) uses the Handover document layout plus a reviewer toolbar (Compare views, approve with warnings and counts, the withheld list with reasons and Rewrite buttons). Runs progress uses the pipeline check rows, live. Team, Activity and Risk use boxed lists and tables with property lists. Leaving and First week use Handover-style document lists. Interview is a question list plus answer fields, styled like the inspector. Health uses the stat strip and tables. Landing (`/`): a white or near-black hero, 40–48px Inter 650 headline, the product screenshot (the Verify screen) framed with a hairline border, no illustration, primary "Try the demo" plus secondary "Start with a public GitHub repo", then a "How it works" five-step row and the trust table. New workspace (`/new`) and Join: centred 480px forms. Error, 404 and global error: the empty-state pattern. OG image and icons: the monogram tile on `--fg`.

## 7. Getting started (replaces the floating tour and CoachBars)

- This is the restyled `TourChecklist`, **docked in the sidebar** (above the demo notice) instead of floating bottom-right. **Keep every bit of its logic:** the same six steps and labels (shortened as in the mockup is fine), server progress from `/tour`, the localStorage visited and hidden keys, the step `go` handlers including persona switching, the "seen the whole loop → try your own repo" end state, `data-testid="tour"` and `tour-open`, and synthetic workspaces only, not read-only.
- **Look:** a bordered box with the title "Getting started", "N of 6", a hide ×, a 6-segment progress bar (done `--ver`, next `--accent`, todo `--line-2`), and step rows (done = muted check and muted text; next = accent ring on an `--accent-soft` row with a "Go" link; todo = empty ring).
- When it's hidden, the sidebar shows a small "Getting started" link to bring it back.
- **CoachBar text is not lost.** Each step page's one-paragraph explanation becomes the page description under the title (see the Connect and Reconstruct mockups), and the "what next" moves into the "Next: …" row at the bottom of each step page.

## 8. Copy and voice

Plain and short. Use real names from the data ("Preview Neha's view", "Ask Rohan"). Sentence case everywhere, with no uppercase eyebrows except the timeline relation tags. Say what the rule did ("Quote found word for word in its cited source") rather than "AI-powered". Keep the existing explanatory strings unless they're clearly redundant.

## 9. Implementation order (commit after each step, run e2e)

1. Tokens and fonts in `globals.css` and the Tailwind config, theme toggle wiring. Delete the old tokens and utilities (`paper-grain`, `font-display`, `lift`, `stagger`).
2. Primitives in `ui.tsx` plus `StatusChip` and the new status icon components.
3. `WorkspaceShell`: sidebar, top bar, person switcher popover, search button, Getting started (moved `TourChecklist`), mobile drawer.
4. Verify → Handover → Reconstruct → Connect, comparing against the export at 1440px in both themes.
5. Every other screen in §6, then the landing page.
6. `pnpm exec playwright test` (all specs including `a11y.spec.ts`: 0 serious axe violations, contrast AA), `pnpm lint`, typecheck. Refresh the README screenshots (`e2e/screenshots.spec.ts`).
7. Log the redesign and any behaviour-preserving deviations in `docs/DECISIONS.md`.

**Definition of done:** every old feature still works (§1 inventory), all e2e tests pass unmodified (or have only had `data-testid`s moved), both themes match the export, phone width has no horizontal scroll, and none of the banned patterns from §2 appear anywhere.
