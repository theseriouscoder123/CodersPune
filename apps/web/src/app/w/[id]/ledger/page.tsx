"use client";

import { ArrowRight, Check, Clock, RefreshCw, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { CoachBar } from "@/components/CoachBar";
import { STATUS_HELP, STATUS_META, STATUS_ORDER, StatusChip } from "@/components/ledger/StatusChip";
import { NotForPersona } from "@/components/workspace/NotForPersona";
import { useWorkspace } from "@/components/workspace/WorkspaceShell";
import { Alert, Button, ButtonLink, Card, Modal, PageHeader, Skeleton } from "@/components/ui";
import { api, type ClaimSummary, type Ledger, type RunInfo } from "@/lib/api";
import { useApi } from "@/lib/useApi";

export default function LedgerPage() {
  const { ws } = useWorkspace();
  const router = useRouter();
  const canSee = ws.persona.roles.some((r) => ["reviewer", "admin", "leaver"].includes(r));
  const ledger = useApi<Ledger>(canSee ? `/workspaces/${ws.id}/claims` : null);
  const run = useApi<{ run: RunInfo | null }>(canSee ? `/workspaces/${ws.id}/runs/latest` : null);
  const timeline = useApi<{ events: ClaimSummary[] }>(canSee ? `/workspaces/${ws.id}/timeline` : null);
  const [starting, setStarting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [runOpen, setRunOpen] = useState(false);

  if (!canSee) return <NotForPersona step="The reconstructed ledger" />;

  const counts = ledger.data?.status_counts ?? {};
  const total = ledger.data?.tab_counts.all ?? 0;
  const isAdmin = ws.persona.roles.includes("admin");
  const leaver = ws.members.find((m) => m.roles.includes("leaver"))?.name ?? "the leaver";

  async function rerun(mode: "refresh" | "full") {
    setRunOpen(false);
    setStarting(true);
    setErr(null);
    try {
      const r = await api<{ run_id: string }>(`/workspaces/${ws.id}/runs`, { workspaceId: ws.id, method: "POST", body: { mode } });
      router.push(`/w/${ws.id}/runs/${r.run_id}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setStarting(false);
    }
  }

  return (
    <div>
      <CoachBar id="reconstruct" step="Step 2 · Reconstruct.">
        Baton broke the project down into single claims (decisions, owners, open work, risks) and listed what it <i>expected</i> to find
        but didn&apos;t (Missing). Every status comes from rules, not from the AI.
      </CoachBar>

      <PageHeader eyebrow="Reconstruct" title="The reconstructed ledger"
        description={<>{total} claims about {leaver}&apos;s work, each linked to evidence.</>}
        actions={<>
          {isAdmin && !ws.read_only && <Button variant="secondary" onClick={() => setRunOpen(true)} loading={starting}><RefreshCw className="h-4 w-4" /> Re-run pipeline</Button>}
          <ButtonLink href={`/w/${ws.id}/review`}>Inspect the evidence <ArrowRight className="h-4 w-4" /></ButtonLink>
        </>} />
      {err && <Alert tone="error" className="mt-4">{err}</Alert>}
      <Modal open={runOpen} onClose={() => setRunOpen(false)} label="Re-run the pipeline">
        <h2 className="font-display text-xl font-semibold text-ink">Run the pipeline again</h2>
        <p className="mt-1 text-sm text-muted">Both options keep every claim you&apos;ve reviewed. Takes a few minutes and uses the AI quota.</p>
        <div className="mt-4 grid gap-2">
          <button onClick={() => rerun("refresh")} className="lift rounded-xl border border-line bg-card p-4 text-left" data-testid="run-refresh">
            <p className="font-semibold text-ink">Refresh from sources <span className="ml-1 rounded-full bg-verified-soft px-2 py-0.5 text-[11px] text-verified">recommended</span></p>
            <p className="mt-1 text-sm text-muted">Re-fetches the repository, reads only new activity since the last run, and adds to the ledger. Existing claims stay.</p>
          </button>
          <button onClick={() => rerun("full")} className="lift rounded-xl border border-line bg-card p-4 text-left" data-testid="run-full">
            <p className="font-semibold text-ink">Full re-run</p>
            <p className="mt-1 text-sm text-muted">Re-reads everything and replaces claims nobody has reviewed yet. New claims that match reviewed ones are merged into them.</p>
          </button>
        </div>
        <div className="mt-4 flex justify-end"><Button variant="ghost" onClick={() => setRunOpen(false)}>Cancel</Button></div>
      </Modal>
      {ledger.error && <Alert tone="error" className="mt-4">{ledger.error}</Alert>}

      {/* Status overview */}
      <div className="stagger mt-7 grid grid-cols-2 gap-3 md:grid-cols-5" data-testid="status-counts">
        {STATUS_ORDER.map((s) => {
          const n = counts[s] ?? 0;
          const pct = total ? Math.round((100 * n) / total) : 0;
          return (
            <Link key={s} href={`/w/${ws.id}/review?status=${s}`} title={STATUS_HELP[s]}
              className="lift group rounded-2xl border border-line bg-card p-4">
              <StatusChip status={s} />
              {ledger.loading ? <Skeleton className="mt-3 h-9 w-12" /> : <p className="font-display mt-2 text-4xl font-semibold text-ink">{n}</p>}
              <div className="mt-2 h-1 overflow-hidden rounded-full bg-paper-2"><div className={`animate-draw h-full ${STATUS_META[s].dot}`} style={{ width: `${pct}%` }} /></div>
              <p className="mt-2 text-xs leading-snug text-muted">{STATUS_HELP[s]}</p>
            </Link>
          );
        })}
      </div>

      {ledger.data && (
        <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
          <span className="text-muted">By type:</span>
          {Object.entries(ledger.data.type_counts).sort((a, b) => b[1] - a[1]).map(([t, n]) => (
            <Link key={t} href={`/w/${ws.id}/review?type=${t}`} className="rounded-full bg-card px-3 py-1 capitalize text-ink-2 ring-1 ring-line transition hover:ring-ink/30">
              {t.replace("_", " ")} <b className="ml-0.5 text-ink">{n}</b>
            </Link>
          ))}
        </div>
      )}

      <div className="mt-9 grid gap-6 lg:grid-cols-[1fr_340px]">
        <section>
          <h2 className="font-display text-xl font-semibold text-ink">Decision timeline</h2>
          <p className="text-sm text-muted">In date order. A reversed decision stays visible and is marked superseded, not treated as a contradiction.</p>
          {timeline.loading && <div className="mt-5 space-y-3">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-14" />)}</div>}
          <ol className="stagger relative mt-5 space-y-1 pl-6" data-testid="timeline">
            <span className="absolute bottom-2 left-[7px] top-2 w-px bg-line-2" aria-hidden />
            {timeline.data?.events.map((e) => (
              <li key={e.id} className="relative rounded-xl px-3 py-2.5 transition hover:bg-card">
                <span className={`absolute -left-[22px] top-4 h-3 w-3 rounded-full ring-4 ring-paper ${e.superseded_by ? "bg-line-2" : STATUS_META[e.status]?.dot ?? "bg-amber"}`} />
                <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted">
                  <span className="font-mono">{e.occurred_at?.slice(0, 10)}</span><span>·</span><span>{e.type_label}</span><span>·</span>
                  <span className="text-supported">{e.source_refs.join(", ")}</span>
                </p>
                <p className={`mt-0.5 text-[14.5px] ${e.superseded_by ? "text-muted line-through decoration-line-2" : "text-ink"}`}>{e.text}</p>
                {e.superseded_by && (
                  <p className="mt-1 inline-flex items-center gap-1.5 rounded-full bg-paper-2 px-2.5 py-0.5 text-xs font-medium text-ink-2">
                    Superseded by: {e.superseded_by_text ?? "a later decision"}
                  </p>
                )}
              </li>
            ))}
            {timeline.data && timeline.data.events.length === 0 && <li className="text-sm text-muted">No dated decisions yet.</li>}
          </ol>
        </section>

        <aside className="h-fit lg:sticky lg:top-40">
          <Card className="p-5">
            <p className="font-display text-lg font-semibold text-ink">How this ledger was built</p>
            {run.data?.run ? (
              <ol className="mt-3 space-y-3">
                {run.data.run.steps.map((s) => (
                  <li key={s.step} className="flex gap-3">
                    <span className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full ${s.status === "done" ? "bg-verified-soft text-verified" : s.status === "failed" ? "bg-missing-soft text-missing" : "bg-paper-2 text-muted"}`}>
                      {s.status === "done" ? <Check className="h-3 w-3" strokeWidth={3} /> : s.status === "failed" ? <X className="h-3 w-3" /> : <Clock className="h-3 w-3" />}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-ink">{s.label}</span>
                      {s.message && <span className="block text-xs leading-snug text-muted">{s.message}</span>}
                    </span>
                  </li>
                ))}
              </ol>
            ) : run.loading ? <Skeleton className="mt-3 h-40" /> : <p className="mt-2 text-sm text-muted">No pipeline run recorded.</p>}
            {ws.synthetic && <p className="mt-4 border-t border-line pt-3 text-xs text-muted">This demo ledger was computed in advance, so you never wait on the AI.</p>}
            {(isAdmin || ws.persona.roles.includes("reviewer")) && (
              <Link href={`/w/${ws.id}/health`} className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-supported hover:underline">View pipeline health <ArrowRight className="h-3 w-3" /></Link>
            )}
          </Card>
        </aside>
      </div>
    </div>
  );
}
