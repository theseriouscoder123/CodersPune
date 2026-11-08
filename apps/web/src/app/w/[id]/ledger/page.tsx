"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { CoachBar } from "@/components/CoachBar";
import { STATUS_HELP, STATUS_ORDER, StatusChip } from "@/components/ledger/StatusChip";
import { NotForPersona } from "@/components/workspace/NotForPersona";
import { useWorkspace } from "@/components/workspace/WorkspaceShell";
import { api, type ClaimSummary, type Ledger, type RunInfo } from "@/lib/api";
import { useApi } from "@/lib/useApi";

export default function LedgerPage() {
  const { ws } = useWorkspace();
  const router = useRouter();
  const canSee = ws.persona.roles.some((r) => ["reviewer", "admin", "leaver"].includes(r));
  const ledger = useApi<Ledger>(canSee ? `/workspaces/${ws.id}/claims` : null);
  const run = useApi<{ run: RunInfo | null }>(canSee ? `/workspaces/${ws.id}/runs/latest` : null);
  const timeline = useApi<{ events: ClaimSummary[] }>(canSee ? `/workspaces/${ws.id}/timeline` : null);
  const [starting, setStarting] = useState<string | null>(null);

  if (!canSee) return <NotForPersona step="The reconstructed ledger" />;

  const counts = ledger.data?.status_counts ?? {};
  const total = ledger.data?.tab_counts.all ?? 0;
  const isAdmin = ws.persona.roles.includes("admin");

  async function rerun() {
    setStarting("Starting…");
    try {
      const r = await api<{ run_id: string }>(`/workspaces/${ws.id}/runs`, { workspaceId: ws.id, method: "POST" });
      router.push(`/w/${ws.id}/runs/${r.run_id}`);
    } catch (e) {
      setStarting(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div>
      <CoachBar id="reconstruct">
        <b>Step 2 · Reconstruct.</b> Baton read the sources and broke the project down into single claims: decisions, owners,
        open work, risks. It also lists what it <i>expected</i> to find but didn&apos;t (Missing). Each status comes from
        rules, not from the AI.
      </CoachBar>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-navy">Reconstructed ledger</h1>
          <p className="mt-1 text-sm text-muted">{total} claims about {ws.members.find((m) => m.roles.includes("leaver"))?.name ?? "the leaver"}&apos;s work, each linked to evidence.</p>
        </div>
        <div className="flex items-center gap-2">
          {isAdmin && !ws.read_only && (
            <button onClick={rerun} className="rounded-lg border border-line px-3 py-2 text-sm font-semibold text-navy hover:bg-panel" title="Runs the AI pipeline again (takes a few minutes)">
              Re-run pipeline
            </button>
          )}
          <Link href={`/w/${ws.id}/review`} className="rounded-lg bg-navy px-4 py-2 text-sm font-semibold text-white hover:bg-navy/90">
            Inspect evidence →
          </Link>
        </div>
      </div>
      {starting && <p className="mt-2 text-sm text-rose-700">{starting}</p>}

      {ledger.error && <p className="mt-6 rounded-lg bg-rose-50 p-4 text-sm text-rose-800">{ledger.error}</p>}
      {ledger.loading && <p className="mt-6 text-muted">Loading ledger…</p>}

      {ledger.data && (
        <>
          <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-5" data-testid="status-counts">
            {STATUS_ORDER.map((s) => (
              <Link key={s} href={`/w/${ws.id}/review?status=${s}`} className="rounded-xl border border-line bg-white p-4 hover:border-navy/30" title={STATUS_HELP[s]}>
                <StatusChip status={s} />
                <p className="mt-2 text-3xl font-bold text-navy">{counts[s] ?? 0}</p>
                <p className="mt-1 text-xs leading-snug text-muted">{STATUS_HELP[s]}</p>
              </Link>
            ))}
          </div>

          <div className="mt-4 flex flex-wrap gap-2 text-xs">
            {Object.entries(ledger.data.type_counts).sort((a, b) => b[1] - a[1]).map(([t, n]) => (
              <Link key={t} href={`/w/${ws.id}/review?type=${t}`} className="rounded-full bg-panel px-3 py-1 text-navy ring-1 ring-line hover:bg-white">
                {t.replace("_", " ")} <b>{n}</b>
              </Link>
            ))}
          </div>
        </>
      )}

      <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_320px]">
        <section>
          <h2 className="text-lg font-semibold text-navy">Decision timeline</h2>
          <p className="text-sm text-muted">Decisions and changes in date order. A reversed decision is kept and marked as superseded, not treated as a contradiction.</p>
          <ol className="mt-4 space-y-3 border-l-2 border-line pl-5" data-testid="timeline">
            {timeline.data?.events.map((e) => (
              <li key={e.id} className="relative">
                <span className={`absolute -left-[27px] top-1.5 h-3 w-3 rounded-full ring-4 ring-white ${e.superseded_by ? "bg-zinc-300" : "bg-amber"}`} />
                <p className="text-xs text-muted">{e.occurred_at?.slice(0, 10)} · {e.type_label} · {e.source_refs.join(", ")}</p>
                <p className={`text-sm ${e.superseded_by ? "text-muted line-through" : "text-navy"}`}>{e.text}</p>
                {e.superseded_by && (
                  <p className="text-xs font-medium text-zinc-600">Superseded by: {e.superseded_by_text ?? "a later decision"}</p>
                )}
              </li>
            ))}
            {timeline.data && timeline.data.events.length === 0 && <li className="text-sm text-muted">No dated decisions yet.</li>}
          </ol>
        </section>

        <aside className="h-fit rounded-xl border border-line bg-panel p-4 text-sm">
          <p className="font-semibold text-navy">How this ledger was built</p>
          {run.data?.run ? (
            <ul className="mt-2 space-y-1.5">
              {run.data.run.steps.map((s) => (
                <li key={s.step} className="flex gap-2">
                  <span aria-hidden>{s.status === "done" ? "✓" : s.status === "failed" ? "✕" : "…"}</span>
                  <span>
                    <span className="font-medium text-navy">{s.label}</span>
                    {s.message && <span className="block text-xs text-muted">{s.message}</span>}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-muted">No pipeline run recorded.</p>
          )}
          {ws.synthetic && <p className="mt-3 text-xs text-muted">This demo ledger was computed in advance, so you never wait on the AI.</p>}
        </aside>
      </div>
    </div>
  );
}
