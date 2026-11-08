"use client";

import Link from "next/link";
import { useState } from "react";

import { CoachBar } from "@/components/CoachBar";
import { StatusChip } from "@/components/ledger/StatusChip";
import { NotForPersona } from "@/components/workspace/NotForPersona";
import { useWorkspace } from "@/components/workspace/WorkspaceShell";
import { api, storePersona, type HandoverRef, type Status } from "@/lib/api";
import { useApi } from "@/lib/useApi";

type Item = { id: string; type_label: string; text: string; status: Status; section: string; source_refs: string[]; reason?: string };
type Preview = { member: { id: string; name: string }; visible: Item[]; withheld: Item[]; hidden_inferred: number; show_restricted_stubs: boolean };

export default function PreviewPage() {
  const { ws } = useWorkspace();
  const isReviewer = ws.persona.roles.includes("reviewer");
  const h = useApi<{ handover: HandoverRef | null }>(isReviewer ? `/workspaces/${ws.id}/handover` : null);
  const handover = h.data?.handover;
  const pv = useApi<Preview>(handover ? `/handovers/${handover.id}/preview?as=${handover.successor_id}` : null);
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [stubs, setStubs] = useState<boolean | null>(null);
  const [done, setDone] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);

  if (!isReviewer) return <NotForPersona step="The visibility preview" />;
  if (h.data && !handover) return <p className="text-muted">No handover has been set up yet (no successor in this workspace).</p>;
  const name = handover?.successor ?? "the successor";
  const showStubs = stubs ?? handover?.show_restricted_stubs ?? false;

  async function approve() {
    setErr(null);
    try {
      const r = await api<{ version: number }>(`/handovers/${handover!.id}/approve`, {
        workspaceId: ws.id, method: "POST", body: { note: note || null, show_restricted_stubs: showStubs },
      });
      setDone(r.version);
      setOpen(false);
      h.reload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  const groups = (items: Item[]) => items.reduce<Record<string, Item[]>>((acc, it) => ((acc[it.section] ??= []).push(it), acc), {});
  const SECTION_NAMES: Record<string, string> = { start_here: "Start here", owners: "Who owns what", decisions: "Key decisions", risks: "Risks and conflicts", dependencies: "Dependencies and contacts", unresolved: "Unresolved" };

  return (
    <div>
      <CoachBar id="preview">
        <b>Step 4 · Review.</b> This is exactly what {name} will see after you approve. Anything that cites a source {name} can&apos;t
        open is withheld automatically, and inferred claims never reach the successor as fact.
      </CoachBar>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-navy">What {name} will see</h1>
          <p className="mt-1 text-sm text-muted">
            {handover?.latest_version ? `Version ${handover.latest_version} is approved. Approving again creates a new version.` : "Nothing has been approved yet, so the successor sees nothing."}
          </p>
        </div>
        <div className="flex gap-2">
          <Link href={`/w/${ws.id}/review`} className="rounded-lg border border-line px-3 py-2 text-sm font-semibold text-navy hover:bg-panel">← Back to claims</Link>
          {!ws.read_only && (
            <button onClick={() => setOpen(true)} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700" data-testid="approve-open">
              Approve handover{handover?.latest_version ? ` v${handover.latest_version + 1}` : " v1"}
            </button>
          )}
        </div>
      </div>

      {done && handover && (
        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl bg-emerald-50 p-4 text-sm text-emerald-900 ring-1 ring-emerald-200" data-testid="approved-banner">
          <span>✓ Version {done} approved. {name} can now see it.</span>
          <button className="rounded-lg bg-emerald-700 px-3 py-1.5 font-semibold text-white"
            onClick={() => {
              storePersona(ws.id, handover.successor_id);
              // Full navigation on purpose: the whole shell must reload under the new persona.
              // eslint-disable-next-line @next/next/no-location-assign-relative-destination
              window.location.href = `/w/${ws.id}/handover`;
            }}>
            Switch to {name} and open the handover →
          </button>
        </div>
      )}

      {open && (
        <div className="fixed inset-0 z-30 grid place-items-center bg-black/40 p-4" role="dialog" aria-modal>
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <h2 className="text-lg font-semibold text-navy">Approve this handover for {name}?</h2>
            <p className="mt-1 text-sm text-muted">{pv.data?.visible.length ?? 0} items will be shared. {pv.data?.withheld.length ?? 0} are withheld because they cite restricted sources.</p>
            <label className="mt-4 flex items-start gap-2 text-sm">
              <input type="checkbox" checked={showStubs} onChange={(e) => setStubs(e.target.checked)} className="mt-1" />
              <span>Show withheld items as &quot;Restricted item. Ask the reviewer&quot; stubs (no text, type or source is revealed)</span>
            </label>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Approval note (optional)" rows={2} className="mt-3 w-full rounded-lg border border-line p-2 text-sm" />
            {err && <p className="mt-2 text-sm text-rose-700">{err}</p>}
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setOpen(false)} className="rounded-lg px-3 py-2 text-sm text-muted">Cancel</button>
              <button onClick={approve} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white" data-testid="approve-confirm">Approve</button>
            </div>
          </div>
        </div>
      )}

      {pv.loading && <p className="mt-6 text-muted">Computing visibility…</p>}
      {pv.data && (
        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <section>
            <h2 className="font-semibold text-navy">{name} will see ({pv.data.visible.length})</h2>
            {Object.entries(groups(pv.data.visible)).map(([sec, items]) => (
              <div key={sec} className="mt-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted">{SECTION_NAMES[sec] ?? sec}</p>
                <ul className="mt-1 space-y-1.5">
                  {items.map((it) => (
                    <li key={it.id} className="flex items-start gap-2 rounded-lg border border-line bg-white p-2 text-sm">
                      <StatusChip status={it.status} /><span className="text-navy">{it.text}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </section>
          <section>
            <h2 className="font-semibold text-navy">Withheld from {name} ({pv.data.withheld.length})</h2>
            <ul className="mt-3 space-y-1.5" data-testid="withheld">
              {pv.data.withheld.map((it) => (
                <li key={it.id} className="rounded-lg border border-rose-200 bg-rose-50 p-2 text-sm">
                  <p className="text-navy">{it.text}</p>
                  <p className="mt-1 text-xs font-medium text-rose-800">🔒 Withheld: {it.reason}</p>
                </li>
              ))}
              {pv.data.withheld.length === 0 && <li className="text-sm text-muted">Nothing is withheld.</li>}
            </ul>
            <p className="mt-4 rounded-lg bg-panel p-3 text-xs text-muted ring-1 ring-line">
              Also not shared: {pv.data.hidden_inferred} inferred claim{pv.data.hidden_inferred === 1 ? "" : "s"} (no passing evidence). Promote one with a note on the claims page if you know it&apos;s true.
            </p>
          </section>
        </div>
      )}
    </div>
  );
}
