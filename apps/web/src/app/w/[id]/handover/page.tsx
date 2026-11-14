"use client";

import { ArrowRight, CalendarClock, CalendarDays, Check, ChevronDown, Download, FileText, Hash, Hourglass, Lock, Printer, ShieldCheck, UserCheck, UserMinus, UserPlus, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";

import { AckControls, AckProgress, ReviewerQuestions, type AcksOut } from "@/components/ledger/Acks";
import { AskHandover } from "@/components/ledger/AskHandover";
import { EvidenceCard } from "@/components/ledger/EvidenceCard";
import { HandoverChanges } from "@/components/ledger/HandoverChanges";
import { STATUS_META, StatusChip, StatusIcon } from "@/components/ledger/StatusChip";
import { HandoverPicker, useHandoverSelection } from "@/components/workspace/HandoverPicker";
import { Avatar, TopbarActions, useWorkspace } from "@/components/workspace/WorkspaceShell";
import { Alert, Button, ButtonLink, Drawer, EmptyState, IconButton, PropertyList, SkeletonList, Spinner } from "@/components/ui";
import { api, type EvidenceInfo, type HandoverItem, type HandoverView, type Member, type SourceInfo } from "@/lib/api";
import { useApi } from "@/lib/useApi";

const SHOW_FIRST: Record<string, number> = { start_here: 5, decisions: 6, risks: 4 };

function fmtDate(iso: string, withTime = false) {
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return d.toLocaleString(undefined, withTime ? { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }
    : { day: "numeric", month: "short", year: "numeric" });
}
const shortDate = (iso: string) => new Date(iso.length === 10 ? `${iso}T00:00:00` : iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });
function daysUntil(iso: string) {
  const a = new Date(`${iso}T00:00:00`).getTime();
  const t = new Date();
  const b = new Date(t.getFullYear(), t.getMonth(), t.getDate()).getTime();
  return Math.round((a - b) / 86_400_000);
}
function ago(iso: string) {
  const d = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000));
  return d === 0 ? "today" : d === 1 ? "yesterday" : `${d} days ago`;
}
const DEADLINE = /\b(?:before|by|until|due)\s+(\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,2})/i;
const personIn = (text: string, members: Member[]) => members
  .map((m) => ({ m, at: text.search(new RegExp(`\\b${m.name}\\b`)) })).filter((x) => x.at >= 0).sort((a, b) => a.at - b.at)[0]?.m;

type Versions = { versions: { version: number; approved_by: string; approved_at: string; note: string | null; items: number; added: number; removed: number }[] };

export default function HandoverPage() {
  return (
    <Suspense fallback={<SkeletonList rows={4} />}>
      <HandoverInner />
    </Suspense>
  );
}

function HandoverInner() {
  const { ws, switchPersona } = useWorkspace();
  const router = useRouter();
  const sel = useHandoverSelection();
  const hid = sel.selected?.id;
  const view = useApi<HandoverView>(hid ? `/handovers/${hid}` : null);
  const isReviewer = ws.persona.roles.includes("reviewer");
  const versions = useApi<Versions>(hid && isReviewer ? `/handovers/${hid}/versions` : null);
  const isSuccessor = !!sel.selected && ws.persona.roles.includes("successor");
  const acks = useApi<AcksOut>(hid && (isReviewer || isSuccessor) && view.data?.approved ? `/handovers/${hid}/acks` : null);
  const sources = useApi<{ sources: SourceInfo[] }>(view.data?.approved ? `/workspaces/${ws.id}/sources` : null);
  const [drawer, setDrawer] = useState<{ item: HandoverItem; evidence: EvidenceInfo[] | null; error?: string } | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const exportRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!exportOpen) return;
    const close = (e: MouseEvent) => exportRef.current && !exportRef.current.contains(e.target as Node) && setExportOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [exportOpen]);

  if (!sel.loading && !sel.selected) return <div className="mx-auto max-w-lg pt-6"><EmptyState title="No handover for you yet">There is no handover addressed to {ws.persona.name} in this workspace.</EmptyState></div>;
  if (view.status === 403) return <div className="mx-auto max-w-lg pt-6"><EmptyState icon={<Lock />} title="Not shared with you">{view.error}</EmptyState></div>;
  if (view.loading || sel.loading || !view.data) return view.error ? <Alert tone="error">{view.error}</Alert> : <SkeletonList rows={4} />;
  const v = view.data;

  async function openEvidence(item: HandoverItem) {
    setDrawer({ item, evidence: null });
    try {
      const ev = await Promise.all(item.evidence.map((e) => api<EvidenceInfo>(`/handovers/${hid}/evidence/${e.evidence_id}`, { workspaceId: ws.id })));
      setDrawer({ item, evidence: ev });
    } catch (e) {
      setDrawer({ item, evidence: [], error: e instanceof Error ? e.message : String(e) });
    }
  }

  async function exportMd(version: number) {
    setExporting(true);
    setExportOpen(false);
    try {
      const r = await fetch(`/api/handovers/${hid}/export.md`, { headers: { "X-Baton-Persona": ws.persona.id } });
      const blob = new Blob([await r.text()], { type: "text/markdown" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `handover-v${version}.md`;
      a.click();
    } finally {
      setExporting(false);
    }
  }

  const leaver = ws.members.find((m) => m.roles.includes("leaver"));
  const reviewer = ws.members.find((m) => m.roles.includes("reviewer"));
  const successor = ws.members.find((m) => m.roles.includes("successor"));

  if (!v.approved) {
    return (
      <div>
        <HandoverPicker handovers={sel.handovers} selected={sel.selected} onCreated={sel.reload} />
        <div className="mx-auto max-w-lg pt-6" data-testid="handover-pending">
          <EmptyState icon={<Hourglass />} title={isReviewer ? "Not approved yet" : v.message}>
            Nothing reaches the successor until a reviewer approves it.
            {isReviewer ? " Review the claims, preview the successor's view, then approve." : ws.synthetic ? "" : " Check back soon."}
            {isReviewer && (
              <div className="mt-4"><Button size="sm" onClick={() => router.push(`/w/${ws.id}/review/preview`)}>Preview and approve <ArrowRight /></Button></div>
            )}
            {!isReviewer && ws.synthetic && reviewer && switchPersona && (
              <div className="mt-4" data-testid="demo-approve-hint">
                <p className="text-[12.5px] text-fg-3">In this demo you can play the reviewer too.</p>
                <Button size="sm" className="mt-2" onClick={() => { switchPersona(reviewer.id); router.push(`/w/${ws.id}/review/preview`); }}>
                  Switch to {reviewer.name} and approve <ArrowRight />
                </Button>
              </div>
            )}
          </EmptyState>
        </div>
      </div>
    );
  }

  const leaveDays = v.leaves_on ? daysUntil(v.leaves_on) : null;
  const leavePill = leaveDays === null ? null : leaveDays < 0 ? "Left" : leaveDays === 0 ? "Today" : leaveDays === 1 ? "Tomorrow" : `In ${leaveDays} days`;
  const counts = v.counts;
  const workspaceName = ws.name;
  const title = sel.selected?.name && sel.selected.name !== `${v.leaver} → ${v.successor}` ? sel.selected.name : `Handing over the ${workspaceName}`;
  const you = isSuccessor ? " (you)" : "";
  const visibleSources = sources.data?.sources ?? [];
  const restrictedCount = v.withheld_count ?? 0;
  const unresolved = v.sections.find((s) => s.key === "unresolved");
  const openUnknown = unresolved?.items.filter((i) => !i.restricted).length ?? 0;

  const itemMeta = (it: HandoverItem) => (
    <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px] text-fg-3">
      <span className="inline-flex items-center gap-1.5"><StatusIcon status={it.status} size={12} /> {it.type_label}</span>
      {it.status === "supported" && !it.history && <span data-testid="unconfirmed" title="The quote was found in the source and a separate AI check agrees, but no person has confirmed it">· not confirmed by a person</span>}
      {it.flags?.reviewer_confirmed_without_evidence && <span>· Reviewer-confirmed, no source evidence</span>}
      {it.evidence.length > 0 && (
        <button type="button" onClick={(e) => { e.stopPropagation(); void openEvidence(it); }} data-testid="source-ref"
          className="inline-flex min-w-0 max-w-full items-center gap-1 font-mono text-[11.5px] text-accent-ink hover:underline">
          <span className="truncate">· {[...new Set(it.evidence.map((e) => e.ref))].join(" · ")}</span>
        </button>
      )}
    </div>
  );

  const itemRow = (it: HandoverItem, key: string, hidden: boolean, extra?: React.ReactNode, aside?: React.ReactNode) => {
    const body = (
      <>
        <p className={`text-[14px] leading-[21px] ${it.history ? "text-fg-3" : "text-fg"}`}>{it.text}</p>
        {itemMeta(it)}
        {extra}
      </>
    );
    return (
      <li key={key} onClick={it.evidence.length > 0 ? () => void openEvidence(it) : undefined} data-history={it.history ? "1" : undefined}
        className={`group px-3.5 py-3 transition-colors ${it.evidence.length > 0 ? "cursor-pointer hover:bg-hover" : ""} ${hidden ? "hidden" : ""}`}>
        {acks.data && hid && isSuccessor && !it.history && it.claim_id ? (
          <AckControls hid={hid} wsId={ws.id} claimId={it.claim_id} ack={acks.data.items[it.claim_id]} canRespond={acks.data.can_respond} onChanged={acks.reload} aside={aside}>
            {body}
          </AckControls>
        ) : (
          <div className="flex items-start gap-2.5">
            <div className="min-w-0 flex-1">{body}</div>
            {aside}
          </div>
        )}
      </li>
    );
  };

  const restrictedRow = (i: number) => (
    <li key={`r${i}`} className="flex items-center gap-2 px-3.5 py-3 text-[13px] text-fg-3"><Lock className="h-3.5 w-3.5" /> Restricted item. Ask the reviewer.</li>
  );

  return (
    <div>
      <TopbarActions>
        <span className="hidden items-center gap-1 rounded-md px-2 text-[12px] text-fg-3 sm:inline-flex">v{v.version} · approved</span>
        <Button size="sm" variant="ghost" onClick={() => window.print()} data-testid="print"><Printer /> Print</Button>
        <div className="relative" ref={exportRef}>
          <Button size="sm" variant="secondary" loading={exporting} onClick={() => setExportOpen((o) => !o)} aria-haspopup="menu" aria-expanded={exportOpen}><Download /> Export <ChevronDown /></Button>
          {exportOpen && (
            <div className="absolute right-0 z-40 mt-1 w-48 overflow-hidden rounded-lg border border-line bg-bg p-1 shadow-[var(--pop)]" role="menu">
              <button role="menuitem" onClick={() => void exportMd(v.version)} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-hover"><FileText className="h-3.5 w-3.5 text-fg-3" /> Markdown (.md)</button>
              <button role="menuitem" onClick={() => { setExportOpen(false); window.print(); }} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-hover"><Printer className="h-3.5 w-3.5 text-fg-3" /> PDF (print)</button>
            </div>
          )}
        </div>
      </TopbarActions>

      {sel.handovers.length > 1 || isReviewer ? <div className="mb-5"><HandoverPicker handovers={sel.handovers} selected={sel.selected} onCreated={sel.reload} /></div> : null}

      <div className="mx-auto grid max-w-[1040px] grid-cols-1 gap-10 xl:grid-cols-[minmax(0,760px)_232px]">
        {/* ------------------------------------------------------------ document */}
        <article className="min-w-0">
          <p className="flex flex-wrap items-center gap-x-1.5 text-[12.5px] text-fg-3" data-testid="handover-meta">
            <ShieldCheck className="h-3.5 w-3.5 text-ver" />
            Approved by <b className="font-medium text-fg-2">{v.approved_by}</b> on {fmtDate(v.approved_at)} · Version {v.version}
            {counts && <span data-testid="handover-counts" title={counts.unconfirmed ? `${counts.unconfirmed} not yet confirmed by a person` : undefined}>· {counts.current} item{counts.current === 1 ? "" : "s"}{counts.history > 0 && ` · ${counts.history} kept as history`}{!!counts.withheld && ` · ${counts.withheld} restricted`}</span>}
          </p>
          <h1 className="mt-3 text-[32px] font-[650] leading-[40px] tracking-[-0.025em] text-fg">{title}</h1>
          <p className="mt-3 text-[15px] leading-[24px] text-fg-2">
            {v.leaver} {v.leaves_on ? (leaveDays !== null && leaveDays < 0 ? `left on ${shortDate(v.leaves_on)}` : `leaves on ${shortDate(v.leaves_on)}`) : "is leaving"}
            {isSuccessor ? " and you take over the project." : ` and ${v.successor} takes over the project.`}{" "}
            Everything here was checked against its source and approved by {v.approved_by}. Open any item to see the exact quote it came from.
          </p>

          <PropertyList className="mt-5" rows={[
            { icon: <UserMinus />, label: "Leaving", value: <span className="inline-flex flex-wrap items-center gap-2">{leaver && <Avatar m={leaver} size={18} />}<span>{v.leaver}</span>{v.leaves_on && <span className="text-fg-3">· last day {shortDate(v.leaves_on)}</span>}{leavePill && <span className={`rounded-full px-1.5 text-[11.5px] font-medium leading-5 ${leaveDays !== null && leaveDays <= 1 ? "bg-con-soft text-con" : "bg-hover text-fg-2"}`}>{leavePill}</span>}</span> },
            { icon: <UserPlus />, label: "Taking over", value: <span className="inline-flex items-center gap-2">{successor && <Avatar m={successor} size={18} />}{v.successor}<span className="text-fg-3">{you}</span></span> },
            { icon: <UserCheck />, label: "Reviewed by", value: <span className="inline-flex items-center gap-2">{reviewer && <Avatar m={reviewer} size={18} />}{v.approved_by}</span> },
            ...(v.withheld_count ? [{ icon: <Lock />, label: "Not shown", value: <span className="text-fg-2">{v.withheld_count} restricted item{v.withheld_count === 1 ? "" : "s"} cite a source you can&apos;t access</span> }] : []),
            ...(sel.selected?.scope ? [{ icon: <Hash />, label: "Scope", value: <span className="text-fg-2">{sel.selected.scope}</span> }] : []),
            ...(v.note ? [{ icon: <FileText />, label: "Note", value: <span className="text-fg-2">“{v.note}”</span> }] : []),
          ]} />

          {hid && <div className="mt-5"><HandoverChanges handoverId={hid} version={v.version} /></div>}
          {hid && <div className="mt-5"><AskHandover handoverId={hid} workspaceId={ws.id} onOpenEvidence={openEvidence} /></div>}
          {acks.data && isReviewer && <ReviewerQuestions acks={acks.data} wsId={ws.id} onChanged={acks.reload} />}

          <div className="mt-10 space-y-10" data-testid="handover-sections" id="acks">
            {v.sections.map((s) => {
              const real = s.items.filter((i) => !i.restricted);
              const limit = SHOW_FIRST[s.key];
              const open = expanded[s.key] || !limit;
              const hiddenFrom = (i: number) => !open && limit !== undefined && i >= limit;
              const moreCount = limit !== undefined ? Math.max(0, s.items.length - limit) : 0;
              const gotIt = acks.data && isSuccessor ? real.filter((i) => i.claim_id && acks.data!.items[i.claim_id]?.state === "acknowledged").length : null;
              const showMore = moreCount > 0 && !expanded[s.key] && (
                <button type="button" onClick={() => setExpanded((x) => ({ ...x, [s.key]: true }))} className="no-print w-full border-t border-line bg-bg-sunk px-3.5 py-2 text-left text-[12.5px] text-fg-3 hover:text-fg">
                  Show {moreCount} more
                </button>
              );
              const head = (
                <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
                  <div>
                    <h2 className="text-[18px] font-semibold tracking-[-0.015em] text-fg">{s.title} <span className="ml-1 text-[13px] font-normal text-fg-3">{s.items.length}</span></h2>
                    <p className="mt-0.5 text-[12.5px] text-fg-3">{s.help}</p>
                  </div>
                  {gotIt !== null && real.length > 0 && s.key === "start_here" && <span className="text-[12px] text-fg-3">{gotIt} of {real.length} marked got it</span>}
                  {s.key === "decisions" && counts && counts.history > 0 && <span className="text-[12px] text-fg-3">Newest first · {counts.history} changed decision{counts.history === 1 ? "" : "s"} kept as history</span>}
                </div>
              );
              if (s.key === "owners") {
                return (
                  <section key={s.key} id={s.key} data-section={s.key} className="scroll-mt-16">
                    {head}
                    <div className="overflow-hidden rounded-lg border border-line">
                      <div className="hidden grid-cols-[minmax(0,1.6fr)_minmax(0,0.9fr)_minmax(0,1fr)] gap-3 border-b border-line bg-bg-sunk px-3.5 py-2 text-[12px] font-medium text-fg-3 sm:grid">
                        <span>Area</span><span>Owner</span><span>Based on</span>
                      </div>
                      <ul className="divide-y divide-line">
                        {s.items.length === 0 && <li className="px-3.5 py-3 text-[13px] text-fg-3">Nothing here.</li>}
                        {s.items.map((it, i) => {
                          if (it.restricted) return restrictedRow(i);
                          const owner = personIn(it.text, ws.members);
                          const isLeaverOwned = owner && leaver && owner.id === leaver.id;
                          return (
                            <li key={it.claim_id} onClick={it.evidence.length > 0 ? () => void openEvidence(it) : undefined} data-history={it.history ? "1" : undefined}
                              className={`group grid grid-cols-1 gap-1 px-3.5 py-2.5 text-[13px] transition-colors sm:grid-cols-[minmax(0,1.6fr)_minmax(0,0.9fr)_minmax(0,1fr)] sm:gap-3 ${it.evidence.length ? "cursor-pointer hover:bg-hover" : ""}`}>
                              <span className="min-w-0 text-fg">{it.text}</span>
                              <span className="flex min-w-0 items-center gap-1.5 text-fg-2">
                                {owner ? <><Avatar m={owner} size={16} /> {owner.name}{isLeaverOwned && successor && <span className="text-fg-3">→ {isSuccessor ? "you" : successor.name}{v.leaves_on ? ` after ${shortDate(v.leaves_on)}` : ""}</span>}</> : <span className="text-fg-3">Not named</span>}
                              </span>
                              <span className="min-w-0">
                                {it.evidence.length > 0 ? (
                                  <button type="button" onClick={(e) => { e.stopPropagation(); void openEvidence(it); }} data-testid="source-ref" className="max-w-full truncate text-left font-mono text-[11.5px] text-accent-ink hover:underline">
                                    {[...new Set(it.evidence.map((e) => e.ref))].join(" · ")}
                                  </button>
                                ) : <span className="text-[12px] text-fg-3">No source</span>}
                              </span>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  </section>
                );
              }
              if (s.key === "decisions") {
                return (
                  <section key={s.key} id={s.key} data-section={s.key} className="scroll-mt-16">
                    {head}
                    <ul className="relative">
                      {s.items.length === 0 && <li className="text-[13px] text-fg-3">Nothing here.</li>}
                      {s.items.map((it, i) => it.restricted ? restrictedRow(i) : (
                        <li key={it.claim_id} onClick={it.evidence.length > 0 ? () => void openEvidence(it) : undefined} data-history={it.history ? "1" : undefined}
                          className={`group relative flex gap-3 rounded-md py-2 pl-1 pr-2 transition-colors ${it.evidence.length ? "cursor-pointer hover:bg-hover" : ""} ${hiddenFrom(i) ? "hidden" : ""}`}>
                          <span className="relative mt-[5px] flex w-3 shrink-0 justify-center" aria-hidden>
                            <span className={`h-[9px] w-[9px] rounded-full border-[1.5px] bg-bg ${it.history ? "border-fg-4" : it.status === "conflicting" ? "border-con" : "border-fg-3"}`} />
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="flex flex-wrap items-center gap-2 font-mono text-[11.5px] text-fg-3">
                              {it.occurred_at ? it.occurred_at.slice(0, 10) : "undated"}
                              {it.history && <span className="rounded-[4px] bg-hover px-1.5 font-sans text-[10.5px] font-semibold uppercase tracking-wide text-fg-2">{it.stale ? "Probably done" : "Changed later"}</span>}
                            </p>
                            <p className={`mt-0.5 text-[14px] leading-[21px] ${it.history ? "text-fg-3" : "text-fg"}`}>{it.text}</p>
                            {it.history && it.superseded_by_text && <p className="mt-0.5 text-[12.5px] text-fg-3">{it.superseded_on ? `Replaced on ${shortDate(it.superseded_on)} by: ` : "Replaced by: "}{it.superseded_by_text}</p>}
                            {it.stale && it.stale_reason && <p className="mt-0.5 text-[12.5px] text-fg-3" data-testid="stale-reason">{it.stale_reason}</p>}
                            {itemMeta(it)}
                          </div>
                        </li>
                      ))}
                    </ul>
                    {moreCount > 0 && !expanded[s.key] && (
                      <button type="button" onClick={() => setExpanded((x) => ({ ...x, [s.key]: true }))} className="no-print mt-1 pl-6 text-[12.5px] text-fg-3 hover:text-fg">Show {moreCount} more decisions</button>
                    )}
                  </section>
                );
              }
              if (s.key === "unresolved") {
                return (
                  <section key={s.key} id={s.key} data-section={s.key} className="scroll-mt-16">
                    {head}
                    <ul className="divide-y divide-line overflow-hidden rounded-lg border border-dashed border-line-2">
                      {s.items.length === 0 && <li className="px-3.5 py-3 text-[13px] text-fg-3">Nothing unknown. Every expected item has a source.</li>}
                      {s.items.map((it, i) => it.restricted ? restrictedRow(i) : itemRow(it, it.claim_id, false,
                        it.status === "missing" ? <p className="mt-1 text-[12px] text-mis">No source answers this. Ask {v.leaver} or {v.reviewer ?? reviewer?.name ?? "the reviewer"}.</p> : undefined,
                        <span className="mt-0.5 hidden shrink-0 items-center gap-1.5 text-[12px] text-fg-3 sm:inline-flex">
                          {leaver && <Avatar m={leaver} size={16} />}{it.asked_on ? `Asked ${ago(it.asked_on)}` : "Not asked yet"}
                        </span>))}
                    </ul>
                  </section>
                );
              }
              return (
                <section key={s.key} id={s.key} data-section={s.key} className="scroll-mt-16">
                  {head}
                  <div className="overflow-hidden rounded-lg border border-line">
                    <ul className="divide-y divide-line">
                      {s.items.length === 0 && <li className="px-3.5 py-3 text-[13px] text-fg-3">Nothing here.</li>}
                      {s.items.map((it, i) => {
                        if (it.restricted) return restrictedRow(i);
                        const due = it.text.match(DEADLINE)?.[1];
                        const owner = s.key === "start_here" ? personIn(it.text, ws.members) : undefined;
                        return itemRow(it, it.claim_id, hiddenFrom(i), undefined, (due || owner) ? (
                          <span className="mt-0.5 flex shrink-0 items-center gap-1.5">
                            {due && <span className="inline-flex items-center gap-1 rounded-[4px] border border-con/30 px-1.5 text-[11.5px] font-medium leading-5 text-con"><CalendarClock className="h-3 w-3" /> {due}</span>}
                            {owner && <span title={owner.name}><Avatar m={owner} size={18} /></span>}
                          </span>
                        ) : undefined);
                      })}
                    </ul>
                    {showMore}
                  </div>
                </section>
              );
            })}
          </div>

          {versions.data && versions.data.versions.length > 0 && (
            <section className="mt-12" data-testid="versions">
              <h2 className="text-[16px] font-semibold text-fg">Version history</h2>
              <div className="mt-3 overflow-x-auto rounded-lg border border-line">
                <table className="w-full text-left text-[13px]">
                  <thead className="border-b border-line bg-bg-sunk text-[12px] text-fg-3">
                    <tr><th className="px-3.5 py-2 font-medium">Version</th><th className="px-3 font-medium">Approved by</th><th className="px-3 font-medium">When</th><th className="px-3 font-medium" title="Current items the successor can see in that version; earlier decisions kept as history are not counted">Items for {v.successor}</th><th className="px-3 font-medium">Change</th><th className="px-3 font-medium">Note</th></tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {versions.data.versions.map((x) => (
                      <tr key={x.version}>
                        <td className="px-3.5 py-2 font-medium text-fg">v{x.version}</td><td className="px-3 text-fg-2">{x.approved_by}</td>
                        <td className="whitespace-nowrap px-3 text-[12px] text-fg-3">{fmtDate(x.approved_at, true)}</td><td className="px-3">{x.items}</td>
                        <td className="px-3 font-mono text-[12px]"><span className="text-ver">+{x.added}</span> / <span className="text-mis">−{x.removed}</span></td>
                        <td className="px-3 text-fg-3">{x.note}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </article>

        {/* ------------------------------------------------------------ right rail */}
        <aside className="no-print hidden xl:block">
          <div className="sticky top-16 space-y-6">
            {acks.data && acks.data.counts.total > 0 && <AckProgress acks={acks.data} />}
            {(isSuccessor || isReviewer) && hid && (
              <Link href={`/w/${ws.id}/first-week?h=${hid}`} data-testid="first-week-link" className="flex items-center gap-2 text-[13px] text-accent-ink hover:underline">
                <CalendarDays className="h-3.5 w-3.5" /> {isSuccessor ? "Your first week" : `${v.successor}'s first week`} <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            )}
            <nav aria-label="On this page">
              <p className="mb-1.5 text-[12px] font-medium text-fg-3">On this page</p>
              <ul className="space-y-px">
                {v.sections.map((s) => (
                  <li key={s.key}>
                    <a href={`#${s.key}`} className="flex h-7 items-center justify-between rounded-md px-2 text-[13px] text-fg-2 hover:bg-hover hover:text-fg">
                      <span className="truncate">{s.title}</span>
                      <span className={`text-[12px] ${s.key === "unresolved" && s.items.length ? "text-mis" : "text-fg-3"}`}>{s.items.length}</span>
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
            {v.leaves_on && leaveDays !== null && leaveDays >= 0 && leaveDays <= 14 && (
              <div className="rounded-lg border border-line p-3">
                <p className="flex items-center gap-2 text-[13px] font-medium text-fg">{leaver && <Avatar m={leaver} size={18} />} {v.leaver} leaves {leavePill?.toLowerCase()}</p>
                <p className="mt-1 text-[12px] leading-[17px] text-fg-3">{openUnknown} unknown{openUnknown === 1 ? "" : "s"} only {v.leaver} can answer. Ask while they&apos;re still here.</p>
                {isReviewer && hid
                  ? <ButtonLink size="sm" variant="secondary" className="mt-2.5 w-full" href={`/w/${ws.id}/leaving?h=${hid}`}>Before {v.leaver} leaves</ButtonLink>
                  : <a href="#unresolved" className="mt-2.5 flex h-7 w-full items-center justify-center rounded-md border border-line-2 text-[13px] font-medium text-fg hover:bg-hover">See what to ask {v.leaver}</a>}
              </div>
            )}
            {visibleSources.length > 0 && (
              <div>
                <p className="mb-1.5 text-[12px] font-medium text-fg-3">Sources you can see</p>
                <ul className="space-y-1 text-[12.5px] text-fg-2">
                  {visibleSources.map((s) => (
                    <li key={s.id} className="flex items-center gap-1.5 truncate">{s.type === "chat_export" ? <Hash className="h-3 w-3 text-fg-3" /> : <FileText className="h-3 w-3 text-fg-3" />}<span className="truncate font-mono text-[11.5px]">{s.name}</span></li>
                  ))}
                  {restrictedCount > 0 && <li className="flex items-center gap-1.5 text-fg-3"><Lock className="h-3 w-3" /> {restrictedCount} restricted item{restrictedCount === 1 ? "" : "s"}</li>}
                </ul>
              </div>
            )}
          </div>
        </aside>
      </div>

      {/* on narrower screens, the rail's progress and first-week link sit above the sections */}
      <div className="no-print fixed bottom-4 right-4 z-20 xl:hidden">
        {(isSuccessor || isReviewer) && hid && (
          <ButtonLink size="sm" variant="secondary" href={`/w/${ws.id}/first-week?h=${hid}`} className="shadow-[var(--pop)]">
            <CalendarDays /> First week
          </ButtonLink>
        )}
      </div>

      <Drawer open={!!drawer} onClose={() => setDrawer(null)} label="Evidence">
        {drawer && (
          <div data-testid="evidence-drawer">
            <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
              <div className="min-w-0">
                <StatusChip status={drawer.item.status} size="md" promoted={!!drawer.item.flags?.reviewer_confirmed_without_evidence} />
                <p className="mt-2 text-[16px] font-semibold leading-6 text-fg">{drawer.item.text}</p>
              </div>
              <IconButton onClick={() => setDrawer(null)} aria-label="Close"><X /></IconButton>
            </div>
            <div className="space-y-3 px-5 py-4">
              <p className="text-[13px] leading-5 text-fg-3"><span className={`font-medium ${STATUS_META[drawer.item.status].text}`}>Why {STATUS_META[drawer.item.status].label.toLowerCase()}:</span> {drawer.item.status_reason}</p>
              {drawer.evidence === null && <p className="flex items-center gap-2 text-[13px] text-fg-3"><Spinner className="h-3.5 w-3.5" /> Loading evidence…</p>}
              {drawer.error && <Alert tone="error">{drawer.error}</Alert>}
              {drawer.evidence?.map((e) => <EvidenceCard key={e.id} e={e} />)}
              {drawer.evidence && drawer.evidence.length === 0 && !drawer.error && <p className="text-[13px] text-fg-3"><Check className="mr-1 inline h-3.5 w-3.5" />No source evidence (reviewer-confirmed).</p>}
            </div>
          </div>
        )}
      </Drawer>
    </div>
  );
}
