import type { EvidenceInfo } from "@/lib/api";

const VERDICT_STYLE: Record<string, string> = {
  supports: "text-emerald-700",
  contradicts: "text-orange-700",
  insufficient: "text-zinc-600",
  pending: "text-zinc-500",
};

export function EvidenceCard({ e }: { e: EvidenceInfo }) {
  const url = typeof e.location?.url === "string" ? (e.location.url as string) : null;
  return (
    <div className="rounded-xl border border-line bg-white p-4" data-testid="evidence-card">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
        <span>
          <span className="font-semibold text-navy">{e.ref}</span> · {e.source.name}
          {e.author ? ` · ${e.author}` : ""}
          {e.occurred_at ? ` · ${e.occurred_at.slice(0, 10)}` : ""}
        </span>
        <span className="rounded-full bg-panel px-2 py-0.5 ring-1 ring-line">Visible to: {e.source.access}</span>
      </div>
      <pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-panel p-3 font-mono text-[12.5px] leading-relaxed text-zinc-700">
        {e.excerpt.truncated_start && "…"}
        {e.excerpt.before}
        {e.excerpt.match && <mark className="rounded bg-amber/40 px-0.5 text-navy" data-testid="evidence-highlight">{e.excerpt.match}</mark>}
        {e.excerpt.after}
        {e.excerpt.truncated_end && "…"}
      </pre>
      <dl className="mt-3 grid gap-1 text-xs sm:grid-cols-2">
        <div>
          <dt className="inline text-muted">Quote check: </dt>
          <dd className={`inline font-semibold ${e.quote_found ? "text-emerald-700" : "text-rose-700"}`}>
            {e.quote_found ? `found in source (match ${e.match_score})` : `not found (best match ${e.match_score})`}
          </dd>
        </div>
        <div>
          <dt className="inline text-muted">Separate verifier: </dt>
          <dd className={`inline font-semibold ${VERDICT_STYLE[e.verdict] ?? ""}`}>
            {!e.quote_found ? "not run (quote failed)" : e.verdict}
          </dd>
        </div>
        {e.verdict_reason && e.quote_found && <p className="text-muted sm:col-span-2">“{e.verdict_reason}”</p>}
        {!e.quote_found && (
          <p className="text-rose-700 sm:col-span-2">
            The AI cited “{e.quote}”, but that text isn&apos;t in the source, so it can&apos;t support the claim.
          </p>
        )}
      </dl>
      {url && (
        <p className="mt-2 text-[11px] text-muted">
          Source location: <span className="font-mono">{url.replace(/^https?:\/\//, "")}</span>
        </p>
      )}
    </div>
  );
}
