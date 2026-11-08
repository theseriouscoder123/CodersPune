# 03 — Pipeline, Algorithms and Prompts

Run order inside `pipeline.py` (each step writes progress to `jobs`):

```
1 ingest      → sources, chunks (scrubbed, ACL-tagged, timestamped)
2 checklist   → checklist-origin claims (deterministic)
3 extract     → extracted claims + proposed evidence (LLM, batched by acl_key)
4 cover       → try to find evidence for checklist claims (FTS + LLM yes/no)
5 match       → quote_found + match_score for every evidence item (deterministic)
6 verify      → verdict for every evidence item with quote_found=true (isolated verifier)
7 conflicts   → conflict groups, supersession
8 status      → status + status_reason for every claim (status.py)
9 handover    → ensure a handover record exists (leaver → successor) with no approved version yet
```

## 1. Batching for extraction

- Take the workspace's chunks, **group by `acl_key`**, and within each group sort by `occurred_at`.
- Pack chunks into batches of ≤ ~12k characters. Never split a chunk. Each chunk gets a short local id in the
  prompt (`C1`, `C2`, …) that maps back to a chunk UUID.
- Include a small **project context header** (repo name, members and their handles, the leaver's name) in every batch.
  It contains no content from other ACL groups.

## 2. Extraction prompt

**System:**
```
You extract handover knowledge from project records for a successor who is taking over from {leaver_name}.
Return ONLY claims that are directly stated or clearly shown in the provided chunks.
Rules:
- Each claim is ONE atomic statement, ≤ 220 characters, in plain English, present tense where possible.
- Each claim MUST cite at least one chunk id and give an EXACT quote copied character-for-character from that chunk
  (5–40 words). Do not paraphrase inside the quote. Do not merge text from two chunks into one quote.
- If something is likely but not stated, you may still output it, but set "stated": false and give the closest quote.
- Use subject_key as a short dotted topic (e.g. "upload.max_size", "notifications.provider", "deploy.owner").
  Reuse the same subject_key for claims about the same topic. Put a normalised comparable value in "value" when the
  claim sets a value (sizes, providers, owners, dates).
- Set "supersedes_hint": true only if the text explicitly says an earlier choice was replaced or reversed.
- Prefer claims a successor needs: decisions and WHY, who owns what, unfinished work, blockers, risks, dependencies,
  contacts, recurring problems, next actions.
- Never include secrets, credentials or personal contact details in claim text.
```

**User:** the context header + chunks formatted as
```
[C3] (pr_comment · PR #88 · 2026-03-12 · author: rohan)
<chunk text>
```

**Output schema (Pydantic):**
```python
class ProposedEvidence(BaseModel):
    chunk: str            # "C3"
    quote: str

class ProposedClaim(BaseModel):
    type: Literal["decision","ownership","open_work","next_action","risk","dependency","contact","recurring_issue","open_question"]
    text: str
    subject_key: str
    value: str | None = None
    stated: bool = True
    supersedes_hint: bool = False
    evidence: list[ProposedEvidence]   # min 1

class ExtractionResult(BaseModel):
    claims: list[ProposedClaim]
```

Post-processing:
- Drop evidence whose chunk id isn't in the batch. Drop claims left with no evidence.
- `occurred_at` = the max `occurred_at` of the cited chunks.
- Deduplicate within a run: the same `subject_key`, and text similarity ≥ 90 (rapidfuzz `token_set_ratio`), merge evidence.
- `stated=false` doesn't change the status logic (the status still comes from the rules), but store it for the UI hint.

## 3. Quote matching (`verify/quote_match.py`, pure)

```python
def normalise(s): lowercase; strip **, __, `, “ ” ‘ ’ " '; collapse whitespace; strip
def match(quote, chunk_text) -> (found: bool, score: int):
    q, t = normalise(quote), normalise(chunk_text)
    if q in t: return True, 100
    score = rapidfuzz.fuzz.partial_ratio(q, t)
    return score >= 90, score
```
Also store the matched character offsets (`rapidfuzz.fuzz.partial_ratio_alignment`) so the UI can highlight the span.

## 4. Checklist coverage (`reconstruct/checklist.py` + the `cover` step)

1. Build checklist items deterministically (table in spec §7). Commit-stats ownership items get their own generated
   `commit_stats` chunk as evidence, e.g. `"deploy.yml: 33 commits; rohan 31, neha 2"`, quote = that line.
2. For every other item: run a Postgres FTS query (keywords from the item: PR number, title words, env prefix,
   workflow name) over chunks **in all ACL groups**. Take the top 6 chunks.
3. Ask the LLM (verify model) per item: "Do these chunks answer: <item question>? If yes, return the chunk id, an exact
   quote and a one-sentence answer." If it answers yes, the item's claim text becomes the answer and the quote becomes
   evidence. The evidence chunk's ACL then governs visibility, as usual.
4. Items that stay unanswered are **missing**, with `status_reason` = "Expected because <signal>; no source covers it."

## 5. Verification (`verify/entailment.py`)

The verifier sees **only** the claim text and the quote (plus ±200 chars of surrounding text). It never sees the
extraction prompt or the other claims.

**System:**
```
You check whether a short source excerpt supports a claim. Answer strictly from the excerpt.
- "supports": the excerpt states or directly shows the claim.
- "contradicts": the excerpt states something incompatible with the claim.
- "insufficient": the excerpt is related but does not establish the claim.
Be strict: missing specifics (numbers, names, dates) in the excerpt means "insufficient".
```
**Schema:** `{"verdict": "supports"|"contradicts"|"insufficient", "reason": str (≤ 25 words)}`

`VERIFIER=nli` alternative: `cross-encoder/nli-deberta-v3-small`, premise = excerpt, hypothesis = claim;
entailment > 0.7 → supports, contradiction > 0.7 → contradicts, otherwise insufficient. Only enable it if the API host has ≥ 2 GB RAM.

## 6. Conflicts and supersession (`reconstruct/conflicts.py`)

As in spec §6. Value normalisation: lowercase, units normalised (`5 mb`, `5MB`, `5 megabytes` → `5mb`; `2 * 1024 * 1024` → `2mb`
via a small evaluator for byte expressions), provider aliases (`fcm`, `firebase cloud messaging` → `fcm`).
Also create a conflict when an evidence item has verdict `contradicts` against a claim in the same `subject_key`.

## 7. Status reasons (strings shown in the UI)

- verified: "Confirmed by {reviewer} · quote found in {source_ref} (match {score}) · verifier: supports"
- verified (promoted): "Reviewer-confirmed without source evidence · note: '{note}'"
- supported: "Quote found in {source_ref} (match {score}) · verifier: supports · not yet confirmed by a person"
- inferred: "No quote passed: {first failure, e.g. 'quote not found in PR #12' or 'verifier: insufficient — excerpt doesn't state the date'}"
- conflicting: "Disagrees with: '{other claim text}' ({other source_ref}). Pick one, or keep both as an open risk."
- missing: "Expected because {signal}; no source covers it."

## 8. Questions for the leaver (R2 list; R3 becomes the interview)

For each missing claim → "Who/what/how: <item question>?"; for each unresolved conflict → "<A> vs <B> — which is current, and why?"
Order: open work first, then contacts/ownership, then conflicts. Provide a "Copy as Markdown" button.

## 9. Evaluation (`apps/api/eval/eval_citations.py`)

Against `demo/golden_ledger.json` (from `04_DEMO_DATA.md`):
- **Claim recall:** fraction of golden claims matched by a produced claim (same `subject_key` OR text similarity ≥ 70, and the same type).
- **Status accuracy:** among the matched claims, the fraction with the expected status.
- **Citation precision:** among produced claims with status supported/verified, the fraction whose passing evidence actually
  points to one of the golden evidence chunks for that claim (or a manual spot-check list, if unmatched).
- **Permission test:** the count of restricted golden claims visible to Neha (must be 0).
- **Secret test:** the count of planted secrets found in the DB (must be 0).
Write the numbers into `docs/TESTING.md` with the date, model names and run id. Run it at least 3 times and report the range.
