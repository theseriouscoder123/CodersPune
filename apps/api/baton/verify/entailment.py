"""Isolated entailment verifier (trust rule 3). It sees ONLY the claim text and the quoted excerpt with a little
surrounding context; never the extraction prompt, never other claims. Uses a different model from the extractor."""

from __future__ import annotations

from baton.llm.prompts import VERIFY_SYSTEM, Verdict

CONTEXT_CHARS = 200


def excerpt(chunk_text: str, start: int | None, end: int | None, quote: str) -> str:
    if start is None or end is None:
        return quote
    a, b = max(0, start - CONTEXT_CHARS), min(len(chunk_text), end + CONTEXT_CHARS)
    return ("…" if a > 0 else "") + chunk_text[a:b] + ("…" if b < len(chunk_text) else "")


def verify(llm, model: str, claim_text: str, excerpt_text: str, *, workspace_id=None, run_id=None) -> Verdict:
    user = f"Claim:\n{claim_text}\n\nSource excerpt:\n{excerpt_text}"
    return llm.structured(system=VERIFY_SYSTEM, user=user, schema=Verdict, model=model, purpose="verify",
                          workspace_id=workspace_id, run_id=run_id)
