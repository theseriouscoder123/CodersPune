"""Generate the synthetic "Campus Events App" demo dataset (docs/04_DEMO_DATA.md).

Everything here is FICTIONAL and SYNTHETIC, written for the CodersInPune hackathon.

    python demo/build_demo.py        # rewrites demo/github_fixture, demo/notes, demo/chat, demo/golden_ledger.json

Output shapes mirror the GitHub REST API (repo, commits with files[], pulls, pull review comments, issues, issue
comments, and contents with base64 bodies) so ingest/fixtures.py can reuse the live GitHub normaliser.

Planted fake secrets (scenario G9) are assembled from pieces here and JSON-escaped in the output files, so GitHub's
secret scanning doesn't block pushes. The ingestion scrubber still sees the real strings after json.load / base64 decode.
"""

from __future__ import annotations

import base64
import hashlib
import json
import random
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent
ORG, REPO = "devclub", "campus-events-app"
REPO_URL = f"https://github.com/{ORG}/{REPO}"
EXPORT_DATE = "2026-11-05T12:00:00Z"  # pinned "now" for the demo; relative wording (e.g. "41 days") uses it

FAKE_FIREBASE_KEY = "AI" + "za" + "SyD3m0-FAKE-KEY-n0t-real-0000000000"  # matches AIza[0-9A-Za-z_-]{35}
FAKE_STRIPE_KEY = "sk_" + "test_" + "FAKEFAKEFAKEFAKE1234"
FAKE_PHONE = "+91 90000 00000"

USERS = {
    "meera": {"id": 9001, "name": "Meera Kulkarni"},
    "rohan": {"id": 9002, "name": "Rohan Deshpande"},
    "neha": {"id": 9003, "name": "Neha Joshi"},
    "kabir": {"id": 9004, "name": "Kabir Shah"},
    "arjun": {"id": 9005, "name": "Arjun Patil"},
    "sana": {"id": 9006, "name": "Sana Shaikh"},
}
SLACK_IDS = {h: f"U0{h.upper()}" for h in USERS}

rng = random.Random(20261105)


def ts(s: str) -> str:
    """'2026-03-12 14:05' (IST) -> ISO UTC string."""
    dt = datetime.strptime(s, "%Y-%m-%d %H:%M").replace(tzinfo=timezone(timedelta(hours=5, minutes=30)))
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def sha(*parts: str) -> str:
    return hashlib.sha1("|".join(parts).encode()).hexdigest()


def gh_user(h: str) -> dict:
    return {"login": h, "id": USERS[h]["id"], "type": "User", "html_url": f"https://github.com/{h}"}


# ----------------------------------------------------------------------------------------------------------------
# Repository files (contents API)
# ----------------------------------------------------------------------------------------------------------------

UPLOAD_TS_LINES = [
    "// Poster and banner uploads for event pages.",
    "// Images go to Cloudinary (see README). Keep this file small; UI lives in components/upload/.",
    "",
    'import { v2 as cloudinary } from "cloudinary";',
    "",
    "cloudinary.config({",
    "  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,",
    "  api_key: process.env.CLOUDINARY_API_KEY,",
    "  api_secret: process.env.CLOUDINARY_API_SECRET,",
    "});",
    "",
    "export type UploadResult = { url: string; width: number; height: number; bytes: number };",
    "",
    'export const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];',
    "",
    "export class UploadError extends Error {",
    "  constructor(message: string, public readonly code: \"too_large\" | \"bad_type\" | \"failed\") {",
    "    super(message);",
    "  }",
    "}",
    "",
    "function assertType(mime: string) {",
    "  if (!ALLOWED_TYPES.includes(mime)) {",
    '    throw new UploadError(`Unsupported file type: ${mime}`, "bad_type");',
    "  }",
    "}",
    "",
    "function humanSize(bytes: number) {",
    "  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;",
    "}",
    "",
    "// Folder per event so the club account stays tidy.",
    "function folderFor(eventId: string) {",
    "  return `campus-events/${eventId}`;",
    "}",
    "",
    "// NOTE: campus Wi-Fi is slow during fest; the client compresses before calling this.",
    "// See issue #97.",
    "",
    "// Max poster size accepted by the API route.",
    "export const MAX_BYTES = 2 * 1024 * 1024;",  # line 41 (G3)
    "",
    "export async function uploadPoster(eventId: string, file: File): Promise<UploadResult> {",
    "  assertType(file.type);",
    "  if (file.size > MAX_BYTES) {",
    '    throw new UploadError(`Poster is ${humanSize(file.size)}; the limit is ${humanSize(MAX_BYTES)}`, "too_large");',
    "  }",
    "  const buffer = Buffer.from(await file.arrayBuffer());",
    "  const res = await new Promise<any>((resolve, reject) => {",
    "    cloudinary.uploader",
    "      .upload_stream({ folder: folderFor(eventId), resource_type: \"image\" }, (err, out) =>",
    "        err ? reject(err) : resolve(out),",
    "      )",
    "      .end(buffer);",
    "  });",
    "  return { url: res.secure_url, width: res.width, height: res.height, bytes: res.bytes };",
    "}",
    "",
]
assert UPLOAD_TS_LINES[40] == "export const MAX_BYTES = 2 * 1024 * 1024;", "G3 requires line 41"

FILES: dict[str, str] = {
    "README.md": """# Campus Events App

DevClub's web app for event listings, RSVPs and push reminders during the fest.

## Stack

- Next.js (App Router) + Tailwind
- Firebase: Firestore (data), Firebase Auth (sign-in), Firebase Cloud Messaging (push reminders)
- Images: Cloudinary (free plan, club account)
- Hosting: Vercel (auto-deploys `main` through the GitHub Actions deploy workflow)

## Getting started

See `docs/setup.md`. Ask in #dev if something is unclear.

## Contributing

- Branch from `main`, open a PR, get one review.
- Don't push directly to `main` during fest week.
- Keep PRs small; screenshots for UI changes please.

## Team

Maintained by DevClub's app team. Current lead: Rohan (until Nov 2026).
""",
    "docs/setup.md": f"""# Local setup

1. `npm install`
2. Copy `.env.example` to `.env.local` and fill in the Firebase and Cloudinary values (ask in #dev).
3. `npm run dev` and open http://localhost:3000

## Payments sandbox (old, unused)

We tried Stripe for paid workshop tickets in January and dropped it. Old test config, kept for reference:

```
STRIPE_KEY={FAKE_STRIPE_KEY}
```

## Seeding events

`npm run seed` loads three sample events into the Firestore emulator.

## Deploys

Merging to `main` triggers `.github/workflows/deploy.yml`, which builds and deploys to Vercel.
If the deploy fails, check the Actions tab first.
""",
    ".env.example": """# Firebase (project + push)
FIREBASE_PROJECT_ID=
FIREBASE_SERVER_KEY=
FIREBASE_BILLING_ALERT_EMAIL=
NEXT_PUBLIC_FIREBASE_API_KEY=
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=

# Cloudinary (poster uploads)
CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=
""",
    ".github/workflows/deploy.yml": """name: deploy

on:
  push:
    branches: [main]
  workflow_dispatch:

jobs:
  deploy:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npm run lint
      - run: npm run build
        env:
          NEXT_PUBLIC_FIREBASE_API_KEY: ${{ secrets.NEXT_PUBLIC_FIREBASE_API_KEY }}
          NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: ${{ secrets.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN }}
      - name: Deploy to Vercel
        run: npx vercel deploy --prod --token ${{ secrets.VERCEL_TOKEN }}
        env:
          VERCEL_ORG_ID: ${{ secrets.VERCEL_ORG_ID }}
          VERCEL_PROJECT_ID: ${{ secrets.VERCEL_PROJECT_ID }}
""",
    "src/lib/upload.ts": "\n".join(UPLOAD_TS_LINES),
    "src/lib/notifications.ts": """// Push reminders via Firebase Cloud Messaging (moved from OneSignal in March, PR #88).
import { getMessaging } from "firebase-admin/messaging";

export async function sendReminder(tokens: string[], title: string, body: string) {
  if (tokens.length === 0) return { sent: 0 };
  const res = await getMessaging().sendEachForMulticast({ tokens, notification: { title, body } });
  return { sent: res.successCount, failed: res.failureCount };
}
""",
    "package.json": json.dumps(
        {
            "name": "campus-events-app",
            "private": True,
            "scripts": {"dev": "next dev", "build": "next build", "lint": "next lint", "seed": "node scripts/seed.mjs"},
            "dependencies": {
                "next": "15.1.0",
                "react": "19.0.0",
                "react-dom": "19.0.0",
                "firebase": "11.1.0",
                "firebase-admin": "13.0.2",
                "cloudinary": "2.5.1",
                "browser-image-compression": "2.0.2",
                "papaparse": "5.4.1",
            },
            "devDependencies": {"tailwindcss": "3.4.17", "eslint": "9.17.0", "typescript": "5.7.2"},
        },
        indent=2,
    )
    + "\n",
}


def contents_json() -> list[dict]:
    out = []
    for path, body in FILES.items():
        raw = body.encode()
        out.append(
            {
                "type": "file",
                "path": path,
                "name": path.rsplit("/", 1)[-1],
                "size": len(raw),
                "sha": sha("blob", path, body),
                "encoding": "base64",
                "content": base64.b64encode(raw).decode(),
                "html_url": f"{REPO_URL}/blob/main/{path}",
            }
        )
    return out


# ----------------------------------------------------------------------------------------------------------------
# Commits
# ----------------------------------------------------------------------------------------------------------------

DEPLOY = ".github/workflows/deploy.yml"


def build_commits() -> list[dict]:
    raw: list[tuple[str, str, str, list[str]]] = []  # (when, author, message, files)

    # 33 commits touching deploy.yml: rohan 31, neha 2 (scenario G2)
    deploy_msgs = [
        "ci: add deploy workflow for Vercel", "ci: cache npm in deploy", "ci: fix node version", "ci: run lint before build",
        "ci: pass firebase env to build", "ci: retry vercel deploy once", "ci: bump checkout action",
        "ci: deploy only from main", "ci: add workflow_dispatch", "ci: fix missing VERCEL_ORG_ID",
        "ci: timeout after 15 min", "ci: print build size", "ci: fix secrets name typo", "ci: skip deploy on docs-only changes",
        "ci: revert docs-only skip, it broke tags", "ci: pin vercel cli", "ci: unpin vercel cli again", "ci: use npm ci",
        "ci: fest week freeze note", "ci: fix lint step exit code", "ci: add build env for auth domain",
        "ci: move to node 20", "ci: drop old onesignal env", "ci: add fcm env", "ci: clean up job names",
        "ci: fix deploy after vercel token rotation", "ci: make deploy job required", "ci: remove debug echo",
        "ci: cache .next/cache", "ci: revert .next cache, stale builds", "ci: tidy workflow",
    ]
    start = datetime(2026, 1, 20, 18, 0)
    for i, msg in enumerate(deploy_msgs):
        when = start + timedelta(days=int(i * 9.0) + rng.randint(0, 3), hours=rng.randint(0, 5))
        raw.append((when.strftime("%Y-%m-%d %H:%M"), "rohan", msg, [DEPLOY]))
    raw.append(("2026-06-14 21:10", "neha", "ci: fix typo in deploy step name", [DEPLOY]))
    raw.append(("2026-09-02 19:40", "neha", "ci: add lint to deploy workflow comment", [DEPLOY]))

    other = [
        ("2026-01-12 20:00", "rohan", "init: next.js app with tailwind", ["package.json", "README.md"]),
        ("2026-01-13 21:30", "rohan", "feat: event list page", ["src/app/page.tsx"]),
        ("2026-01-16 19:00", "arjun", "feat: event detail page", ["src/app/events/[id]/page.tsx"]),
        ("2026-01-19 22:15", "rohan", "feat: supabase auth sign-in", ["src/lib/auth.ts", "package.json"]),
        ("2026-01-28 18:40", "sana", "style: poster card layout", ["src/components/PosterCard.tsx"]),
        ("2026-02-09 20:20", "rohan", "refactor: replace supabase auth with firebase auth (#41)", ["src/lib/auth.ts", "package.json"]),
        ("2026-02-11 17:05", "arjun", "feat: RSVP button", ["src/components/RsvpButton.tsx"]),
        ("2026-02-20 21:00", "rohan", "feat: poster uploads to cloudinary", ["src/lib/upload.ts", "package.json"]),
        ("2026-02-24 19:30", "neha", "docs: setup guide", ["docs/setup.md"]),
        ("2026-03-03 20:45", "rohan", "feat: onesignal push reminders", ["src/lib/notifications.ts"]),
        ("2026-03-14 22:10", "rohan", "feat: move push reminders to FCM (#88)", ["src/lib/notifications.ts", "package.json"]),
        ("2026-03-21 18:00", "arjun", "fix: RSVP double click", ["src/components/RsvpButton.tsx"]),
        ("2026-03-29 20:30", "rohan", "feat: compress posters client-side before upload (#97)", ["src/components/upload/PosterInput.tsx", "package.json"]),
        ("2026-04-06 19:15", "sana", "style: fest theme colours", ["src/app/globals.css"]),
        ("2026-04-10 23:50", "rohan", "fix: upload timeout message", ["src/lib/upload.ts"]),
        ("2026-05-18 18:20", "neha", "feat: event categories filter", ["src/app/page.tsx"]),
        ("2026-06-30 20:00", "arjun", "chore: bump next", ["package.json"]),
        ("2026-07-22 21:40", "rohan", "chore: rotate firebase server key", [".env.example"]),
        ("2026-08-12 19:10", "rohan", "feat: leaderboard skeleton (#120)", ["src/app/leaderboard/page.tsx"]),
        ("2026-09-08 20:35", "neha", "fix: timezone on event cards", ["src/components/PosterCard.tsx"]),
        ("2026-09-19 18:55", "rohan", "feat: rsvp csv export wip (#142)", ["src/app/api/rsvps/export/route.ts", "package.json"]),
        ("2026-10-03 21:25", "arjun", "fix: android reminder sound", ["src/lib/notifications.ts"]),
        ("2026-10-21 19:45", "rohan", "docs: readme stack section", ["README.md"]),
        ("2026-10-30 22:30", "neha", "chore: lint fixes", ["src/app/page.tsx", "src/components/RsvpButton.tsx"]),
    ]
    raw.extend(other)
    raw.sort(key=lambda r: r[0])

    commits = []
    for when, author, msg, files in raw:
        s = sha("commit", when, author, msg)
        commits.append(
            {
                "sha": s,
                "html_url": f"{REPO_URL}/commit/{s}",
                "author": gh_user(author),
                "commit": {
                    "message": msg,
                    "author": {"name": USERS[author]["name"], "email": f"{author}@users.noreply.example", "date": ts(when)},
                },
                "files": [
                    {"filename": f, "status": "modified", "additions": rng.randint(1, 40), "deletions": rng.randint(0, 15)}
                    for f in files
                ],
            }
        )
    commits.reverse()  # GitHub returns newest first
    return commits


# ----------------------------------------------------------------------------------------------------------------
# Pull requests, issues and their comments
# ----------------------------------------------------------------------------------------------------------------

def pr(number, title, author, created, body, state="closed", merged=None, labels=(), requested=()):
    return {
        "number": number,
        "html_url": f"{REPO_URL}/pull/{number}",
        "title": title,
        "user": gh_user(author),
        "state": state,
        "body": body,
        "created_at": ts(created),
        "updated_at": ts(merged or created),
        "closed_at": ts(merged) if merged else None,
        "merged_at": ts(merged) if merged else None,
        "labels": [{"name": label} for label in labels],
        "requested_reviewers": [{"login": r} for r in requested],
        "base": {"ref": "main"},
    }


PULLS = [
    pr(12, "Event list page", "rohan", "2026-01-13 21:00", "First version of the event list. Static data for now.", merged="2026-01-14 10:00"),
    pr(23, "Supabase auth sign-in", "rohan", "2026-01-19 22:00",
       "Adds email sign-in with Supabase auth, as discussed in #dev. Keeps things simple for the first release.",
       merged="2026-01-20 09:30"),
    pr(34, "Switch styling to Tailwind", "sana", "2026-01-27 18:00",
       "Moving from CSS modules to Tailwind so poster cards and the fest theme are quicker to iterate on. Agreed in Saturday's call.",
       merged="2026-01-29 11:00"),
    pr(41, "Replace Supabase Auth with Firebase Auth", "rohan", "2026-02-08 19:00",
       "Replace Supabase Auth with Firebase Auth — we're already using Firebase for Firestore, one console instead of two. "
       "This reverses the January choice to use Supabase auth. Existing test accounts need to sign up again.",
       merged="2026-02-09 20:20"),
    pr(55, "RSVP button", "arjun", "2026-02-10 17:00", "RSVP toggle on the event page. Stores attendees in Firestore.", merged="2026-02-11 17:05"),
    pr(63, "Poster uploads", "rohan", "2026-02-19 20:00",
       "Organisers can upload a poster per event. Files go to Cloudinary under the club account (free plan).",
       merged="2026-02-20 21:00"),
    pr(88, "Move push reminders from OneSignal to FCM", "rohan", "2026-03-12 21:00",
       "Switching push reminders to Firebase Cloud Messaging. The OneSignal free plan caps us at the device limit before fest, "
       "and we'd blow past it on day one. FCM is free and we already have Firebase. Removes the OneSignal SDK.",
       merged="2026-03-14 22:10", labels=("notifications",)),
    pr(95, "Compress posters client-side", "rohan", "2026-03-28 19:00",
       "Workaround for #97: compress images in the browser (browser-image-compression) before upload, because uploads "
       "time out on campus Wi-Fi during fest.", merged="2026-03-29 20:30"),
    pr(110, "Event categories filter", "neha", "2026-05-17 18:00", "Filter chips for tech / cultural / sports.", merged="2026-05-18 18:20"),
    pr(126, "Leaderboard skeleton", "rohan", "2026-08-11 19:00", "Empty leaderboard page behind a flag. See #120.", merged="2026-08-12 19:10"),
    pr(138, "Fix timezone on event cards", "neha", "2026-09-07 20:00", "Cards showed UTC times. Now uses Asia/Kolkata.", merged="2026-09-08 20:35"),
    pr(142, "RSVP CSV export for organisers", "rohan", "2026-09-19 18:30",
       "Adds an organiser-only CSV export of RSVPs (name, roll number, timestamp) using papaparse. Still WIP: needs the "
       "faculty coordinator's sign-off because it exports student data. Requested review from Dr. Rao via Meera.",
       state="open", labels=("wip", "needs-review"), requested=("meera",)),
    pr(147, "Lint fixes", "neha", "2026-10-30 22:00", "No functional changes.", merged="2026-10-30 22:30"),
]

PULL_COMMENTS = [  # review comments (have path/line)
    {"id": 50101, "pull": 142, "user": "neha", "created_at": ts("2026-09-24 21:10"), "path": "src/app/api/rsvps/export/route.ts",
     "line": 12, "body": "Looks fine, but there are no tests for the RSVP flow at all. If this exports real data we should add some before fest."},
    {"id": 50102, "pull": 88, "user": "arjun", "created_at": ts("2026-03-13 10:20"), "path": "src/lib/notifications.ts",
     "line": 4, "body": "Do we need to migrate existing OneSignal subscribers or just ask people to re-allow notifications?"},
    {"id": 50103, "pull": 88, "user": "rohan", "created_at": ts("2026-03-13 11:05"), "path": "src/lib/notifications.ts",
     "line": 4, "body": "Re-allow is fine, it's a small list right now."},
    {"id": 50104, "pull": 63, "user": "neha", "created_at": ts("2026-02-20 12:00"), "path": "src/lib/upload.ts",
     "line": 41, "body": "2 MB feels small for posters but ok for now."},
]

ISSUES = [
    # (number, title, author, created, body, state, assignee, closed)
    (19, "Event cards cut off on small phones", "sana", "2026-01-25 16:00", "Text overflows on 360px screens.", "closed", "sana", "2026-01-28 18:40"),
    (47, "Sign-up confirmation email lands in spam", "kabir", "2026-02-15 12:00", "Several people said they never got it.", "closed", "rohan", "2026-02-27 20:00"),
    (61, "Add dark mode", "arjun", "2026-02-19 09:00", "Nice to have.", "closed", None, "2026-05-01 10:00"),
    (72, "RSVP count not updating live", "neha", "2026-03-05 20:00", "Need a refresh to see new RSVPs.", "closed", "arjun", "2026-03-21 18:00"),
    (97, "Poster uploads time out on campus Wi-Fi", "meera", "2026-03-27 13:00",
     "During fest prep half the organisers couldn't upload posters from the campus network. Uploads hang then fail.",
     "closed", "rohan", "2026-10-10 18:00"),
    (104, "Events from last year still listed", "kabir", "2026-04-15 11:00", "Archive old events?", "closed", "neha", "2026-05-18 18:20"),
    (113, "Typo on About page", "sana", "2026-06-02 10:00", "'Comittee'.", "closed", "sana", "2026-06-02 12:00"),
    (120, "Leaderboard", "arjun", "2026-07-30 19:00", "Points for attending events, top 10 on a leaderboard page during fest.", "open", None, None),
    (124, "Map of venues", "sana", "2026-08-05 17:00", "Embed campus map with venue pins.", "open", None, None),
    (129, "Slow first load on event page", "neha", "2026-08-20 21:00", "LCP is ~4s on 4G.", "open", "neha", None),
    (131, "Duplicate reminder notifications on Android", "neha", "2026-09-28 22:00",
     "Some Android phones get the same reminder two or three times.", "open", "rohan", None),
    (133, "Add Marathi translations", "kabir", "2026-10-01 12:00", "For the cultural events at least.", "open", None, None),
    (136, "Organiser role management", "meera", "2026-10-05 18:00", "Right now any signed-in user can create events.", "open", None, None),
    (140, "Update README stack section", "neha", "2026-10-15 20:00", "Still mentions OneSignal.", "closed", "rohan", "2026-10-21 19:45"),
    (144, "Fest schedule PDF download", "kabir", "2026-10-25 11:00", "People keep asking for a printable schedule.", "open", None, None),
]

ISSUE_COMMENTS = [
    # (issue_or_pr_number, author, when, body)
    (47, "rohan", "2026-02-27 20:00", "Moved auth emails to Firebase's sender, should be better now."),
    (97, "rohan", "2026-03-29 21:00", "Added client-side compression in #95. Closing."),
    (97, "meera", "2026-04-03 10:00", "Reopening, still failing for big posters from the library Wi-Fi."),
    (97, "rohan", "2026-04-04 22:00", "Lowered compression quality. Closing again."),
    (97, "kabir", "2026-04-11 09:30", "Reopening, happened again on fest day 1."),
    (97, "rohan", "2026-04-11 13:00", "Same as last year, compress before upload. Asked organisers to use the compressed upload button; closing."),
    (97, "neha", "2026-10-09 19:00", "Reopening for the record: this happens every fest. Workaround is still compressing client-side before upload."),
    (97, "rohan", "2026-10-10 18:00", "Yep. Closing; it's the known workaround."),
    (120, "rohan", "2026-08-12 19:20", "Skeleton page merged in #126."),
    (120, "arjun", "2026-09-10 20:00", "Any update? Could help with the scoring logic."),
    (120, "rohan", "2026-09-25 22:40", "parking this for now, maybe after fest"),
    (124, "neha", "2026-08-07 18:00", "Could use a static image first."),
    (129, "neha", "2026-08-21 20:00", "Mostly the poster images. Will look at sizes."),
    (131, "rohan", "2026-09-29 09:00", "Thanks, seen it on my phone too."),
    (136, "kabir", "2026-10-06 12:00", "+1, someone created a fake 'free pizza' event last week."),
    (142, "rohan", "2026-09-22 20:00", "Export works locally. waiting on Dr. Rao's review before merge, since it exports roll numbers."),
    (142, "meera", "2026-10-12 11:00", "I've forwarded it to Dr. Rao again, he said after midsems."),
    (88, "meera", "2026-03-14 22:30", "Thanks Rohan, please post in #dev once reminders are live."),
    (41, "neha", "2026-02-09 08:00", "Makes sense, one less dashboard."),
]


def build_issues() -> list[dict]:
    out = []
    for number, title, author, created, body, state, assignee, closed in ISSUES:
        out.append(
            {
                "number": number,
                "html_url": f"{REPO_URL}/issues/{number}",
                "title": title,
                "user": gh_user(author),
                "state": state,
                "body": body,
                "assignee": gh_user(assignee) if assignee else None,
                "assignees": [gh_user(assignee)] if assignee else [],
                "created_at": ts(created),
                "updated_at": ts(closed or created),
                "closed_at": ts(closed) if closed else None,
                "labels": [],
            }
        )
    return out


def build_issue_comments() -> list[dict]:
    out = []
    pr_numbers = {p["number"] for p in PULLS}
    for i, (num, author, when, body) in enumerate(ISSUE_COMMENTS):
        kind = "pull" if num in pr_numbers else "issues"
        cid = 70000 + i
        out.append(
            {
                "id": cid,
                "issue_url": f"https://api.github.com/repos/{ORG}/{REPO}/issues/{num}",
                "html_url": f"{REPO_URL}/{kind}/{num}#issuecomment-{cid}",
                "user": gh_user(author),
                "created_at": ts(when),
                "body": body,
            }
        )
    return out


def build_pull_comments() -> list[dict]:
    return [
        {
            "id": c["id"],
            "pull_request_url": f"https://api.github.com/repos/{ORG}/{REPO}/pulls/{c['pull']}",
            "html_url": f"{REPO_URL}/pull/{c['pull']}#discussion_r{c['id']}",
            "user": gh_user(c["user"]),
            "created_at": c["created_at"],
            "path": c["path"],
            "line": c["line"],
            "body": c["body"],
        }
        for c in PULL_COMMENTS
    ]


# ----------------------------------------------------------------------------------------------------------------
# Meeting notes
# ----------------------------------------------------------------------------------------------------------------

NOTES = {
    "2026-02-10-kickoff.md": """# Meeting — 2026-02-10 — App team kickoff

Present: Meera, Rohan, Neha, Arjun, Sana

## Where we are
- Event list, detail page and RSVP button are in. Tailwind switch done.
- Auth: moving to Firebase Auth this week (PR #41), so we only manage one console.

## Goals for the spring fest (April)
- Poster uploads for organisers.
- Push reminders 30 minutes before each event.
- Keep hosting on Vercel's free plan.

## Roles
- Rohan: app lead, deploys, push notifications.
- Neha: frontend, docs.
- Arjun: RSVPs.
- Sana: design.

## Actions
- Rohan to set up push reminders.
- Neha to write the setup guide.
""",
    "2026-04-02-fest-prep.md": """# Meeting — 2026-04-02 — Fest prep

Present: Meera, Rohan, Neha, Kabir, Sana

## Uploads
Organisers complained posters get rejected as too big. We agreed to raise the poster upload limit to 5 MB before the fest.
Compression stays on.

## Reminders
FCM reminders are working on Android and iOS since the switch in March.

## Budget
Kabir: hosting is still free. Cloudinary free plan should cover fest traffic.

## Volunteers
Sana is making the fest theme. Neha will be on call for the app on day 1.

## Actions
- Rohan: raise upload limit.
- Kabir: check Cloudinary usage after fest.
""",
    "2026-10-28-handover-sync.md": """# Meeting — 2026-10-28 — Handover sync

Present: Meera, Rohan, Neha

Rohan leaves on 15 Nov for a six-month internship. Neha takes over the app.

## Agreed
- Rohan to transfer Vercel project ownership to Neha before 15 Nov.
- Neha gets admin on the GitHub repo this week.
- PR #142 (RSVP export) stays open until Dr. Rao reviews it.

## Open
- Duplicate Android reminders (issue #131): Rohan said he'd look but no update yet.
- Winter fest is in December; Meera will share sponsor requirements with the core team separately.

## Next sync
After Rohan's last week.
""",
}


# ----------------------------------------------------------------------------------------------------------------
# Chat export (Slack-style). #dev = all members; #core-team = restricted.
# ----------------------------------------------------------------------------------------------------------------

def msg(channel, when, user, text, thread=None):
    return {"channel": channel, "when": when, "user": user, "text": text, "thread": thread}


DEV = [
    msg("dev", "2026-01-12 20:10", "rohan", "repo is up: campus-events-app. next.js + tailwind soon"),
    msg("dev", "2026-01-12 20:12", "arjun", "nice"),
    msg("dev", "2026-01-14 19:00", "sana", "first poster card mockups are in figma"),
    msg("dev", "2026-01-15 21:30", "neha", "do we want login for RSVPs or just a name field?"),
    msg("dev", "2026-01-15 21:34", "rohan", "login, otherwise people will RSVP as 'batman'"),
    msg("dev", "2026-01-18 20:00", "rohan", "auth options: firebase auth, supabase auth, clerk. clerk free tier is small", thread="A1"),
    msg("dev", "2026-01-18 20:05", "arjun", "supabase has nice docs", thread="A1"),
    msg("dev", "2026-01-18 20:08", "rohan", "ok let's just go with Supabase auth for now, fastest to set up", thread="A1"),
    msg("dev", "2026-01-18 20:09", "neha", "👍", thread="A1"),
    msg("dev", "2026-01-22 18:00", "kabir", "reminder: club meeting saturday 5pm"),
    msg("dev", "2026-01-26 19:30", "sana", "we're moving to tailwind, PR coming"),
    msg("dev", "2026-01-30 22:00", "rohan", "deploy workflow is live, merging to main ships to vercel"),
    msg("dev", "2026-01-30 22:05", "rohan", "call me on +91 90000 00000 if deploy breaks while I'm travelling"),
    msg("dev", "2026-02-03 20:00", "arjun", "anyone know why the build is slow"),
    msg("dev", "2026-02-03 20:10", "rohan", "next build without cache, will fix in the workflow"),
    msg("dev", "2026-02-07 21:15", "rohan", "thinking of dropping supabase for firebase auth since we use firestore anyway", thread="A2"),
    msg("dev", "2026-02-07 21:20", "neha", "one console instead of two sounds good", thread="A2"),
    msg("dev", "2026-02-07 21:22", "rohan", "PR #41 tomorrow", thread="A2"),
    msg("dev", "2026-02-12 17:00", "kabir", "is the app going to cost us anything?"),
    msg("dev", "2026-02-12 17:30", "rohan", "everything's on free plans right now"),
    msg("dev", "2026-02-18 20:40", "sana", "poster aspect ratio 4:5 ok?"),
    msg("dev", "2026-02-18 20:42", "meera", "yes"),
    msg("dev", "2026-02-21 19:00", "rohan", "poster uploads merged, they go to cloudinary on the club account"),
    msg("dev", "2026-02-25 18:00", "neha", "setup guide is in docs/setup.md"),
    msg("dev", "2026-03-04 21:00", "rohan", "onesignal reminders work on my phone"),
    msg("dev", "2026-03-12 20:30", "rohan", "bad news: onesignal free plan has a device cap and we'll hit it before fest", thread="A3"),
    msg("dev", "2026-03-12 20:33", "arjun", "how many devices?", thread="A3"),
    msg("dev", "2026-03-12 20:35", "rohan", "we had 900 subscribers in a week, cap is way under what fest will bring", thread="A3"),
    msg("dev", "2026-03-12 20:40", "rohan", "moving push to Firebase Cloud Messaging instead, it's free and we're already on firebase", thread="A3"),
    msg("dev", "2026-03-12 20:41", "meera", "ok go ahead", thread="A3"),
    msg("dev", "2026-03-15 10:00", "rohan", "FCM reminders are live 🎉"),
    msg("dev", "2026-03-20 19:00", "arjun", "fixed the double RSVP click"),
    msg("dev", "2026-03-27 13:10", "meera", "organisers can't upload posters on campus wifi, see issue #97"),
    msg("dev", "2026-03-27 13:30", "rohan", "probably the upload size + slow wifi. will compress client side"),
    msg("dev", "2026-03-30 18:00", "kabir", "fest budget meeting thursday"),
    msg("dev", "2026-04-02 21:00", "neha", "notes from today's fest prep are in the drive"),
    msg("dev", "2026-04-08 22:00", "sana", "fest theme colours pushed"),
    msg("dev", "2026-04-11 09:40", "kabir", "uploads failing again at the registration desk"),
    msg("dev", "2026-04-11 09:45", "rohan", "use the compressed upload button, same as last year"),
    msg("dev", "2026-04-12 20:00", "meera", "great fest everyone, app had 2.1k users"),
    msg("dev", "2026-04-20 19:00", "arjun", "taking a break for exams"),
    msg("dev", "2026-05-10 18:00", "neha", "working on category filters"),
    msg("dev", "2026-05-25 20:00", "kabir", "summer plans? anyone around in june"),
    msg("dev", "2026-06-15 21:00", "neha", "fixed a typo in the deploy workflow"),
    msg("dev", "2026-07-01 19:00", "arjun", "bumped next, all good locally"),
    msg("dev", "2026-07-22 21:20", "rohan", "pasting the server key here so I can grab it from my laptop later:", thread="A4"),
    msg("dev", "2026-07-22 21:21", "rohan", f"FIREBASE_SERVER_KEY={FAKE_FIREBASE_KEY}", thread="A4"),
    msg("dev", "2026-07-22 21:30", "meera", "rohan please don't paste keys in chat, rotate it", thread="A4"),
    msg("dev", "2026-07-22 21:41", "rohan", "rotated, sorry", thread="A4"),
    msg("dev", "2026-07-30 19:10", "arjun", "opened #120 for a leaderboard, thoughts?"),
    msg("dev", "2026-07-30 19:20", "sana", "fun for fest"),
    msg("dev", "2026-08-12 19:30", "rohan", "leaderboard skeleton is in, behind a flag"),
    msg("dev", "2026-08-20 21:10", "neha", "first load is slow, looking into it"),
    msg("dev", "2026-09-01 18:00", "kabir", "new semester, new members joining the club"),
    msg("dev", "2026-09-08 20:40", "neha", "timezone fix is merged"),
    msg("dev", "2026-09-19 19:00", "rohan", "rsvp csv export PR is up (#142), needs faculty sign-off"),
    msg("dev", "2026-09-28 22:05", "neha", "android users getting duplicate reminders, issue #131", thread="A5"),
    msg("dev", "2026-09-28 22:20", "rohan", "I'll look at the duplicate notifs later", thread="A5"),
    msg("dev", "2026-10-03 21:30", "arjun", "fixed the reminder sound on android, not the duplicates"),
    msg("dev", "2026-10-09 19:05", "neha", "reopened #97 just to document it, it's a yearly thing"),
    msg("dev", "2026-10-15 20:10", "neha", "readme still says onesignal"),
    msg("dev", "2026-10-21 19:50", "rohan", "readme updated"),
    msg("dev", "2026-10-26 18:00", "meera", "winter fest planning starts next week"),
    msg("dev", "2026-10-28 21:00", "meera", "handover sync done, notes in drive. neha is taking over the app from rohan"),
    msg("dev", "2026-10-28 21:05", "kabir", "congrats on the internship rohan!"),
    msg("dev", "2026-10-28 21:06", "arjun", "🎉"),
    msg("dev", "2026-10-30 22:35", "neha", "lint fixes merged"),
    msg("dev", "2026-11-03 19:00", "sana", "winter fest poster drafts next week"),
]

CORE = [
    msg("core-team", "2026-09-02 18:00", "kabir", "club account balance is ₹12,400 after the workshop"),
    msg("core-team", "2026-09-02 18:10", "meera", "thanks kabir"),
    msg("core-team", "2026-09-15 20:00", "meera", "two companies interested in sponsoring winter fest"),
    msg("core-team", "2026-09-15 20:05", "rohan", "nice, which ones?"),
    msg("core-team", "2026-09-15 20:06", "meera", "will share once it's firm"),
    msg("core-team", "2026-10-05 19:00", "meera", "sponsor update: TechNova is confirmed", thread="C1"),
    msg("core-team", "2026-10-05 19:02", "meera",
        "TechNova pays ₹40,000 only if the events app is live for the fest by 20 Dec. contract is with me", thread="C1"),
    msg("core-team", "2026-10-05 19:05", "kabir", "₹40k covers the stage and food", thread="C1"),
    msg("core-team", "2026-10-05 19:06", "rohan", "app will be live, it already is. just need to keep it up", thread="C1"),
    msg("core-team", "2026-10-05 19:10", "meera", "please keep this in core team until it's announced", thread="C1"),
    msg("core-team", "2026-10-07 12:00", "kabir", "invoice template ready for TechNova"),
    msg("core-team", "2026-10-12 18:00", "meera", "second sponsor fell through"),
    msg("core-team", "2026-10-12 18:05", "kabir", "ok, we budget with TechNova only"),
    msg("core-team", "2026-10-18 20:00", "meera", "faculty approval for winter fest dates: 19-21 Dec"),
    msg("core-team", "2026-10-18 20:02", "rohan", "noted"),
    msg("core-team", "2026-10-22 17:00", "kabir", "need receipts for september workshop by friday"),
    msg("core-team", "2026-10-25 19:00", "meera", "rohan leaves 15 nov, neha takes over app. not in core team yet"),
    msg("core-team", "2026-10-25 19:03", "kabir", "should we add neha to core team?"),
    msg("core-team", "2026-10-25 19:05", "meera", "after winter fest maybe"),
    msg("core-team", "2026-10-29 21:00", "rohan", "handover notes started"),
    msg("core-team", "2026-11-01 18:00", "kabir", "stage vendor quote is ₹28k"),
    msg("core-team", "2026-11-01 18:05", "meera", "ok within the sponsor money"),
    msg("core-team", "2026-11-03 20:00", "meera", "TechNova wants a logo on the app's fest page"),
    msg("core-team", "2026-11-03 20:05", "rohan", "easy, neha can add it"),
]


def build_chat() -> list[dict]:
    out = []
    thread_root_ts: dict[str, str] = {}
    for i, m in enumerate(DEV + CORE):
        dt = datetime.strptime(m["when"], "%Y-%m-%d %H:%M").replace(tzinfo=timezone(timedelta(hours=5, minutes=30)))
        t = f"{dt.timestamp():.0f}.{i:06d}"
        row = {
            "type": "message",
            "channel": m["channel"],
            "user": SLACK_IDS[m["user"]],
            "user_profile": {"name": m["user"], "real_name": USERS[m["user"]]["name"]},
            "text": m["text"],
            "ts": t,
        }
        if m["thread"]:
            root = thread_root_ts.setdefault(m["thread"], t)
            row["thread_ts"] = root
        out.append(row)
    return out


# ----------------------------------------------------------------------------------------------------------------
# Golden ledger (labelled test set)
# ----------------------------------------------------------------------------------------------------------------

ALL = ["meera", "rohan", "neha", "kabir"]

GOLDEN = {
    "version": 1,
    "export_date": EXPORT_DATE,
    "claims": [
        {"id": "G1", "type": "decision", "subject_key": "notifications.provider",
         "gist": "Push notifications moved from OneSignal to FCM in March because OneSignal's free plan caps devices",
         "expected_status": ["supported", "verified"],
         "evidence": [{"source": "repo:pull/88", "contains": "OneSignal free plan caps us at the device limit before fest"},
                      {"source": "chat:#dev", "contains": "moving push to Firebase Cloud Messaging instead"}],
         "visible_to": ALL},
        {"id": "G2", "type": "ownership", "subject_key": "deploy.owner",
         "gist": "Rohan is effectively the only maintainer of the deploy workflow (31 of 33 commits)",
         "expected_status": ["supported"],
         "evidence": [{"source": "repo:commit_stats", "contains": "deploy.yml: 33 commits; rohan 31, neha 2"}],
         "visible_to": ALL},
        {"id": "G3", "type": "risk", "subject_key": "upload.max_size",
         "gist": "Upload limit conflict: notes say 5 MB, code enforces 2 MB",
         "expected_status": ["conflicting"],
         "evidence": [{"source": "notes/2026-04-02-fest-prep.md", "contains": "raise the poster upload limit to 5 MB"},
                      {"source": "repo:src/lib/upload.ts", "contains": "2 * 1024 * 1024"}],
         "visible_to": ALL},
        {"id": "G4", "type": "open_work", "subject_key": "pr.142.status",
         "gist": "PR #142 (RSVP CSV export) is unfinished and blocked on Dr. Rao's review",
         "expected_status": ["supported"],
         "evidence": [{"source": "repo:pull/142", "contains": "waiting on Dr. Rao's review before merge"}],
         "visible_to": ALL},
        {"id": "G5", "type": "contact", "subject_key": "firebase.owner",
         "gist": "Owner of the Firebase project and billing account is unknown",
         "expected_status": ["missing"], "evidence": [], "visible_to": ALL},
        {"id": "G6", "type": "open_question", "subject_key": "leaderboard.status",
         "gist": "The leaderboard feature (issue #120) is parked / may be abandoned",
         "expected_status": ["inferred", "supported"],
         "evidence": [{"source": "repo:issues/120", "contains": "parking this for now, maybe after fest"}],
         "visible_to": ALL},
        {"id": "G7", "type": "decision", "subject_key": "auth.provider",
         "gist": "Auth moved from Supabase Auth to Firebase Auth in Feb, superseding January's choice",
         "expected_status": ["supported", "verified"], "superseded": "January Supabase claim superseded, not a conflict",
         "evidence": [{"source": "repo:pull/41", "contains": "Replace Supabase Auth with Firebase Auth"},
                      {"source": "chat:#dev", "contains": "let's just go with Supabase auth"}],
         "visible_to": ALL},
        {"id": "G8", "type": "dependency", "subject_key": "sponsor.technova",
         "gist": "Sponsor TechNova pays ₹40,000 only if the app is live for the fest by 20 Dec; contract is with Meera",
         "expected_status": ["supported"], "restricted": True,
         "evidence": [{"source": "chat:#core-team", "contains": "TechNova pays ₹40,000 only if the events app is live"}],
         "visible_to": ["meera", "rohan", "kabir"]},
        {"id": "G10", "type": "recurring_issue", "subject_key": "upload.timeouts",
         "gist": "Every fest image uploads time out on campus Wi-Fi; workaround is client-side compression",
         "expected_status": ["supported"],
         "evidence": [{"source": "repo:issues/97", "contains": "compress before upload"}],
         "visible_to": ALL},
        {"id": "G11", "type": "dependency", "subject_key": "images.provider",
         "gist": "Images are hosted on Cloudinary's free plan under the club account",
         "expected_status": ["supported"],
         "evidence": [{"source": "repo:README.md", "contains": "Cloudinary (free plan, club account)"}],
         "visible_to": ALL},
        {"id": "G12", "type": "next_action", "subject_key": "vercel.transfer",
         "gist": "Rohan must transfer the Vercel project to Neha before 15 Nov",
         "expected_status": ["supported"],
         "evidence": [{"source": "notes/2026-10-28-handover-sync.md", "contains": "transfer Vercel project ownership to Neha"}],
         "visible_to": ALL},
        {"id": "G13", "type": "risk", "subject_key": "rsvp.tests",
         "gist": "The RSVP flow has no automated tests",
         "expected_status": ["supported"],
         "evidence": [{"source": "repo:pull/142", "contains": "there are no tests for the RSVP flow at all"}],
         "visible_to": ALL},
        {"id": "G14", "type": "open_work", "subject_key": "issue.131.status",
         "gist": "Issue #131 (duplicate Android reminders), assigned to Rohan: status unknown",
         "expected_status": ["missing"], "evidence": [], "visible_to": ALL},
    ],
    "secrets": [FAKE_FIREBASE_KEY, FAKE_STRIPE_KEY],
    "pii": [FAKE_PHONE],
}


# ----------------------------------------------------------------------------------------------------------------

def _escape_secrets(text: str) -> str:
    """Hide planted fake secrets from GitHub secret scanning while keeping JSON semantics identical."""
    return text.replace("AIza", "AI\\u007aa").replace("sk_test_", "sk\\u005ftest_")


def write_json(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(_escape_secrets(json.dumps(data, indent=2, ensure_ascii=False)) + "\n", encoding="utf-8")


def main() -> None:
    fx = ROOT / "github_fixture"
    write_json(fx / "repo.json", {
        "full_name": f"{ORG}/{REPO}", "name": REPO, "html_url": REPO_URL, "default_branch": "main",
        "description": "DevClub's event listings, RSVPs and push reminders (SYNTHETIC demo data)",
        "private": False, "pushed_at": EXPORT_DATE,
    })
    write_json(fx / "commits.json", build_commits())
    write_json(fx / "pulls.json", PULLS)
    write_json(fx / "pull_comments.json", build_pull_comments())
    write_json(fx / "issues.json", build_issues())
    write_json(fx / "issue_comments.json", build_issue_comments())
    write_json(fx / "contents.json", contents_json())

    notes = ROOT / "notes"
    notes.mkdir(exist_ok=True)
    for name, body in NOTES.items():
        (notes / name).write_text(body, encoding="utf-8")

    write_json(ROOT / "chat" / "slack_export.json", build_chat())
    write_json(ROOT / "golden_ledger.json", GOLDEN)

    commits = build_commits()
    deploy = [c for c in commits if any(f["filename"] == DEPLOY for f in c["files"])]
    by = {}
    for c in deploy:
        by[c["author"]["login"]] = by.get(c["author"]["login"], 0) + 1
    print(f"commits={len(commits)} deploy.yml={len(deploy)} {by} pulls={len(PULLS)} issues={len(ISSUES)} "
          f"chat={len(DEV)}+{len(CORE)} notes={len(NOTES)}")


if __name__ == "__main__":
    main()
