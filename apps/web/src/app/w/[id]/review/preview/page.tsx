"use client";

import { ArrowLeft, ArrowRight, CheckCircle2, Eye, EyeOff, Lock, ShieldCheck } from "lucide-react";
import { useState } from "react";

import { CoachBar } from "@/components/CoachBar";
import { StatusChip } from "@/components/ledger/StatusChip";
import { useToast } from "@/components/Toast";
import { NotForPersona } from "@/components/workspace/NotForPersona";
import { Avatar, useWorkspace } from "@/components/workspace/WorkspaceShell";
import { Alert, Button, ButtonLink, Card, EmptyState, Modal, PageHeader, SkeletonList } from "@/components/ui";
import { api, storePersona, type HandoverRef, type Status } from "@/lib/api";
import { useApi } from "@/lib/useApi";

type Item = { id: string; type_label: string; text: string; status: Status; section: string; source_refs: string[]; reason?: string };
type Preview = { member: { id: string; name: string }; visible: Item[]; withheld: Item[]; hidden_inferred: number; show_restricted_stubs: boolean };

const SECTION_NAMES: Record<string, string> = {
  start_here: "Start here", owners: "Who owns what", decisions: "Key decisions", risks: "Risks and conflicts",
  dependencies: "Dependencies and contacts", unresolved: "Unresolved",
};
const ORDER = Object.keys(SECTION_NAMES);

export default function PreviewPage() {
  const { ws } = useWorkspace();
  const toast = useToast();
  const isReviewer = ws.persona.roles.includes("reviewer");
  const h = useApi<{ handover: HandoverRef | null }>(isReviewer ? `/workspaces/${ws.id}/handover` : null);
  const handover = h.data?.handover;
  const pv = useApi<Preview>(handover ? `/handovers/${handover.id}/preview?as=${handover.successor_id}` : null);
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [stubs, setStubs] = useState<boolean | null>(null);
  const [done, setDone] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (!isReviewer) return <NotForPersona step="The visibility preview" />;
  if (h.data && !handover) return <EmptyState title="No handover set up">This workspace has no successor yet.</EmptyState>;
  const name = handover?.successor ?? "the successor";
  const successor = ws.members.find((m) => m.id === handover?.successor_id);
  const showStubs = stubs ?? handover?.show_restricted_stubs ?? false;
  const nextVersion = (handover?.latest_version ?? 0) + 1;

  async function approve() {
    setBusy(true);
    setErr(null);
    try {
      const r = await api<{ version: number }>(`/handovers/${handover!.id}/approve`, {
        workspaceId: ws.id, method: "POST", body: { note: note || null, show_restricted_stubs: showStubs },
      });
      setDone(r.version);
      setOpen(false);
      toast(`Version ${r.version} approved. ${name} can see it now`);
      h.reload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const grouped = (items: Item[]) => ORDER.map((k) => [k, items.filter((i) => i.section === k)] as const).filter(([, xs]) => xs.length);

  return (
    <div>
      <CoachBar id="preview" step="Step 4 · Review.">
        This is exactly what {name} will see after you approve. Anything that cites a source {name} can&apos;t open is withheld
        automatically, and inferred claims never reach the successor as fact.
      </CoachBar>

      <PageHeader eyebrow="Review" title={<span className="flex items-center gap-3">{successor && <Avatar m={successor} size={36} />} What {name} will see</span>}
        description={handover?.latest_version ? `Version ${handover.latest_version} is approved. Approving again creates version ${nextVersion}.` : "Nothing is approved yet, so the successor currently sees nothing."}
        actions={<>
          <ButtonLink href={`/w/${ws.id}/review`} variant="secondary"><ArrowLeft className="h-4 w-4" /> Back to claims</ButtonLink>
          {!ws.read_only && <Button variant="success" onClick={() => setOpen(true)} data-testid="approve-open"><ShieldCheck className="h-4 w-4" /> Approve handover v{nextVersion}</Button>}
        </>} />

      {done && handover && (
        <div className="animate-pop mt-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-verified/25 bg-verified-soft px-5 py-4" data-testid="approved-banner">
          <span className="flex items-center gap-2 text-sm font-medium text-verified"><CheckCircle2 className="h-5 w-5" /> Version {done} approved. {name} can now see it.</span>
          <Button variant="success" size="sm" onClick={() => {
            storePersona(ws.id, handover.successor_id);
            // Full navigation on purpose: the whole shell must reload under the new persona.
            // eslint-disable-next-line @next/next/no-location-assign-relative-destination
            window.location.href = `/w/${ws.id}/handover`;
          }}>View as {name} <ArrowRight className="h-4 w-4" /></Button>
        </div>
      )}

      <Modal open={open} onClose={() => setOpen(false)} label="Approve handover">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-full bg-verified-soft text-verified"><ShieldCheck className="h-5 w-5" /></span>
          <h2 className="font-display text-xl font-semibold text-ink">Approve version {nextVersion} for {name}?</h2>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2 text-center">
          <div className="rounded-xl bg-verified-soft p-3"><p className="font-display text-2xl font-semibold text-verified">{pv.data?.visible.length ?? 0}</p><p className="text-xs text-verified">items shared</p></div>
          <div className="rounded-xl bg-missing-soft p-3"><p className="font-display text-2xl font-semibold text-missing">{pv.data?.withheld.length ?? 0}</p><p className="text-xs text-missing">withheld (restricted)</p></div>
        </div>
        <label className="mt-4 flex items-start gap-2.5 rounded-xl border border-line p-3 text-sm text-ink-2">
          <input type="checkbox" checked={showStubs} onChange={(e) => setStubs(e.target.checked)} className="mt-0.5 accent-[var(--ink)]" />
          <span>Show withheld items as <i>&quot;Restricted item. Ask the reviewer&quot;</i> stubs. No text, type or source is revealed.</span>
        </label>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Approval note (optional)" rows={2}
          className="mt-3 w-full rounded-xl border border-line bg-card p-3 text-sm outline-none focus:border-ink/30 focus:ring-2 focus:ring-amber/30" />
        {err && <Alert tone="error" className="mt-3">{err}</Alert>}
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          <Button variant="success" loading={busy} onClick={approve} data-testid="approve-confirm">Approve and share</Button>
        </div>
      </Modal>

      {pv.loading && <div className="mt-7 grid gap-6 lg:grid-cols-2"><SkeletonList rows={4} /><SkeletonList rows={2} /></div>}
      {pv.data && (
        <div className="mt-7 grid gap-6 lg:grid-cols-[1.4fr_1fr]">
          <section>
            <h2 className="flex items-center gap-2 font-semibold text-ink"><Eye className="h-4 w-4 text-verified" /> {name} will see <span className="text-muted">({pv.data.visible.length})</span></h2>
            <div className="stagger mt-3 space-y-5">
              {grouped(pv.data.visible).map(([sec, items]) => (
                <div key={sec}>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">{SECTION_NAMES[sec]} · {items.length}</p>
                  <ul className="mt-2 divide-y divide-line overflow-hidden rounded-2xl border border-line bg-card">
                    {items.map((it) => (
                      <li key={it.id} className="flex items-start gap-3 px-4 py-2.5 text-sm">
                        <StatusChip status={it.status} /><span className="text-ink">{it.text}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </section>
          <section className="lg:sticky lg:top-40 lg:h-fit">
            <h2 className="flex items-center gap-2 font-semibold text-ink"><EyeOff className="h-4 w-4 text-missing" /> Withheld from {name} <span className="text-muted">({pv.data.withheld.length})</span></h2>
            <ul className="stagger mt-3 space-y-2" data-testid="withheld">
              {pv.data.withheld.map((it) => (
                <li key={it.id} className="rounded-2xl border border-missing/20 bg-missing-soft/50 p-3.5 text-sm">
                  <p className="text-ink">{it.text}</p>
                  <p className="mt-1.5 flex items-center gap-1.5 text-xs font-medium text-missing"><Lock className="h-3 w-3" /> {it.reason}</p>
                </li>
              ))}
              {pv.data.withheld.length === 0 && <li className="rounded-2xl border border-line bg-card p-4 text-sm text-muted">Nothing is withheld.</li>}
            </ul>
            <Card className="mt-4 p-4 text-xs leading-relaxed text-muted">
              <b className="text-ink">Also not shared:</b> {pv.data.hidden_inferred} inferred claim{pv.data.hidden_inferred === 1 ? "" : "s"} with no passing evidence. If you know one is true,
              promote it with a note on the claims page.
            </Card>
          </section>
        </div>
      )}
    </div>
  );
}
