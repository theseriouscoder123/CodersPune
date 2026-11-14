import { ExternalLink, FileText, Hash, Lock, Users } from "lucide-react";

import type { EvidenceInfo } from "@/lib/api";

const VERDICT: Record<string, { label: string; cls: string }> = {
  supports: { label: "supports the claim", cls: "text-ver" },
  contradicts: { label: "contradicts the claim", cls: "text-con" },
  insufficient: { label: "doesn't establish the claim", cls: "text-inf" },
  pending: { label: "not checked yet", cls: "text-fg-3" },
};

type Seg = { t: string; hl: boolean };

/** before / match / after -> lines of segments, so matched lines can be highlighted and the match itself marked. */
function toLines(before: string, match: string, after: string): Seg[][] {
  const lines: Seg[][] = [[]];
  for (const seg of [{ t: before, hl: false }, { t: match, hl: true }, { t: after, hl: false }]) {
    const parts = seg.t.split("\n");
    parts.forEach((p, i) => {
      if (i > 0) lines.push([]);
      if (p) lines[lines.length - 1].push({ t: p, hl: seg.hl });
    });
  }
  return lines;
}

function SourceIcon({ kind }: { kind: string }) {
  if (kind.startsWith("chat")) return <Hash className="h-3.5 w-3.5 shrink-0 text-fg-3" aria-hidden />;
  if (kind === "file" || kind === "commit" || kind === "commit_stats") {
    return (
      <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-fg-3" aria-hidden>
        <path d="M5.5 4.5L2 8l3.5 3.5M10.5 4.5L14 8l-3.5 3.5" />
      </svg>
    );
  }
  return <FileText className="h-3.5 w-3.5 shrink-0 text-fg-3" aria-hidden />;
}

/** Evidence as a file view: path, line numbers, the matched lines highlighted, and what the checks said.
 *  `tag` is an optional right-side label in the header (e.g. "says 5 MB" when two cards disagree). */
export function EvidenceCard({ e, tag }: { e: EvidenceInfo; tag?: string | null }) {
  const url = typeof e.location?.url === "string" ? (e.location.url as string) : null;
  const restricted = e.source.access !== "All members";
  const v = VERDICT[e.verdict] ?? VERDICT.pending;
  const lines = toLines(e.excerpt.before, e.excerpt.match, e.excerpt.after);
  const first = e.excerpt.line_start ?? null;
  const path = typeof e.location?.file === "string" ? (e.location.file as string) : e.ref;
  const meta = [e.source.name !== path ? e.source.name : null, e.author, e.occurred_at ? e.occurred_at.slice(0, 10) : null].filter(Boolean).join(" · ");
  // The first highlighted segment carries the test id (the match can span several lines).
  const firstLine = lines.findIndex((segs) => segs.some((s) => s.hl));
  const firstSeg = firstLine >= 0 ? lines[firstLine].findIndex((s) => s.hl) : -1;
  return (
    <div className="flex min-w-0 flex-col overflow-hidden rounded-lg border border-line bg-bg" data-testid="evidence-card">
      <div className="flex min-w-0 items-center gap-2 border-b border-line bg-bg-sunk px-3 py-2">
        <SourceIcon kind={e.kind} />
        <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-fg" title={e.ref}>{path}</span>
        {tag && <span className="shrink-0 rounded-full bg-con-soft px-2 text-[11.5px] font-semibold leading-5 text-con">{tag}</span>}
      </div>

      <pre tabIndex={0} aria-label="Source excerpt" className="scroll-quiet max-h-72 overflow-auto py-2 font-mono text-[11.5px] leading-[19px] text-fg-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]">
        {e.excerpt.truncated_start && <div className="flex"><span className="w-[34px] shrink-0 select-none pr-2 text-right text-fg-4">…</span></div>}
        {lines.map((segs, i) => {
          const hit = segs.some((s) => s.hl);
          return (
            <div key={i} className={`flex ${hit ? "bg-hl shadow-[inset_2px_0_0_var(--hl-line)]" : ""}`}>
              <span className="w-[34px] shrink-0 select-none pr-2 text-right text-fg-4" aria-hidden>{first ? first + i : i + 1}</span>
              <span className="min-w-0 flex-1 whitespace-pre-wrap break-words pr-3">
                {segs.map((s, j) => {
                  if (!s.hl) return <span key={j}>{s.t}</span>;
                  return <mark key={j} className="bg-transparent text-fg" data-testid={i === firstLine && j === firstSeg ? "evidence-highlight" : undefined}>{s.t}</mark>;
                })}
                {segs.length === 0 && " "}
              </span>
            </div>
          );
        })}
        {e.excerpt.truncated_end && <div className="flex"><span className="w-[34px] shrink-0 select-none pr-2 text-right text-fg-4">…</span></div>}
      </pre>

      <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line px-3 py-2 text-[11.5px] text-fg-3">
        <span className="min-w-0 truncate">{meta || e.ref}</span>
        <span className={`ml-auto inline-flex items-center gap-1 ${restricted ? "text-con" : ""}`}>
          {restricted ? <Lock className="h-3 w-3" /> : <Users className="h-3 w-3" />} {e.source.access}
        </span>
      </div>
      <div className="border-t border-line px-3 py-2 text-[11.5px] leading-[17px]">
        {e.quote_found ? (
          <span className="text-fg-3">
            Quote found word for word <span className="font-mono text-fg-2">match {e.match_score}</span> · separate check:{" "}
            <span className={v.cls}>{v.label}</span>
            {e.verdict_reason && <span className="block text-fg-3">“{e.verdict_reason}”</span>}
          </span>
        ) : (
          <span className="text-mis">The AI cited “{e.quote}”, but that text isn&apos;t in the source (best match {e.match_score}), so it can&apos;t support the claim.</span>
        )}
      </div>
      {url && (
        <a href={url} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 border-t border-line px-3 py-1.5 text-[11.5px] text-fg-3 hover:text-fg">
          <ExternalLink className="h-3 w-3" /> <span className="truncate font-mono">{url.replace(/^https?:\/\//, "")}</span>
        </a>
      )}
    </div>
  );
}
