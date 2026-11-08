from baton.routers.ask import _renumber


def test_internal_ids_become_citation_numbers():
    assert _renumber("Rohan owns deploys [I7].", ["I7"]) == "Rohan owns deploys [1]."
    assert _renumber("Do A (I3) then B [I1, I3].", ["I3", "I1"]) == "Do A [1] then B [1][2]."


def test_uncited_ids_are_dropped():
    assert _renumber("Ignore this [I9].", ["I1"]) == "Ignore this."


def test_bullets_keep_their_lines():
    out = _renumber("- Transfer Vercel [I2][I5]\n- Admin access [I1]", ["I2", "I5", "I1"])
    assert out == "- Transfer Vercel [1][2]\n- Admin access [3]"


def test_next_actions_and_unknowns_are_always_in_context():
    from baton.routers.ask import MAX_CONTEXT_ITEMS, _rank

    def it(text, section, type_label="Decision"):
        return {"text": text, "type_label": type_label, "_section": section}

    items = [it(f"Deploy detail {i}", "decisions") for i in range(30)]
    items += [it("Transfer Vercel ownership before 15 Nov", "start_here", "Next action"),
              it("Who owns the Firebase billing", "unresolved", "Contact")]
    ctx = _rank("deploy deploy deploy", items)
    texts = [c["text"] for c in ctx]
    assert len(ctx) == MAX_CONTEXT_ITEMS
    assert texts[0] == "Transfer Vercel ownership before 15 Nov"
    assert "Who owns the Firebase billing" in texts
