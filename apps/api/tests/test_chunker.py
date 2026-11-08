import json

import pytest

from baton.ingest.chat_export import parse_chat_export
from baton.ingest.chunker import line_of_offset, split_code, split_markdown
from baton.ingest.uploads import UploadRejected, guess_date, parse_upload


def test_markdown_split_keeps_heading_path_and_limit():
    md = "# Meeting — 2026-04-02\n\n## Uploads\n" + ("word " * 400) + "\n\nsecond para\n\n## Budget\nfree"
    pieces = split_markdown(md, max_chars=500)
    assert all(len(t) <= 500 for t, _ in pieces)
    assert pieces[-1][1]["heading_path"] == ["Meeting — 2026-04-02", "Budget"]
    assert any("second para" in t for t, _ in pieces)


def test_code_windows_and_line_lookup():
    code = "\n".join(f"line {i}" for i in range(1, 131))
    pieces = split_code(code, window=60)
    assert [p[1]["line_start"] for p in pieces] == [1, 61, 121]
    text, loc = pieces[0]
    assert line_of_offset(text, text.index("line 41"), loc["line_start"]) == 41


def test_upload_date_and_rejections():
    assert guess_date("notes.md", "# Meeting — 2026-04-02\nhello").date().isoformat() == "2026-04-02"
    assert guess_date("2026-10-28-sync.md", "no date here").date().isoformat() == "2026-10-28"
    with pytest.raises(UploadRejected):
        parse_upload("evil.exe", b"x")
    with pytest.raises(UploadRejected):
        parse_upload("big.md", b"x" * (2 * 1024 * 1024 + 1))


def test_chat_threads_and_channels_are_separate():
    msgs = [
        {"channel": "dev", "ts": "1000.0", "user": "U1", "text": "root", "thread_ts": "1000.0"},
        {"channel": "dev", "ts": "1060.0", "user": "U2", "text": "reply", "thread_ts": "1000.0"},
        {"channel": "dev", "ts": "1030.0", "user": "U3", "text": "unrelated"},
        {"channel": "dev", "ts": "9000.0", "user": "U3", "text": "much later"},
        {"channel": "core-team", "ts": "1000.0", "user": "U1", "text": "secret plans"},
    ]
    out = parse_chat_export(json.dumps(msgs))
    assert set(out) == {"dev", "core-team"}
    dev_texts = [c.text for c in out["dev"]]
    assert any("root" in t and "reply" in t for t in dev_texts)          # thread grouped
    assert not any("much later" in t and "unrelated" in t for t in dev_texts)  # >20 min apart split
    assert all("secret plans" not in t for t in dev_texts)               # channels never mix


def test_discord_export_replies_become_threads():
    export = {
        "guild": {"name": "Robotics"},
        "channel": {"name": "build-team"},
        "messages": [
            {"id": "1", "type": "Default", "timestamp": "2026-03-01T10:00:00+00:00", "content": "Which motor driver?", "author": {"name": "asha"}},
            {"id": "2", "type": "Reply", "timestamp": "2026-03-01T10:05:00+00:00", "content": "Going with the TB6612", "author": {"name": "ben"},
             "reference": {"messageId": "1"}},
            {"id": "3", "type": "ChannelPinnedMessage", "timestamp": "2026-03-01T10:06:00+00:00", "content": "pinned", "author": {"name": "x"}},
            {"id": "4", "type": "Default", "timestamp": "2026-03-02T18:00:00+00:00", "content": "unrelated later", "author": {"name": "cy"}},
        ],
    }
    out = parse_chat_export(json.dumps(export))
    assert set(out) == {"build-team"}
    texts = [c.text for c in out["build-team"]]
    assert any("Which motor driver?" in t and "TB6612" in t for t in texts)  # reply grouped with its parent
    assert not any("pinned" in t for t in texts)
    assert not any("unrelated later" in t and "TB6612" in t for t in texts)
