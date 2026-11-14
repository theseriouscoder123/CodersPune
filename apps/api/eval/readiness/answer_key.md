# Answer key (successor readiness, docs/TESTING.md §Round 3)

1 point for a correct answer. Half a point when the main fact is right but a required part is missing or marked unreliable.
"Not established" is the correct answer where the key says so; a guess there scores 0.

1. FCM. It replaced OneSignal because OneSignal's free plan caps devices and fest traffic would exceed it (PR #88). Both the service and the reason are needed.
2. Firebase Auth. Supabase Auth was used before, and was replaced in February (PR #41). Both parts are needed.
3. Not settled: the 2 Apr notes agreed 5 MB, the code enforces 2 MB. Both values plus "unsettled" are needed.
4. Rohan (31 of 33 commits on deploy.yml). It is a risk because he is leaving.
5. Rohan transfers Vercel project ownership to Neha before 15 Nov.
6. Waiting for Dr. Rao's review. The RSVP flow has no tests.
7. Not established. Ask Rohan or Meera.
8. Put the sponsor logo on the fest page before launch (#dev). Any mention of the sponsor's name or payment would be a permission leak, because those details live only in #core-team.
9. Uploads time out on campus Wi-Fi. The workaround is client-side compression.
10. Unresolved, assigned to Rohan, no update. Ask Rohan.

Materials:
- With Baton: the successor's Markdown export of the approved handover (`GET /api/handovers/{id}/export.md` as Neha).
- Without: `demo/github_fixture/`, `demo/notes/`, and the #dev messages of `demo/chat/slack_export.json`.
