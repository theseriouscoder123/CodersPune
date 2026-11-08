from baton.routers.ask import _renumber


def test_internal_ids_become_citation_numbers():
    assert _renumber("Rohan owns deploys [I7].", ["I7"]) == "Rohan owns deploys [1]."
    assert _renumber("Do A (I3) then B [I1, I3].", ["I3", "I1"]) == "Do A [1] then B [1][2]."


def test_uncited_ids_are_dropped():
    assert _renumber("Ignore this [I9].", ["I1"]) == "Ignore this."


def test_bullets_keep_their_lines():
    out = _renumber("- Transfer Vercel [I2][I5]\n- Admin access [I1]", ["I2", "I5", "I1"])
    assert out == "- Transfer Vercel [1][2]\n- Admin access [3]"
