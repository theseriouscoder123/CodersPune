import pytest

from baton.ingest.scrubber import mask_pii, scrub

# Assembled from pieces so this test file itself doesn't trip secret scanners.
GOOGLE = "AI" + "za" + "SyD3m0-FAKE-KEY-n0t-real-0000000000"
STRIPE = "sk_" + "test_" + "FAKEFAKEFAKEFAKE1234"
GH = "gh" + "p_" + "a" * 36
AWS = "AK" + "IA" + "ABCDEFGHIJKLMNOP"
SLACK = "xo" + "xb-" + "1234567890-abcdefghij"
JWT = "eyJ" + "hbGciOiJIUzI1NiJ9" + ".eyJ" + "zdWIiOiIxMjM0NTY3ODkwIn0" + ".abcdefghijklmnopqrstuv"


@pytest.mark.parametrize(
    "secret,kind",
    [(GOOGLE, "google_api_key"), (STRIPE, "stripe_key"), (GH, "github_token"), (AWS, "aws_access_key"),
     (SLACK, "slack_token"), (JWT, "jwt")],
)
def test_specific_secret_formats_are_redacted(secret, kind):
    out, counts = scrub(f"here you go: {secret} thanks")
    assert secret not in out
    assert f"[REDACTED:{kind}]" in out
    assert counts[kind] == 1


def test_demo_secrets_g9():
    chat, c1 = scrub(f"FIREBASE_SERVER_KEY={GOOGLE}")
    doc, c2 = scrub(f"```\nSTRIPE_KEY={STRIPE}\n```")
    assert GOOGLE not in chat and STRIPE not in doc
    assert sum(c1.values()) + sum(c2.values()) == 2  # exactly 2 redactions, no double counting


def test_pem_private_key_block():
    pem = "-----BEGIN RSA PRIVATE KEY-----\nMIIEow\nabc\n-----END RSA PRIVATE KEY-----"
    out, counts = scrub(f"key:\n{pem}\nend")
    assert "MIIEow" not in out and counts["private_key"] == 1


def test_generic_assignment_redacts_value_but_keeps_name():
    out, counts = scrub("DB_PASSWORD=hunter2hunter2 and api_key: 'abcd1234efgh5678'")
    assert "hunter2hunter2" not in out and "abcd1234efgh5678" not in out
    assert "DB_PASSWORD=" in out and "api_key:" in out
    assert counts["generic_secret"] == 2


@pytest.mark.parametrize(
    "text",
    [
        "commit 3f786850e387550fdab836ed7e6dc881de23001b fixes deploy",       # SHA must survive
        "api_key: process.env.CLOUDINARY_API_KEY,",                           # config reference
        "NEXT_PUBLIC_FIREBASE_API_KEY: ${{ secrets.NEXT_PUBLIC_FIREBASE_API_KEY }}",
        "run: npx vercel deploy --prod --token ${{ secrets.VERCEL_TOKEN }}",
        "FIREBASE_SERVER_KEY=",                                                # empty .env.example line
        "NEXT_PUBLIC_FIREBASE_API_KEY=\nNEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=\n",  # must not grab the next line
        "CLOUDINARY_API_KEY=\nCLOUDINARY_API_SECRET=\n",
        "the token expired yesterday, password reset emails go to spam",       # prose
        "password: string;",                                                   # type annotation
        "apiKey = API_KEY_FROM_ENV",                                           # identifier
    ],
)
def test_false_positive_guards(text):
    out, counts = scrub(text)
    assert out == text, out
    assert not counts


def test_mask_phone_and_email():
    out = mask_pii("call me on +91 90000 00000 or mail rohan.d@example.com")
    assert "90000 00000" not in out and "+91 90" in out
    assert "rohan.d@example.com" not in out and "r***@…" in out


@pytest.mark.parametrize("text", ["fest on 2026-04-02", "₹40,000 by 20 Dec", "PR #142", "33 commits; rohan 31"])
def test_mask_leaves_dates_amounts_numbers(text):
    assert mask_pii(text) == text
