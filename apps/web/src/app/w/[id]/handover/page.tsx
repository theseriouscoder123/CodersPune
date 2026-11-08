"use client";

import { useState } from "react";

import { CoachBar } from "@/components/CoachBar";
import { EvidenceCard } from "@/components/ledger/EvidenceCard";
import { StatusChip } from "@/components/ledger/StatusChip";
import { useWorkspace } from "@/components/workspace/WorkspaceShell";
import { api, type EvidenceInfo, type HandoverItem, type HandoverRef, type HandoverView } from "@/lib/api";
import { useApi } from "@/lib/useApi";

const SECTION_STYLE: Record<string, string> = {
  unresolved: "border-rose-200 bg-rose-50/60",
  risks: "border-orange-200 bg-orange-50/40",
};

export default function HandoverPage() {
  const { ws } = useWorkspace();
  const ref = useApi<{ handover: HandoverRef | null }>(`/workspaces/${ws.id}/handover`);
  const hid = ref.data?.handover?.id;
  const view = useApi<HandoverView>(hid ? `/handovers/${hid}` : null);
  const isReviewer = ws.persona.roles.includes("reviewer");
  const versions = useApi<{ versions: { version: number; approved_by: string; approved_at: string; note: string | null; items: number; added: number; removed: number }[] }>(
    hid && isReviewer ? `/handovers/${hid}/versions` : null);
  const [drawer, setDrawer] = useState<{ item: HandoverItem; evidence: EvidenceInfo[] | null; error?: string } | null>(null);

  if (ref.data && !ref.data.handover) return <p className="text-muted">No handover is set up for this workspace.</p>;
  if (view.status === 403) return <p className="mx-auto max-w-lg rounded-xl bg-panel p-8 text-center text-navy">{view.error}</p>;
  if (view.loading || ref.loading) return <p className="text-muted">Loading handover…</p>;
  if (view.error) return <p className="text-rose-700">{view.error}</p>;
  const v = view.data!;

  async function openEvidence(item: HandoverItem) {
    setDrawer({ item, evidence: null });
    try {
      const ev = await Promise.all(item.evidence.map((e) => api<EvidenceInfo>(`/handovers/${hid}/evidence/${e.evidence_id}`, { workspaceId: ws.id })));
      setDrawer({ item, evidence: ev });
    } catch (e) {
      setDrawer({ item, evidence: [], error: e instanceof Error ? e.message : String(e) });
    }
  }

  return (
    <div>
      <CoachBar id="handover">
        <b>Step 5 · Handover.</b> This is the approved continuation plan, filtered to what {ws.persona.name} is allowed to see.
        Every item links to its evidence. Items under <b>Unresolved</b> have no answer yet, so ask before relying on them.
      </CoachBar>

      {!v.approved ? (
        <div className="mx-auto mt-10 max-w-lg rounded-2xl border border-line bg-panel p-8 text-center" data-testid="handover-pending">
          <p className="text-lg font-semibold text-navy">{v.message}</p>
          <p className="mt-2 text-sm text-muted">
            Nothing reaches the successor until a reviewer approves it. {isReviewer ? "Review the claims, preview, then approve." : "Check back soon."}
          </p>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-navy">Handover: {v.leaver} → {v.successor}</h1>
              <p className="mt-1 text-sm text-muted" data-testid="handover-meta">
                Version {v.version} · approved by {v.approved_by} on {v.approved_at.slice(0, 10)}{v.note ? ` · “${v.note}”` : ""} · viewing as {ws.persona.name}
              </p>
            </div>
            <a href={`/api/handovers/${hid}/export.md`} className="rounded-lg border border-line px-3 py-2 text-sm font-semibold text-navy hover:bg-panel"
              onClick={async (e) => {
                e.preventDefault();
                const r = await fetch(`/api/handovers/${hid}/export.md`, { headers: { "X-Baton-Persona": ws.persona.id } });
                const blob = new Blob([await r.text()], { type: "text/markdown" });
                const a = document.createElement("a");
                a.href = URL.createObjectURL(blob);
                a.download = `handover-v${v.version}.md`;
                a.click();
              }}>
              Export Markdown
            </a>
          </div>

          <div className="mt-6 grid gap-4 lg:grid-cols-2" data-testid="handover-sections">
            {v.sections.map((s) => (
              <section key={s.key} className={`rounded-xl border p-4 ${SECTION_STYLE[s.key] ?? "border-line bg-white"} ${s.key === "start_here" ? "lg:col-span-2" : ""}`} data-section={s.key}>
                <h2 className="font-semibold text-navy">{s.title} <span className="text-sm font-normal text-muted">({s.items.length})</span></h2>
                <p className="text-xs text-muted">{s.help}</p>
                <ul className="mt-3 space-y-2">
                  {s.items.length === 0 && <li className="text-sm text-muted">Nothing here.</li>}
                  {s.items.map((it, i) => it.restricted ? (
                    <li key={`r${i}`} className="rounded-lg border border-dashed border-zinc-300 bg-white p-2.5 text-sm italic text-muted">🔒 {it.text}</li>
                  ) : (
                    <li key={it.claim_id} className={`rounded-lg border border-line bg-white p-2.5 ${it.history ? "opacity-70" : ""}`}>
                      <div className="flex flex-wrap items-center gap-2">
                        <StatusChip status={it.status} promoted={!!it.flags?.reviewer_confirmed_without_evidence} />
                        <span className="text-[11px] uppercase tracking-wide text-muted">{it.type_label}</span>
                        {it.history && <span className="text-[11px] font-semibold text-zinc-500">Superseded</span>}
                      </div>
                      <p className={`mt-1 text-sm text-navy ${it.history ? "line-through" : ""}`}>{it.text}</p>
                      {it.history && it.superseded_by_text && <p className="text-xs text-muted">Replaced by: {it.superseded_by_text}</p>}
                      {it.flags?.reviewer_confirmed_without_evidence && <p className="text-xs text-muted">Reviewer-confirmed (no source evidence)</p>}
                      {it.status === "missing" && <p className="mt-1 text-xs font-medium text-rose-800">No source answers this. Ask {v.leaver} or the reviewer.</p>}
                      {it.evidence.length > 0 && (
                        <button onClick={() => openEvidence(it)} className="mt-1 text-left text-xs text-blue-700 hover:underline" data-testid="source-ref">
                          {it.evidence.map((e) => e.ref).join(" · ")} → view evidence
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>

          {versions.data && versions.data.versions.length > 0 && (
            <section className="mt-8" data-testid="versions">
              <h2 className="font-semibold text-navy">Versions</h2>
              <table className="mt-2 w-full text-left text-sm">
                <thead className="text-xs text-muted"><tr><th className="py-1">Version</th><th>Approved by</th><th>When</th><th>Items</th><th>Change vs previous</th><th>Note</th></tr></thead>
                <tbody>
                  {versions.data.versions.map((x) => (
                    <tr key={x.version} className="border-t border-line">
                      <td className="py-1.5 font-semibold">v{x.version}</td><td>{x.approved_by}</td><td>{x.approved_at.slice(0, 16).replace("T", " ")}</td>
                      <td>{x.items}</td><td>+{x.added} / −{x.removed}</td><td className="text-muted">{x.note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
        </>
      )}

      {drawer && (
        <div className="fixed inset-0 z-30 flex justify-end bg-black/30" onClick={() => setDrawer(null)}>
          <aside className="h-full w-full max-w-xl overflow-auto bg-panel p-5 shadow-xl" onClick={(e) => e.stopPropagation()} data-testid="evidence-drawer">
            <div className="flex items-start justify-between gap-3">
              <p className="font-semibold text-navy">{drawer.item.text}</p>
              <button onClick={() => setDrawer(null)} className="text-muted" aria-label="Close">✕</button>
            </div>
            <p className="mt-2 text-sm text-zinc-700"><b className="capitalize">{drawer.item.status}:</b> {drawer.item.status_reason}</p>
            <div className="mt-4 space-y-3">
              {drawer.evidence === null && <p className="text-muted">Loading evidence…</p>}
              {drawer.error && <p className="text-rose-700">{drawer.error}</p>}
              {drawer.evidence?.map((e) => <EvidenceCard key={e.id} e={e} />)}
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
