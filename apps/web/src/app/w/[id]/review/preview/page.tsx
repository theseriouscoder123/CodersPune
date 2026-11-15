"use client";

import { AlertTriangle, ArrowLeft, ArrowRight, CalendarClock, ChevronRight, Eye, EyeOff, Lock, ShieldCheck } from "lucide-react";
import { Suspense, useState } from "react";

import { CompareViews } from "@/components/ledger/CompareViews";
import { PassIcon, StatusChip } from "@/components/ledger/StatusChip";
import { useToast } from "@/components/Toast";
import { HandoverPicker, useHandoverSelection } from "@/components/workspace/HandoverPicker";
import { NotForPersona } from "@/components/workspace/NotForPersona";
import { Avatar, TopbarActions, useWorkspace } from "@/components/workspace/WorkspaceShell";
import { Alert, Button, ButtonLink, EmptyState, Modal, SkeletonList } from "@/components/ui";
import { staleTag } from "@/lib/stale";
import { api, storePersona, type HandoverCounts, type HandoverRef, type Status } from "@/lib/api";
import { useApi } from "@/lib/useApi";

type Item = { id: string; type_label: string; stale_reason?: string | null; flags?: { reviewer_confirmed_without_evidence?: boolean }; text: string; status: Status; section: string; history?: "superseded" | "stale" | null; source_refs: string[]; reason?: string;
  matters?: string | null; rerendered?: { id: string; text: string; status: Status; visible: boolean; note?: boolean } | null; rerender_tried?: boolean; rerender_note?: string | null };
type Preview = { member: { id: string; name: string }; visible: Item[]; withheld: Item[]; hidden_inferred: number; show_restricted_stubs: boolean; counts?: HandoverCounts; same_as_latest?: boolean;
  warnings?: { unresolved_conflicts: number; unreviewed: number; missing: number; source_changed?: number } };

// Long sections start folded so the preview reads as a summary; their counts stay visible.
const OPEN_BY_DEFAULT = new Set(["start_here", "risks", "unresolved"]);

const SECTION_NAMES: Record<string, string> = {
  start_here: "Start here", owners: "Who owns what", decisions: "Key decisions", risks: "Risks and conflicts",
  dependencies: "Dependencies and contacts", unresolved: "Unresolved",
};
const ORDER = Object.keys(SECTION_NAMES);

export default function PreviewPage() {
  return (
    <Suspense fallback={<SkeletonList rows={4} />}>
      <PreviewInner />
    </Suspense>
  );
}

function Stat({ n, label, tone = "fg", hint }: { n: number; label: string; tone?: "fg" | "ver" | "mis" | "fg-3"; hint?: string }) {
  const color = { fg: "text-fg", ver: "text-ver", mis: "text-mis", "fg-3": "text-fg-3" }[tone];
  return (
    <div className="px-4 py-3" title={hint}>
      <p className={`text-[22px] font-semibold leading-7 tracking-[-0.02em] ${color}`}>{n}</p>
      <p className="mt-0.5 text-[12px] leading-[16px] text-fg-3">{label}</p>
    </div>
  );
}

function PreviewInner() {
  const { ws } = useWorkspace();
  const toast = useToast();
  const isReviewer = ws.persona.roles.includes("reviewer");
  const sel = useHandoverSelection();
  const handover: HandoverRef | null = isReviewer ? sel.selected : null;
  const pv = useApi<Preview>(handover ? `/handovers/${handover.id}/preview?as=${handover.successor_id}` : null);
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [stubs, setStubs] = useState<boolean | null>(null);
  const [done, setDone] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [openSecs, setOpenSecs] = useState<Record<string, boolean>>({});

  if (!isReviewer) return <NotForPersona step="The visibility preview" who="Only the reviewer previews and approves the handover." />;
  if (!sel.loading && !handover) return <EmptyState title="No handover set up">This workspace has no successor yet.</EmptyState>;
  const name = handover?.successor ?? "the successor";
  const successor = ws.members.find((m) => m.id === handover?.successor_id);
  const showStubs = stubs ?? handover?.show_restricted_stubs ?? false;
  // The version just approved shows at once; the refreshed handover list can take a few seconds to arrive.
  const latest = Math.max(done ?? 0, handover?.latest_version ?? 0) || null;
  const nextVersion = (latest ?? 0) + 1;
  // Nothing changed since the latest approval: don't push the reviewer to approve an identical version.
  const upToDate = !!latest && (done === latest || !!pv.data?.same_as_latest);
  const viewAsSuccessor = () => {
    if (!handover) return;
    storePersona(ws.id, handover.successor_id);
    // Full navigation on purpose: the whole shell must reload under the new persona.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.href = `/w/${ws.id}/handover`;
  };

  async function approve() {
    setBusy(true);
    setErr(null);
    try {
      const r = await api<{ version: number; notified?: { to: string; channel: string; status: string }[] }>(`/handovers/${handover!.id}/approve`, {
        workspaceId: ws.id, method: "POST", body: { note: note || null, show_restricted_stubs: showStubs },
      });
      setDone(r.version);
      setOpen(false);
      const sent = (r.notified ?? []).filter((x) => x.status === "sent").map((x) => (x.channel === "slack" ? "Slack" : x.to));
      toast(`Version ${r.version} approved. ${name} can see it now${sent.length ? ` · notified ${sent.join(", ")}` : ""}`);
      sel.reload();
      pv.reload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const counts = pv.data?.counts;
  const grouped = (items: Item[]) => ORDER.map((k) => [k, items.filter((i) => i.section === k)] as const).filter(([, xs]) => xs.length);
  const w = pv.data?.warnings;
  const hasWarnings = !!w && (w.unresolved_conflicts > 0 || w.missing > 0 || (w.source_changed ?? 0) > 0);

  return (
    <div>
      <TopbarActions>
        <ButtonLink size="sm" variant="ghost" href={`/w/${ws.id}/review`}><ArrowLeft /> Back to claims</ButtonLink>
        {handover && <ButtonLink size="sm" variant="secondary" href={`/w/${ws.id}/leaving?h=${handover.id}`} data-testid="leaving-link"><CalendarClock /> Before {handover.leaver} leaves</ButtonLink>}
        {!ws.read_only && (upToDate && handover ? (
          <>
            <Button size="sm" variant="secondary" onClick={() => setOpen(true)} data-testid="approve-open" title={`Nothing has changed since version ${latest}`}><ShieldCheck /> Approve again</Button>
            <Button size="sm" onClick={viewAsSuccessor} data-testid="view-as-successor">View as {name} <ArrowRight /></Button>
          </>
        ) : <Button size="sm" onClick={() => setOpen(true)} data-testid="approve-open"><ShieldCheck /> Approve handover v{nextVersion}</Button>)}
      </TopbarActions>

      <p className="flex items-center gap-1.5 text-[12.5px] text-fg-3">
        <Eye className="h-3.5 w-3.5" /> Preview as {name} · {latest ? `v${latest} approved, v${nextVersion} would be next` : "not approved yet"}
      </p>
      <h1 className="mt-2 flex items-center gap-3 text-[28px] font-semibold leading-9 tracking-[-0.02em] text-fg">
        {successor && <Avatar m={successor} size={32} />} What {name} will see
      </h1>
      <p className="mt-2 max-w-[680px] text-[14px] leading-[22px] text-fg-2">
        {latest ? (upToDate ? `Version ${latest} is approved and up to date: nothing has changed since.` : `Version ${latest} is approved. Things have changed since, so approving again creates version ${nextVersion}.`) : "Nothing is approved yet, so the successor currently sees nothing."}{" "}
        Anything that cites a source {name} can&apos;t open is withheld automatically, and inferred claims never reach {name} as fact.
      </p>
      <HandoverPicker handovers={sel.handovers} selected={handover} onCreated={sel.reload} />
      {handover?.scope && <p className="mt-2 text-[12.5px] text-fg-3">Scope: only claims about <b className="font-medium text-fg-2">{handover.scope}</b> are included in this handover.</p>}

      {done && handover && (
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-ver-soft px-4 py-3" data-testid="approved-banner">
          <span className="flex items-center gap-2 text-[13px] font-medium text-fg"><PassIcon size={14} /> Version {done} approved. {name} can now see it.</span>
          <Button size="sm" onClick={() => {
            storePersona(ws.id, handover.successor_id);
            // Full navigation on purpose: the whole shell must reload under the new persona.
            // eslint-disable-next-line @next/next/no-location-assign-relative-destination
            window.location.href = `/w/${ws.id}/handover`;
          }}>View as {name} <ArrowRight /></Button>
        </div>
      )}

      <Modal open={open} onClose={() => setOpen(false)} label="Approve handover">
        <h2 className="flex items-center gap-2 text-[14px] font-semibold text-fg"><ShieldCheck className="h-4 w-4 text-ver" /> Approve version {nextVersion} for {name}?</h2>
        <p className="mt-1 text-[13px] text-fg-3">{name} sees this version as soon as you approve. You can approve a new version at any time.</p>
        <div className="mt-4 grid grid-cols-3 divide-x divide-line overflow-hidden rounded-lg border border-line" data-testid="approve-counts">
          <Stat n={counts?.current ?? 0} label="items shared" tone="ver" />
          <Stat n={counts?.history ?? 0} label="earlier decisions, as history" />
          <Stat n={counts?.withheld ?? 0} label="withheld (restricted)" tone="mis" />
        </div>
        {!!counts?.unconfirmed && (
          <p className="mt-2 text-[12.5px] text-fg-3" data-testid="approve-unconfirmed">
            {counts.unconfirmed} of the {counts.current} shared items passed both evidence checks (quote found word for word, and a separate check agrees) but no person has confirmed them. {name} will see them marked that way.
          </p>
        )}
        {hasWarnings && w && (
          <div className="mt-3 space-y-1 rounded-lg border border-line bg-con-soft px-3 py-2.5 text-[12.5px] text-fg-2" data-testid="approve-warnings">
            <p className="flex items-center gap-1.5 font-semibold text-con"><AlertTriangle className="h-3.5 w-3.5" /> Before you approve</p>
            {w.unresolved_conflicts > 0 && <p>· {w.unresolved_conflicts} claims are still in an unresolved conflict. They&apos;ll be shared under &quot;Risks and conflicts&quot;.</p>}
            {(w.source_changed ?? 0) > 0 && <p>· {w.source_changed} claims lost their quote when a source changed. Re-check them first.</p>}
            {w.missing > 0 && <p>· {w.missing} expected items are missing and will appear as Unresolved.</p>}
          </div>
        )}
        <label className="mt-3 flex items-start gap-2.5 rounded-lg border border-line px-3 py-2.5 text-[13px] text-fg-2">
          <input type="checkbox" checked={showStubs} onChange={(e) => setStubs(e.target.checked)} className="mt-[3px] accent-[var(--accent)]" />
          <span>Show withheld items as <i>&quot;Restricted item. Ask the reviewer&quot;</i> stubs. No text, type or source is revealed.</span>
        </label>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Approval note (optional)" rows={2} aria-label="Approval note"
          className="mt-3 w-full rounded-md border border-line bg-bg px-2.5 py-2 text-[13px] text-fg outline-none placeholder:text-fg-3 focus:border-accent focus:shadow-[0_0_0_3px_var(--ring)]" />
        {err && <Alert tone="error" className="mt-3">{err}</Alert>}
        <div className="mt-5 flex justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          <Button size="sm" loading={busy} onClick={approve} data-testid="approve-confirm">Approve and share</Button>
        </div>
      </Modal>

      {pv.loading && <div className="mt-8 grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_340px]"><SkeletonList rows={5} /><SkeletonList rows={2} /></div>}
      {pv.data && (
        <>
          <div className="mt-6 grid grid-cols-2 overflow-hidden rounded-lg border border-line sm:grid-cols-4 sm:divide-x sm:divide-line max-sm:[&>*:nth-child(n+3)]:border-t max-sm:[&>*:nth-child(even)]:border-l [&>*]:border-line">
            <Stat n={counts?.current ?? pv.data.visible.length} label={`shared with ${name}`} tone="ver" />
            <Stat n={counts?.history ?? 0} label="kept as history" hint="Reversed decisions and work that's done or parked, shown apart from current items" />
            <Stat n={pv.data.withheld.length} label="withheld, restricted source" tone="mis" hint="Cites a source this person can't open, so it is left out" />
            <Stat n={pv.data.hidden_inferred} label="inferred, not shared" tone="fg-3" hint="No quote passed both checks; never shown as fact" />
          </div>

          <div className="mt-8 grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_340px]">
            <section className="min-w-0">
              <h2 className="flex items-center gap-2 text-[16px] font-semibold tracking-[-0.01em] text-fg">
                <Eye className="h-4 w-4 text-ver" /> {name} will see <span className="text-[13px] font-normal text-fg-3">({counts ? `${counts.current}${counts.history ? ` + ${counts.history} as history` : ""}` : pv.data.visible.length})</span>
              </h2>
              <div className="mt-4 space-y-6">
                {grouped(pv.data.visible).map(([sec, items]) => {
                  const isOpen = openSecs[sec] ?? OPEN_BY_DEFAULT.has(sec);
                  return (
                  <div key={sec} data-section={sec}>
                    <button type="button" onClick={() => setOpenSecs((o) => ({ ...o, [sec]: !isOpen }))} aria-expanded={isOpen}
                      className="flex w-full items-center gap-1.5 rounded-md text-left text-[13px] font-semibold text-fg hover:text-accent-ink">
                      <ChevronRight className={`h-3.5 w-3.5 text-fg-3 transition-transform ${isOpen ? "rotate-90" : ""}`} aria-hidden />
                      {SECTION_NAMES[sec]}<span className="font-normal text-fg-3">{items.length}</span>
                    </button>
                    {isOpen && <ul className="mt-2 divide-y divide-line overflow-hidden rounded-lg border border-line">
                      {items.map((it) => (
                        <li key={it.id} className="flex items-start gap-3 px-3.5 py-2.5 text-[13px] leading-5" data-history={it.history ?? undefined}>
                          <span className="mt-px shrink-0"><StatusChip status={it.status} promoted={!!it.flags?.reviewer_confirmed_without_evidence} iconOnly /></span>
                          <span className="sr-only">{it.flags?.reviewer_confirmed_without_evidence ? "reviewer-confirmed, no source evidence" : it.status}</span>
                          <span className={`min-w-0 flex-1 ${it.history ? "text-fg-3" : "text-fg"}`}>
                            {it.history && <span className="mr-1.5 inline-flex h-[18px] items-center rounded-[4px] border border-line px-1 align-[1px] text-[10.5px] font-semibold uppercase tracking-[0.04em] text-fg-3">{it.history === "stale" ? staleTag(it.stale_reason) : "Changed later"}</span>}
                            {it.text}
                          </span>
                          <span className="hidden shrink-0 text-[12px] text-fg-3 sm:block">{it.type_label}</span>
                        </li>
                      ))}
                    </ul>}
                  </div>
                  );
                })}
              </div>
            </section>

            <aside className="min-w-0 lg:sticky lg:top-16 lg:max-h-[calc(100vh-5rem)] lg:overflow-auto lg:overscroll-contain scroll-quiet">
              <h2 className="flex items-center gap-2 text-[16px] font-semibold tracking-[-0.01em] text-fg">
                <EyeOff className="h-4 w-4 text-mis" /> Withheld from {name} <span className="text-[13px] font-normal text-fg-3">({pv.data.withheld.length})</span>
              </h2>
              <p className="mt-0.5 text-[12.5px] text-fg-3">Each cites a source {name} can&apos;t open. Fix it here or leave it withheld.</p>
              <ul className="mt-3 space-y-2" data-testid="withheld">
                {[...pv.data.withheld].sort((a, b) => Number(!!b.matters) - Number(!!a.matters)).map((it) => (
                  <WithheldItem key={it.id} it={it} name={name} wsId={ws.id} hid={handover!.id} canAct={!ws.read_only} onChanged={pv.reload} />
                ))}
                {pv.data.withheld.length === 0 && <li className="rounded-lg border border-line px-3.5 py-3 text-[13px] text-fg-3">Nothing is withheld.</li>}
              </ul>
              <div className="mt-3 rounded-lg border border-dashed border-line-2 px-3.5 py-3 text-[12.5px] leading-[18px] text-fg-3">
                <b className="font-semibold text-fg-2">Also not shared:</b> {pv.data.hidden_inferred} inferred claim{pv.data.hidden_inferred === 1 ? "" : "s"} with no passing evidence. If you know one is true,
                promote it with a note on the claims page.
              </div>
            </aside>
          </div>
        </>
      )}
      {pv.data && handover && (
        <CompareViews hid={handover.id} members={ws.members} defaultA={handover.successor_id}
          defaultB={ws.members.find((m) => m.id !== handover.successor_id && m.roles.includes("member") && !m.roles.includes("leaver") && !m.roles.includes("reviewer"))?.id
            ?? ws.members.find((m) => m.id !== handover.successor_id)!.id} />
      )}
    </div>
  );
}


/** A withheld item, with the improvement #3 fixes: rewrite it from sources the successor can read, or change access. */
function WithheldItem({ it, name, wsId, hid, canAct, onChanged }: { it: Item; name: string; wsId: string; hid: string; canAct: boolean; onChanged: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(it.rerender_tried && !it.rerendered ? (it.rerender_note ?? `Tried before: no source ${name} can read states this.`) : null);
  const [noting, setNoting] = useState(false);
  const [noteText, setNoteText] = useState("");
  async function saveNote() {
    setBusy(true);
    try {
      await api(`/handovers/${hid}/note/${it.id}`, { workspaceId: wsId, method: "POST", body: { text: noteText.trim() } });
      toast(`Note saved. ${name} sees it, marked reviewer-confirmed, in the next version you approve`);
      setNoting(false);
      onChanged();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setBusy(false);
    }
  }
  async function rewrite() {
    setBusy(true);
    try {
      const r = await api<{ status: string; reason?: string; claim_status?: string; text?: string }>(`/handovers/${hid}/rerender/${it.id}`, { workspaceId: wsId, method: "POST" });
      if (r.status === "created" || r.status === "exists") {
        toast(`Rewritten from sources ${name} can read. Approve a new version to share it`);
        onChanged();
      } else {
        setResult(r.reason ?? `No source ${name} can read states this.`);
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setBusy(false);
    }
  }
  return (
    <li className={`rounded-lg border px-3.5 py-3 text-[13px] ${it.matters ? "border-accent/50 shadow-[0_0_0_1px_var(--accent-soft)]" : "border-line"}`} data-testid="withheld-item">
      {it.matters && <p className="mb-1.5 flex items-center gap-1 text-[12px] font-medium text-accent-ink"><AlertTriangle className="h-3 w-3" /> Looks like {name}&apos;s own work · {it.matters}</p>}
      <p className="leading-5 text-fg">{it.text}</p>
      <p className="mt-1.5 flex items-start gap-1.5 text-[12px] text-mis"><Lock className="mt-0.5 h-3 w-3 shrink-0" /> {it.reason}</p>
      {it.rerendered ? (
        <div className="mt-2.5 rounded-md border border-line bg-bg-sunk px-2.5 py-2 text-[12.5px]" data-testid="rerendered">
          <p className="font-medium text-ver">{it.rerendered.note ? `Your note for ${name} (reviewer-confirmed, no source evidence)` : `Rewritten from sources ${name} can read`}</p>
          <p className="mt-0.5 text-fg">{it.rerendered.text}</p>
          <p className="mt-1 flex flex-wrap items-center gap-1.5 text-fg-3"><StatusChip status={it.rerendered.status} promoted={!!it.rerendered.note} />
            {it.rerendered.status === "inferred" ? `Not verified, so ${name} won't see it.` : it.rerendered.visible ? `${name} will see this in the next version you approve.` : ""}</p>
        </div>
      ) : canAct ? (
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          <Button size="sm" variant={it.matters ? "primary" : "secondary"} loading={busy} onClick={() => void rewrite()} data-testid="rerender">
            Rewrite from {name}&apos;s sources
          </Button>
          {it.matters && <ButtonLink size="sm" variant="ghost" href={`/w/${wsId}/sources`}>Change access</ButtonLink>}
          {it.matters && !noting && <Button size="sm" variant="ghost" onClick={() => setNoting(true)} data-testid="write-note">Write a note</Button>}
          {result && <p className="w-full text-[12px] text-fg-3" data-testid="rerender-result">{result}</p>}
          {noting && (
            <div className="w-full">
              <textarea value={noteText} onChange={(e) => setNoteText(e.target.value)} rows={2} maxLength={500} aria-label={`Note for ${name}`}
                placeholder={`What ${name} needs to know, in your words`} title="Shared with everyone who can see the handover; it cites no source"
                className="w-full rounded-md border border-line-2 bg-bg px-2.5 py-2 text-[13px] text-fg outline-none placeholder:text-fg-3 focus:border-accent focus:shadow-[0_0_0_3px_var(--ring)]" />
              <div className="mt-1.5 flex gap-1.5">
                <Button size="sm" loading={busy} disabled={noteText.trim().length < 3} onClick={() => void saveNote()} data-testid="save-note">Save note</Button>
                <Button size="sm" variant="ghost" onClick={() => setNoting(false)}>Cancel</Button>
              </div>
            </div>
          )}
        </div>
      ) : null}
    </li>
  );
}
