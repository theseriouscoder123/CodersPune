"use client";

import { ArrowRight, Gauge, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { DecisionTimeline, type RelationsOut } from "@/components/ledger/DecisionTimeline";
import { PassIcon, PendingIcon, STATUS_HELP, STATUS_META, STATUS_ORDER, StatusIcon } from "@/components/ledger/StatusChip";
import { NotForPersona } from "@/components/workspace/NotForPersona";
import { TopbarActions, useWorkspace } from "@/components/workspace/WorkspaceShell";
import { Alert, Button, ButtonLink, Modal, PageHeader, Skeleton } from "@/components/ui";
import { api, type ClaimSummary, type Ledger, type RunInfo, type SourceInfo } from "@/lib/api";
import { useApi } from "@/lib/useApi";

const BAR: Record<string, string> = { verified: "bg-ver", supported: "bg-ver/45", inferred: "bg-inf/60", conflicting: "bg-con", missing: "bg-mis" };

export default function LedgerPage() {
  const { ws } = useWorkspace();
  const router = useRouter();
  const canSee = ws.persona.roles.some((r) => ["reviewer", "admin", "leaver"].includes(r));
  const ledger = useApi<Ledger>(canSee ? `/workspaces/${ws.id}/claims` : null);
  const run = useApi<{ run: RunInfo | null }>(canSee ? `/workspaces/${ws.id}/runs/latest` : null);
  const timeline = useApi<{ events: ClaimSummary[] }>(canSee ? `/workspaces/${ws.id}/timeline` : null);
  const relations = useApi<RelationsOut>(canSee ? `/workspaces/${ws.id}/relations` : null);
  const sources = useApi<{ sources: SourceInfo[] }>(canSee ? `/workspaces/${ws.id}/sources` : null);
  const [starting, setStarting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [runOpen, setRunOpen] = useState(false);
  const [mode, setMode] = useState<"refresh" | "full">("refresh");

  if (!canSee) return <NotForPersona step="The reconstructed ledger" />;

  const counts = ledger.data?.status_counts ?? {};
  const total = ledger.data?.tab_counts.all ?? 0;
  const isAdmin = ws.persona.roles.includes("admin");
  const isReviewer = ws.persona.roles.includes("reviewer");
  const leaver = ws.members.find((m) => m.roles.includes("leaver"))?.name ?? "the leaver";
  const successor = ws.members.find((m) => m.roles.includes("successor"))?.name ?? "the successor";
  const r = run.data?.run;
  const lastRun = r?.finished_at ?? r?.started_at;
  const conflicts = counts.conflicting ?? 0;
  const missing = counts.missing ?? 0;
  const unconfirmed = ledger.data?.progress?.supported_unconfirmed ?? 0;

  async function rerun(m: "refresh" | "full") {
    setRunOpen(false);
    setStarting(true);
    setErr(null);
    try {
      const res = await api<{ run_id: string }>(`/workspaces/${ws.id}/runs`, { workspaceId: ws.id, method: "POST", body: { mode: m } });
      router.push(`/w/${ws.id}/runs/${res.run_id}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setStarting(false);
    }
  }

  return (
    <div>
      <TopbarActions>
        {(isAdmin || isReviewer) && <ButtonLink size="sm" variant="ghost" href={`/w/${ws.id}/risk`} data-testid="ledger-risk-link"><Gauge /> Knowledge risk</ButtonLink>}
        {isAdmin && !ws.read_only && <Button size="sm" variant="secondary" onClick={() => setRunOpen(true)} loading={starting}><RefreshCw /> Re-run</Button>}
        <ButtonLink size="sm" href={`/w/${ws.id}/review`}>Inspect the evidence <ArrowRight /></ButtonLink>
      </TopbarActions>

      <PageHeader title="The reconstructed ledger"
        description={<>{ledger.data ? `${total} claims` : "Claims"} about {leaver}&apos;s work, each tied to a quoted source. A status comes from fixed rules about its evidence, never from the AI. Click a number to review those claims.</>} />
      <p className="mt-2 flex flex-wrap items-center gap-x-2 text-[12.5px] text-fg-3">
        {lastRun && <span>Last run {new Date(lastRun).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>}
        {sources.data && <span>· {sources.data.sources.length} source{sources.data.sources.length === 1 ? "" : "s"}</span>}
        {ws.synthetic && <span>· Computed in advance for the demo, so you never wait on the AI</span>}
      </p>
      {err && <Alert tone="error" className="mt-4">{err}</Alert>}
      {ledger.error && <Alert tone="error" className="mt-4">{ledger.error}</Alert>}

      <Modal open={runOpen} onClose={() => setRunOpen(false)} label="Re-run the pipeline">
        <h2 className="text-[14px] font-semibold text-fg">Run the pipeline again</h2>
        <p className="mt-1 text-[13px] text-fg-3">Both options keep every claim you&apos;ve reviewed. Takes a few minutes and uses the AI quota.</p>
        <div className="mt-4 grid gap-2" role="radiogroup" aria-label="Re-run mode">
          {([["refresh", "Refresh from sources", "Re-fetches the repository, reads only new activity since the last run, and adds to the ledger. Existing claims stay.", "run-refresh", true],
             ["full", "Full re-run", "Re-reads everything and replaces claims nobody has reviewed yet. New claims that match reviewed ones are merged into them.", "run-full", false]] as const).map(([k, t, d, tid, rec]) => {
            const on = mode === k;
            return (
              <button key={k} type="button" role="radio" aria-checked={on} onClick={() => setMode(k)} onDoubleClick={() => void rerun(k)} data-testid={tid}
                className={`flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-left transition-colors ${on ? "border-accent shadow-[0_0_0_1px_var(--accent)]" : "border-line hover:bg-hover"}`}>
                <span className={`mt-0.5 grid h-3.5 w-3.5 shrink-0 place-items-center rounded-full border ${on ? "border-accent" : "border-line-2"}`}>{on && <span className="h-2 w-2 rounded-full bg-accent" />}</span>
                <span>
                  <span className="block text-[13px] font-medium text-fg">{t}{rec && <span className="ml-1.5 text-[12px] font-normal text-ver">recommended</span>}</span>
                  <span className="mt-0.5 block text-[12.5px] leading-[18px] text-fg-3">{d}</span>
                </span>
              </button>
            );
          })}
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={() => setRunOpen(false)}>Cancel</Button>
          <Button size="sm" onClick={() => void rerun(mode)} data-testid="run-start">{mode === "refresh" ? "Refresh from sources" : "Start full re-run"}</Button>
        </div>
      </Modal>

      {/* stat strip: proportional bar on top, five columns, each opening the filtered Verify view */}
      <div className="mt-6 overflow-hidden rounded-lg border border-line" data-testid="status-counts">
        <div className="flex h-2 w-full bg-hover" aria-hidden>
          {STATUS_ORDER.map((s) => <span key={s} className={BAR[s]} style={{ width: total ? `${(100 * (counts[s] ?? 0)) / total}%` : 0 }} />)}
        </div>
        <div className="grid grid-cols-2 divide-line sm:grid-cols-5 sm:divide-x [&>*]:border-line max-sm:[&>*:nth-child(n+3)]:border-t max-sm:[&>*:nth-child(even)]:border-l">
          {STATUS_ORDER.map((s) => (
            <Link key={s} href={`/w/${ws.id}/review?status=${s}`} title={STATUS_HELP[s]} className="block px-4 py-3.5 transition-colors hover:bg-hover">
              <span className="flex items-center gap-1.5 text-[12.5px] font-medium text-fg-2"><StatusIcon status={s} size={13} /> {STATUS_META[s].label}</span>
              {ledger.loading ? <Skeleton className="mt-2 h-7 w-10" /> : <p className={`mt-1 text-[26px] font-semibold leading-8 tracking-[-0.02em] ${s === "conflicting" ? "text-con" : s === "missing" ? "text-mis" : "text-fg"}`}>{counts[s] ?? 0}</p>}
              <p className="mt-1 text-[12px] leading-[17px] text-fg-3">{s === "missing" ? `${successor} will need this, but no source covers it` : s === "inferred" ? `No quote passed. Never shown to ${successor} as fact` : STATUS_HELP[s]}</p>
            </Link>
          ))}
        </div>
      </div>

      {ledger.data && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[12.5px]">
          <span className="mr-1 text-fg-3">By type</span>
          {Object.entries(ledger.data.type_counts).sort((a, b) => b[1] - a[1]).map(([t, n]) => (
            <Link key={t} href={`/w/${ws.id}/review?type=${t}`} className="inline-flex h-[26px] items-center gap-1.5 rounded-md border border-line px-2 capitalize text-fg-2 transition-colors hover:bg-hover">
              {t.replaceAll("_", " ")} <b className="font-semibold text-fg">{n}</b>
            </Link>
          ))}
        </div>
      )}

      <div className="mt-8 grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_300px]">
        <DecisionTimeline wsId={ws.id} events={timeline.data?.events} relations={relations.data} loading={timeline.loading || relations.loading}
          canEdit={isReviewer && !ws.read_only} onChanged={() => { timeline.reload(); relations.reload(); }} />

        <aside className="h-fit space-y-4 lg:sticky lg:top-16">
          <div className="overflow-hidden rounded-lg border border-line">
            <div className="flex items-center justify-between border-b border-line bg-bg-sunk px-3.5 py-2">
              <p className="flex items-center gap-2 text-[13px] font-semibold text-fg">{r?.status === "done" ? <PassIcon size={13} /> : <PendingIcon size={13} />} How this ledger was built</p>
              {r && <span className="text-[12px] text-fg-3">{r.steps.length} steps</span>}
            </div>
            {r ? (
              <ol className="divide-y divide-line">
                {r.steps.map((s) => (
                  <li key={s.step} className="flex gap-2.5 px-3.5 py-2">
                    <span className="mt-[3px]">{s.status === "done" ? <PassIcon size={12} /> : s.status === "failed" ? <StatusIcon status="missing" size={12} /> : <PendingIcon size={12} />}</span>
                    <span className="min-w-0">
                      <span className="block text-[13px] text-fg">{s.label}</span>
                      {s.message && <span className="block text-[12px] leading-[17px] text-fg-3">{s.message}</span>}
                    </span>
                  </li>
                ))}
              </ol>
            ) : run.loading ? <div className="p-3.5"><Skeleton className="h-32" /></div> : <p className="px-3.5 py-3 text-[13px] text-fg-3">No pipeline run recorded.</p>}
            {(isAdmin || isReviewer) && (
              <div className="flex items-center justify-between border-t border-line bg-bg-sunk px-3.5 py-2 text-[12px]">
                <Link href={`/w/${ws.id}/health`} className="font-medium text-accent-ink hover:underline">Pipeline health</Link>
                <span className="text-fg-3">verifier is a separate call</span>
              </div>
            )}
          </div>
          <div className="rounded-lg border border-line p-3.5">
            <p className="text-[13px] font-semibold text-fg">Next: inspect the evidence</p>
            <p className="mt-1 text-[12.5px] leading-[18px] text-fg-3">
              {conflicts + missing > 0 ? `${conflicts} conflict${conflicts === 1 ? "" : "s"} and ${missing} missing item${missing === 1 ? "" : "s"} need you first. ` : ""}
              {unconfirmed > 0 ? `${unconfirmed} supported claims are waiting for a quick confirm.` : "Open any claim to see its quote and why it got its status."}
            </p>
            <ButtonLink size="sm" href={`/w/${ws.id}/review`} className="mt-3 w-full">Open Verify</ButtonLink>
          </div>
        </aside>
      </div>
    </div>
  );
}
