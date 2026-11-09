import { CheckCircle2, CircleSlash, ExternalLink, Lock, Quote, Users, XCircle } from "lucide-react";

import type { EvidenceInfo } from "@/lib/api";

const VERDICT: Record<string, { label: string; cls: string }> = {
  supports: { label: "supports the claim", cls: "text-verified" },
  contradicts: { label: "contradicts the claim", cls: "text-conflicting" },
  insufficient: { label: "doesn't establish the claim", cls: "text-inferred" },
  pending: { label: "not checked yet", cls: "text-muted" },
};

export function EvidenceCard({ e }: { e: EvidenceInfo }) {
  const url = typeof e.location?.url === "string" ? (e.location.url as string) : null;
  const restricted = e.source.access !== "All members";
  const v = VERDICT[e.verdict] ?? VERDICT.pending;
  return (
    <div className="animate-rise overflow-hidden rounded-2xl border border-line bg-card" data-testid="evidence-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-paper/60 px-4 py-2.5">
        <span className="flex min-w-0 items-center gap-2 text-xs">
          <span className="font-mono font-semibold text-supported">{e.ref}</span>
          <span className="truncate text-muted">· {e.source.name}{e.author ? ` · ${e.author}` : ""}{e.occurred_at ? ` · ${e.occurred_at.slice(0, 10)}` : ""}</span>
        </span>
        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${restricted ? "bg-missing-soft text-missing ring-missing/20" : "bg-paper-2 text-ink-2 ring-line"}`}>
          {restricted ? <Lock className="h-3 w-3" /> : <Users className="h-3 w-3" />} {e.source.access}
        </span>
      </div>

      <pre tabIndex={0} aria-label="Source excerpt" className="scroll-quiet max-h-72 overflow-auto focus:outline-none focus-visible:ring-2 focus-visible:ring-amber/40 whitespace-pre-wrap break-words px-4 py-3.5 font-mono text-[12.5px] leading-[1.65] text-ink-2">
        {e.excerpt.truncated_start && <span className="text-muted">… </span>}
        {e.excerpt.before}
        {e.excerpt.match && (
          <mark className="rounded-[3px] bg-amber/30 px-0.5 text-ink shadow-[inset_0_-2px_0_var(--amber)]" data-testid="evidence-highlight">{e.excerpt.match}</mark>
        )}
        {e.excerpt.after}
        {e.excerpt.truncated_end && <span className="text-muted"> …</span>}
      </pre>

      <div className="grid grid-cols-1 gap-px border-t border-line bg-line text-xs sm:grid-cols-2">
        <div className="flex items-start gap-2 bg-card px-4 py-2.5">
          {e.quote_found ? <CheckCircle2 className="mt-px h-3.5 w-3.5 shrink-0 text-verified" /> : <XCircle className="mt-px h-3.5 w-3.5 shrink-0 text-missing" />}
          <span>
            <span className="font-semibold text-ink">Quote check</span>
            <span className={`block ${e.quote_found ? "text-verified" : "text-missing"}`}>
              {e.quote_found ? `Found verbatim in the source (match ${e.match_score})` : `Not in the source (best match ${e.match_score})`}
            </span>
          </span>
        </div>
        <div className="flex items-start gap-2 bg-card px-4 py-2.5">
          {e.quote_found ? <Quote className={`mt-px h-3.5 w-3.5 shrink-0 ${v.cls}`} /> : <CircleSlash className="mt-px h-3.5 w-3.5 shrink-0 text-muted" />}
          <span>
            <span className="font-semibold text-ink">Independent verifier</span>
            <span className={`block ${e.quote_found ? v.cls : "text-muted"}`}>{e.quote_found ? `Excerpt ${v.label}` : "Not run: the quote failed"}</span>
            {e.verdict_reason && e.quote_found && <span className="mt-0.5 block italic text-muted">“{e.verdict_reason}”</span>}
          </span>
        </div>
      </div>
      {!e.quote_found && (
        <p className="border-t border-line bg-missing-soft/60 px-4 py-2.5 text-xs text-missing">
          The AI cited “{e.quote}”, but that text isn&apos;t in the source, so it can&apos;t support the claim.
        </p>
      )}
      {url && (
        <p className="flex items-center gap-1.5 border-t border-line px-4 py-2 text-[11px] text-muted">
          <ExternalLink className="h-3 w-3" /> <span className="truncate font-mono">{url.replace(/^https?:\/\//, "")}</span>
        </p>
      )}
    </div>
  );
}
