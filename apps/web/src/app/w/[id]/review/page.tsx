"use client";

import { ArrowRight, Check, ChevronDown, ChevronUp, ClipboardCopy, Download, Edit3, Eye, Github, History, Inbox, Link2, ListChecks, Mic, RotateCcw, Search, Sparkles, Users, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";

import { useConfirm } from "@/components/Confirm";
import type { InterviewSummary, InterviewView } from "@/components/interview/types";
import { EvidenceCard } from "@/components/ledger/EvidenceCard";
import { PassIcon, PendingIcon, STATUS_HELP, STATUS_META, STATUS_ORDER, StatusChip, StatusIcon } from "@/components/ledger/StatusChip";
import { useToast } from "@/components/Toast";
import { NotForPersona } from "@/components/workspace/NotForPersona";
import { TopbarActions, useWorkspace } from "@/components/workspace/WorkspaceShell";
import { Alert, Button, ButtonLink, EmptyState, IconButton, Kbd, PropertyList, SkeletonList, Spinner } from "@/components/ui";
import { api, type ClaimDetail, type ClaimSummary, type EvidenceInfo, type Ledger, type Status } from "@/lib/api";
import { useApi } from "@/lib/useApi";

const TABS = [
  { key: "all", label: "All" },
  { key: "conflicts", label: "Conflicts" },
  { key: "missing", label: "Missing" },
  { key: "rejected", label: "Rejected" },
  { key: "superseded", label: "Superseded" },
] as const;

const GROUP_ORDER: Status[] = ["conflicting", "missing", "inferred", "supported", "verified", "rejected"];
const clm = (n?: number | null) => (n ? `CLM-${String(n).padStart(3, "0")}` : null);

export default function ReviewPage() {
  return (
    <Suspense fallback={<div className="p-6"><SkeletonList rows={5} /></div>}>
      <Review />
    </Suspense>
  );
}

function Review() {
  const { ws } = useWorkspace();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const tab = params.get("tab") ?? "all";
  const status = params.get("status");
  const type = params.get("type");
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<string | null>(params.get("claim"));
  // Follow ?claim= when it changes while this page is open (e.g. picked from search): adjust state during render.
  const urlClaim = params.get("claim");
  const [seenUrlClaim, setSeenUrlClaim] = useState(urlClaim);
  if (urlClaim !== seenUrlClaim) {
    setSeenUrlClaim(urlClaim);
    setSelected(urlClaim);
  }

  const canSee = ws.persona.roles.some((r) => ["reviewer", "admin", "leaver"].includes(r));
  const qs = new URLSearchParams({ tab, ...(status ? { status } : {}), ...(type ? { type } : {}) }).toString();
  const ledger = useApi<Ledger>(canSee ? `/workspaces/${ws.id}/claims?${qs}` : null);
  const toast = useToast();
  const [selectMode, setSelectMode] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [showKeys, setShowKeys] = useState(false);
  const confirmDialog = useConfirm();
  const searchRef = useRef<HTMLInputElement>(null);

  const needle = q.trim();
  // Match from the start of a word: "MB" finds "2 MB", not "December"; "upl" still finds "upload".
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const wordRe = needle ? new RegExp("(^|[^\\p{L}\\p{N}])" + escaped, "iu") : null;
  const claimsAll = (ledger.data?.claims ?? []).filter((c) => !wordRe || wordRe.test(c.text) || (clm(c.number) ?? "").toLowerCase().includes(needle.toLowerCase()));
  const currentId = selected && claimsAll.some((c) => c.id === selected) ? selected : claimsAll[0]?.id ?? null;

  const select = (id: string | undefined) => {
    if (!id) return;
    setSelected(id);
    requestAnimationFrame(() => document.getElementById(`claim-${id}`)?.scrollIntoView({ block: "nearest" }));
  };

  // Keyboard review: j/k move, c confirm, r reject, e edit, x select, ? help, / search. Ignored while typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.metaKey || e.ctrlKey || e.altKey || t.closest("input, textarea, select, [contenteditable=true]")) return;
      const idx = claimsAll.findIndex((c) => c.id === currentId);
      if (e.key === "j" || e.key === "ArrowDown") {
        const n = claimsAll[Math.min(idx + 1, claimsAll.length - 1)];
        if (n) { select(n.id); e.preventDefault(); }
      } else if (e.key === "k" || e.key === "ArrowUp") {
        const p = claimsAll[Math.max(idx - 1, 0)];
        if (p) { select(p.id); e.preventDefault(); }
      } else if (e.key === "x" && currentId) {
        setSelectMode(true);
        setPicked((s) => { const n = new Set(s); if (n.has(currentId)) n.delete(currentId); else n.add(currentId); return n; });
      } else if (e.key === "?") {
        setShowKeys((v) => !v);
      } else if (e.key === "/") {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (["c", "r", "e"].includes(e.key)) {
        window.dispatchEvent(new CustomEvent("baton:shortcut", { detail: e.key }));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!canSee) return <div className="mx-auto max-w-[1160px] px-4 py-8 sm:px-10"><NotForPersona step="The draft ledger" /></div>;

  async function bulk(action: "confirm" | "reject") {
    if (action === "reject" && !(await confirmDialog({ title: `Reject ${picked.size} claim${picked.size === 1 ? "" : "s"}?`,
      body: "Rejected claims never reach the successor. You can restore any of them later from the Rejected tab.", confirmLabel: "Reject", tone: "danger" }))) return;
    setBulkBusy(true);
    try {
      const r = await api<{ updated: number; skipped: number }>(`/workspaces/${ws.id}/claims/bulk-review`, {
        workspaceId: ws.id, method: "POST", body: { claim_ids: [...picked], action },
      });
      toast(`${action === "confirm" ? "Confirmed" : "Rejected"} ${r.updated}${r.skipped ? ` · ${r.skipped} skipped (no passing evidence or in conflict)` : ""}`);
      setPicked(new Set());
      setSelectMode(false);
      ledger.reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setBulkBusy(false);
    }
  }

  // After confirming or rejecting, open the next claim nobody has reviewed yet (in list order, wrapping around).
  const advanceFrom = (doneId: string) => {
    const i = claimsAll.findIndex((c) => c.id === doneId);
    const order = [...claimsAll.slice(i + 1), ...claimsAll.slice(0, Math.max(i, 0))];
    const next = order.find((c) => c.review_state === "none" && c.id !== doneId);
    if (next) select(next.id);
  };

  const setParam = (k: string, v: string | null) => {
    const next = new URLSearchParams(params.toString());
    if (v) next.set(k, v);
    else next.delete(k);
    if (k === "tab") {
      next.delete("status");
      next.delete("type");
    }
    setSelected(null);
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  };

  const progress = ledger.data?.progress;
  const isReviewer = ws.persona.roles.includes("reviewer");
  const successor = ws.members.find((m) => m.roles.includes("successor"))?.name ?? "the successor";
  const leaver = ws.members.find((m) => m.roles.includes("leaver"))?.name ?? "the leaver";
  const groups = GROUP_ORDER.map((s) => [s, claimsAll.filter((c) => c.status === s)] as const).filter(([, xs]) => xs.length > 0);
  const idx = claimsAll.findIndex((c) => c.id === currentId);
  const typeOptions = Object.entries(ledger.data?.type_counts ?? {}).sort((a, b) => b[1] - a[1]);

  return (
    <div className="flex h-[calc(100vh-48px)] min-h-[560px] flex-col lg:flex-row">
      <TopbarActions>
        {progress && progress.total > 0 && (
          <div className="hidden items-center gap-2 md:flex" data-testid="review-progress" title={progress.supported_unconfirmed ? `${progress.supported_unconfirmed} supported claims await confirmation` : undefined}>
            <span className="h-1.5 w-20 overflow-hidden rounded-full bg-hover" aria-hidden>
              <span className="block h-full rounded-full bg-ver" style={{ width: `${(100 * progress.reviewed) / progress.total}%` }} />
            </span>
            <span className="whitespace-nowrap text-[12px] text-fg-3"><b className="font-semibold text-fg">{progress.reviewed}</b> of {progress.total} claims reviewed</span>
            {(progress.source_changed ?? 0) > 0 && <span className="text-[12px] text-con" data-testid="source-changed-count">· {progress.source_changed} with a changed source</span>}
          </div>
        )}
        {isReviewer && !ws.read_only && (
          <Button size="sm" variant={selectMode ? "primary" : "secondary"} onClick={() => { setSelectMode((v) => !v); setPicked(new Set()); }}>
            <ListChecks /> {selectMode ? "Done" : "Select"}
          </Button>
        )}
        <IconButton aria-label="Keyboard shortcuts" title="Keyboard shortcuts (?)" onClick={() => setShowKeys((v) => !v)}><span className="text-[13px] font-semibold">?</span></IconButton>
        {isReviewer && <ButtonLink size="sm" href={`/w/${ws.id}/review/preview`}><Eye /> Preview {successor}&apos;s view</ButtonLink>}
      </TopbarActions>

      {/* ---------------------------------------------------------------- list pane */}
      <section className="flex min-h-0 w-full shrink-0 flex-col border-line lg:w-[44%] lg:max-w-[560px] lg:border-r" aria-label="Claims">
        <div className="shrink-0 space-y-2 border-b border-line px-3 pb-2.5 pt-3">
          <div className="no-scrollbar flex gap-0.5 overflow-x-auto" role="tablist">
            {TABS.map((t) => {
              const n = ledger.data?.tab_counts[t.key as keyof Ledger["tab_counts"]];
              const active = tab === t.key;
              const tone = t.key === "conflicts" && n ? "text-con" : t.key === "missing" && n ? "text-mis" : "text-fg-3";
              return (
                <button key={t.key} role="tab" aria-selected={active} onClick={() => setParam("tab", t.key)}
                  className={`inline-flex h-[26px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 text-[13px] font-medium transition-colors ${active ? "bg-active text-fg" : "text-fg-3 hover:bg-hover hover:text-fg"}`}>
                  {t.label}{n !== undefined && <span className={`text-[12px] ${tone}`}>{n}</span>}
                </button>
              );
            })}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <label className="flex h-7 min-w-[160px] flex-1 items-center gap-1.5 rounded-md border border-line-2 bg-bg px-2 focus-within:ring-2 focus-within:ring-[var(--ring)]">
              <Search className="h-3.5 w-3.5 shrink-0 text-fg-3" />
              <input ref={searchRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter by text or ID" aria-label="Search claims"
                className="min-w-0 flex-1 bg-transparent text-[13px] text-fg outline-none placeholder:text-fg-3" />
              <Kbd>/</Kbd>
            </label>
            {tab === "all" && (
              <select value={status ?? ""} onChange={(e) => setParam("status", e.target.value || null)} aria-label="Filter by status"
                className="h-7 rounded-md border border-line-2 bg-bg px-2 text-[12.5px] text-fg-2 outline-none focus:ring-2 focus:ring-[var(--ring)]">
                <option value="">Status: all</option>
                {STATUS_ORDER.map((s) => <option key={s} value={s} title={STATUS_HELP[s]}>{STATUS_META[s].label} ({ledger.data?.status_counts[s] ?? 0})</option>)}
              </select>
            )}
            <select value={type ?? ""} onChange={(e) => setParam("type", e.target.value || null)} aria-label="Filter by type"
              className="h-7 rounded-md border border-line-2 bg-bg px-2 text-[12.5px] text-fg-2 outline-none focus:ring-2 focus:ring-[var(--ring)]">
              <option value="">Type: all</option>
              {typeOptions.map(([k, n]) => <option key={k} value={k}>{k.replaceAll("_", " ")} ({n})</option>)}
            </select>
          </div>
          {(tab === "missing" || tab === "conflicts") && isReviewer && <QuestionsBar workspaceId={ws.id} readOnly={ws.read_only} leaver={leaver} />}
          {ws.read_only && <Alert tone="warn">This is the shared read-only copy. Go back to the start page and choose <b>Try the demo</b> to get your own editable copy.</Alert>}
          {showKeys && (
            <div className="flex flex-wrap gap-x-4 gap-y-1.5 rounded-md border border-line bg-bg-sunk px-3 py-2 text-[12px] text-fg-2">
              {[["j", "next"], ["k", "previous"], ["c", "confirm"], ["r", "reject"], ["e", "edit"], ["x", "select"], ["/", "search"], ["?", "this help"]].map(([k, d]) => (
                <span key={k} className="inline-flex items-center gap-1.5"><Kbd>{k}</Kbd> {d}</span>
              ))}
            </div>
          )}
          {picked.size > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-line bg-bg-sunk px-2.5 py-1.5 text-[13px]" data-testid="bulk-bar">
              <span><b className="font-semibold">{picked.size}</b> selected</span>
              <div className="flex gap-1.5">
                <Button size="sm" variant="success" loading={bulkBusy} onClick={() => bulk("confirm")}><Check /> Confirm</Button>
                <Button size="sm" variant="danger" disabled={bulkBusy} onClick={() => bulk("reject")}><X /> Reject</Button>
                <Button size="sm" variant="ghost" onClick={() => setPicked(new Set())}>Clear</Button>
              </div>
            </div>
          )}
        </div>

        <div className="scroll-quiet min-h-0 flex-1 overflow-y-auto overscroll-contain px-1.5 pb-6 pt-1 max-lg:max-h-[46vh]" data-testid="claim-list">
          {ledger.loading && <div className="p-2"><SkeletonList rows={6} /></div>}
          {ledger.error && <div className="p-2"><Alert tone="error">{ledger.error}</Alert></div>}
          {ledger.data && claimsAll.length === 0 && <div className="p-2"><EmptyState icon={<Inbox />} title="Nothing here">No claims match this view.</EmptyState></div>}
          {groups.map(([s, xs]) => {
            const confirmed = xs.filter((c) => c.review_state === "confirmed").length;
            return (
              <div key={s}>
                <div className="sticky top-0 z-[1] flex h-8 items-center gap-2 bg-bg px-2.5 text-[12.5px] font-semibold text-fg">
                  <StatusIcon status={s} size={13} /> {STATUS_META[s].label} <span className="font-normal text-fg-3">{xs.length}</span>
                  <span className="h-px flex-1 bg-line" aria-hidden />
                  {s === "missing" && isReviewer && tab !== "missing" && <button type="button" onClick={() => setParam("tab", "missing")} className="text-[12px] font-medium text-accent-ink hover:underline">Ask {leaver}</button>}
                  {(s === "supported" || s === "verified") && confirmed > 0 && <span className="text-[12px] font-normal text-fg-3">{confirmed} confirmed</span>}
                  {s === "inferred" && <span className="text-[12px] font-normal text-fg-3">Hidden from {successor}</span>}
                </div>
                <ul>
                  {xs.map((c) => (
                    <ClaimRow key={c.id} c={c} active={c.id === currentId} onClick={() => setSelected(c.id)}
                      selectable={selectMode} checked={picked.has(c.id)}
                      onToggle={() => setPicked((p) => { const n = new Set(p); if (n.has(c.id)) n.delete(c.id); else n.add(c.id); return n; })} />
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      </section>

      {/* ---------------------------------------------------------------- inspector */}
      <section className="flex min-h-0 min-w-0 flex-1 flex-col border-t border-line lg:border-t-0" aria-label="Claim">
        {currentId ? (
          <ClaimPanel key={currentId} id={currentId} position={idx + 1} total={claimsAll.length}
            onPrev={() => select(claimsAll[Math.max(idx - 1, 0)]?.id)} onNext={() => select(claimsAll[Math.min(idx + 1, claimsAll.length - 1)]?.id)}
            onChanged={ledger.reload} onReviewed={advanceFrom} />
        ) : !ledger.loading && (
          <div className="grid flex-1 place-items-center p-8 text-[13px] text-fg-3">Select a claim to inspect its evidence.</div>
        )}
      </section>
    </div>
  );
}

const REVIEW_LABEL: Record<string, string> = { confirmed: "Confirmed", edited: "Edited", promoted: "Promoted", rejected: "Rejected" };

function ClaimRow({ c, active, onClick, selectable, checked, onToggle }:
  { c: ClaimSummary; active: boolean; onClick: () => void; selectable: boolean; checked: boolean; onToggle: () => void }) {
  const ref = c.source_refs[0] ?? (c.origin === "checklist" ? "expected from the repo" : null);
  return (
    <li id={`claim-${c.id}`} className="flex items-start gap-1.5">
      {selectable && (
        <input type="checkbox" checked={checked} onChange={onToggle} aria-label="Select claim" className="ml-2 mt-3 h-3.5 w-3.5 shrink-0 accent-[var(--accent)]" />
      )}
      <button onClick={onClick} aria-current={active}
        className={`flex w-full min-w-0 items-start gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors ${active ? "bg-active" : "hover:bg-hover"}`}>
        <span className="mt-[3px]"><StatusChip status={c.status} promoted={!!c.flags?.reviewer_confirmed_without_evidence} iconOnly /></span>
        <span className="sr-only">{STATUS_META[c.status].label}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] text-fg">{c.text}</span>
          <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[12px] text-fg-3">
            {clm(c.number) && <span className="shrink-0 font-mono text-[11.5px]">{clm(c.number)}</span>}
            <span className="shrink-0">· {c.type_label}</span>
            {ref && <span className="min-w-0 truncate font-mono text-[11.5px]">· {ref}</span>}
            {c.source_changed && <span className="shrink-0 text-con" title={c.source_changed.note}>· source changed</span>}
          </span>
        </span>
        {REVIEW_LABEL[c.review_state] && <span className="mt-[1px] shrink-0 text-[12px] text-fg-3">{REVIEW_LABEL[c.review_state]}</span>}
      </button>
    </li>
  );
}

type QuestionsOut = { markdown: string; questions: unknown[]; leaver: string; issue_title: string; issue_body: string; issue_left_out?: number; issue_url?: string | null };

/** Missing and conflicting items become a gap interview for the leaver (Round 3, improvement #1). The old export
 * options stay as quiet secondary actions. */
function QuestionsBar({ workspaceId, readOnly, leaver }: { workspaceId: string; readOnly: boolean; leaver: string }) {
  const toast = useToast();
  const router = useRouter();
  const list = useApi<{ interviews: InterviewSummary[] }>(`/workspaces/${workspaceId}/interviews`);
  const [busy, setBusy] = useState<string | null>(null);
  const latest = list.data?.interviews[0];
  const open = latest && (latest.status === "draft" || latest.status === "sent") ? latest : null;
  const get = () => api<QuestionsOut>(`/workspaces/${workspaceId}/questions`, { workspaceId });
  const copyMd = async () => {
    const r = await get();
    await navigator.clipboard.writeText(r.markdown).catch(() => undefined);
    toast(`Copied ${r.questions.length} questions for ${r.leaver} as Markdown`);
  };
  const copyIssue = async () => {
    // Open the tab inside the click (pop-up blockers), then point it at the pre-filled issue once we know the URL.
    const tab = window.open("about:blank", "_blank");
    const r = await get();
    const leftOut = r.issue_left_out ? ` ${r.issue_left_out} restricted question${r.issue_left_out === 1 ? " was" : "s were"} left out, because issues can be public.` : "";
    if (r.issue_url && tab) {
      tab.opener = null;
      tab.location.href = r.issue_url;
      toast(`Opened a pre-filled issue on GitHub. Review it and click Submit there.${leftOut}`);
      return;
    }
    tab?.close();
    await navigator.clipboard.writeText(`# ${r.issue_title}\n\n${r.issue_body}`).catch(() => undefined);
    toast(`Copied as a GitHub issue (title + checklist). Paste it into a new issue.${leftOut}`);
  };
  const download = async () => {
    const r = await get();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([r.markdown], { type: "text/markdown" }));
    a.download = "questions-for-leaver.md";
    a.click();
  };
  const start = async (onBehalf: boolean) => {
    setBusy(onBehalf ? "behalf" : "start");
    try {
      const iv = await api<InterviewView>(`/workspaces/${workspaceId}/interviews`, { workspaceId, method: "POST", body: { on_behalf: onBehalf } });
      router.push(`/w/${workspaceId}/interview/${iv.id}`);
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
      setBusy(null);
    }
  };
  return (
    <div className="rounded-md border border-line bg-bg-sunk px-3 py-2.5" data-testid="questions-bar">
      <p className="flex items-start gap-2 text-[12.5px] leading-[18px] text-fg-2">
        <Mic className="mt-0.5 h-3.5 w-3.5 shrink-0 text-fg-3" />
        {open ? <span><b className="font-semibold text-fg">Gap interview {open.status === "draft" ? "drafted" : open.on_behalf ? "in progress" : `sent to ${open.respondent}`}</b> · {open.answered} of {open.total} answered</span>
          : latest?.status === "submitted" ? <span><b className="font-semibold text-fg">{latest.respondent} answered {latest.answered} of {latest.total}</b> in the gap interview. Their answers are cited leaver testimony.</span>
          : <span>Ask {leaver} about these in a short <b className="font-semibold text-fg">gap interview</b>. Answers come back as cited testimony.</span>}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {open || latest?.status === "submitted" ? (
          <ButtonLink size="sm" href={`/w/${workspaceId}/interview/${(open ?? latest)!.id}`} data-testid="open-interview">Open interview <ArrowRight /></ButtonLink>
        ) : null}
        {!open && !readOnly && (
          <>
            <Button size="sm" variant={latest ? "secondary" : "primary"} loading={busy === "start"} onClick={() => void start(false)} data-testid="start-interview">
              <Mic /> {latest ? "Ask follow-up questions" : "Prepare questions for the leaver"}
            </Button>
            {!latest && (
              <Button size="sm" variant="ghost" loading={busy === "behalf"} onClick={() => void start(true)} title="If the leaver is unavailable, answer from what you know. It is labelled as answered on their behalf.">
                Answer for them
              </Button>
            )}
          </>
        )}
        <span className="ml-auto flex items-center gap-0.5 text-[12px]">
          <button className="inline-flex h-6 items-center gap-1 rounded px-1.5 text-fg-3 hover:bg-hover hover:text-fg" onClick={() => void copyMd()} data-testid="copy-questions"><ClipboardCopy className="h-3 w-3" /> Copy</button>
          <button className="inline-flex h-6 items-center gap-1 rounded px-1.5 text-fg-3 hover:bg-hover hover:text-fg" onClick={() => void copyIssue()}><Github className="h-3 w-3" /> Issue</button>
          <button className="inline-flex h-6 items-center gap-1 rounded px-1.5 text-fg-3 hover:bg-hover hover:text-fg" onClick={() => void download()}><Download className="h-3 w-3" /> .md</button>
        </span>
      </div>
    </div>
  );
}

const ACTION_TOAST: Record<string, string> = {
  confirm: "Confirmed. The claim is now Verified",
  reject: "Claim rejected. It won't reach the successor",
  restore: "Claim restored",
  promote: "Promoted with your note",
  comment: "Comment added",
  edit: "Saved and re-verified",
};

/** One rule-check row (GitHub checks style): pass, flag (status icon on a soft row) or pending. */
function Check_({ state, status, label, measure }: { state: "pass" | "flag" | "pending"; status?: Status; label: React.ReactNode; measure?: React.ReactNode }) {
  const soft = state === "flag" && status ? STATUS_META[status].soft : "";
  return (
    <li className={`flex items-center gap-2.5 px-3.5 py-2 text-[13px] ${soft}`}>
      {state === "pass" ? <PassIcon size={14} /> : state === "pending" ? <PendingIcon size={14} /> : <StatusIcon status={status ?? "inferred"} size={14} />}
      <span className={`min-w-0 flex-1 ${state === "pending" ? "text-fg-3" : "text-fg"}`}>{label}</span>
      {measure && <span className={`shrink-0 font-mono text-[11.5px] ${state === "flag" && status ? STATUS_META[status].text : "text-fg-3"}`}>{measure}</span>}
    </li>
  );
}

function RuleChecks({ c, others, isReviewer }: { c: ClaimDetail; others: ClaimSummary[]; isReviewer: boolean }) {
  const found = c.evidence.filter((e) => e.quote_found);
  const best = c.evidence.reduce<EvidenceInfo | null>((b, e) => (!b || e.match_score > b.match_score ? e : b), null);
  const supports = found.find((e) => e.verdict === "supports");
  const contra = found.find((e) => e.verdict === "contradicts");
  const m = STATUS_META[c.status];
  const promoted = !!c.flags?.reviewer_confirmed_without_evidence;
  const rows: React.ReactNode[] = [];
  if (c.origin === "checklist" && c.evidence.length === 0) {
    rows.push(<Check_ key="cov" state="flag" status="missing" label="The repository suggests someone should know this, but no source covers it" measure="0 sources" />);
  } else if (c.evidence.length === 0) {
    rows.push(<Check_ key="q" state="flag" status={c.status === "missing" ? "missing" : "inferred"} label="No quote was cited for this claim" measure="0 quotes" />);
  } else {
    rows.push(found.length
      ? <Check_ key="q" state="pass" label="Quote found word for word in its cited source" measure={`match ${Math.max(...found.map((e) => e.match_score))} · needs ≥ 90`} />
      : <Check_ key="q" state="flag" status="inferred" label="The quote isn't in its cited source" measure={`best ${best?.match_score ?? 0} · needs ≥ 90`} />);
    if (found.length) {
      rows.push(supports ? <Check_ key="v" state="pass" label="A separate check agrees the quote supports the claim" measure="supports" />
        : contra ? <Check_ key="v" state="flag" status="conflicting" label="The separate check says the quote contradicts the claim" measure="contradicts" />
        : found.some((e) => e.verdict === "pending") ? <Check_ key="v" state="pending" label="The separate check hasn't run yet" measure="pending" />
        : <Check_ key="v" state="flag" status="inferred" label="The separate check says the quote doesn't establish the claim" measure="insufficient" />);
    }
  }
  if (c.conflict && !c.conflict.resolved) {
    const vals = [c.value, ...others.map((o) => o.value)].filter(Boolean);
    rows.push(<Check_ key="c" state="flag" status="conflicting" label="Another claim gives a different value for the same subject" measure={vals.length > 1 ? vals.join(" ≠ ") : undefined} />);
    rows.push(<Check_ key="r" state="pending" label="A reviewer resolves the conflict" measure={isReviewer ? "waiting on you" : "waiting"} />);
  } else if (c.conflict?.resolved) {
    rows.push(<Check_ key="r" state="pass" label="A reviewer resolved the conflict" measure="resolved" />);
  } else if (promoted) {
    rows.push(<Check_ key="p" state="pass" label="A reviewer confirmed it without source evidence, with a note" measure="promoted" />);
  } else if (c.status !== "missing" && c.status !== "rejected") {
    rows.push(c.review_state === "confirmed" || c.review_state === "edited"
      ? <Check_ key="r" state="pass" label="A person confirmed it" measure={c.review_state} />
      : <Check_ key="r" state="pending" label="A person confirms it" measure={isReviewer ? "waiting on you" : "waiting"} />);
  }
  if (c.status === "missing" && c.origin !== "checklist") rows.push(<Check_ key="m" state="flag" status="missing" label="A successor needs this, but no source covers it" />);
  return (
    <div className="overflow-hidden rounded-lg border border-line">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-line bg-bg-sunk px-3.5 py-2">
        <p className="text-[13px] font-semibold text-fg">Why it&apos;s {promoted ? "reviewer-confirmed" : m.label}</p>
        <p className="text-[12px] text-fg-3">Decided by fixed rules, not by the AI</p>
      </div>
      <ul className="divide-y divide-line">{rows}</ul>
    </div>
  );
}

/** Evidence of the other side(s) of a conflict, fetched so both sides sit next to each other. */
function OtherEvidence({ id, value }: { id: string; value: string | null }) {
  const d = useApi<ClaimDetail>(`/claims/${id}`);
  if (!d.data) return null;
  return <>{d.data.evidence.map((e) => <EvidenceCard key={e.id} e={e} tag={value ? `says ${value}` : null} />)}</>;
}

function ClaimPanel({ id, position, total, onPrev, onNext, onChanged, onReviewed }:
  { id: string; position: number; total: number; onPrev: () => void; onNext: () => void; onChanged: () => void; onReviewed?: (id: string) => void }) {
  const { ws } = useWorkspace();
  const toast = useToast();
  const detail = useApi<ClaimDetail>(`/claims/${id}`);
  const [mode, setMode] = useState<"idle" | "edit" | "promote" | "reject" | "comment">("idle");
  const [text, setText] = useState("");
  const [note, setNote] = useState("");
  const [pick, setPick] = useState<string | null>(null);
  const [resolveNote, setResolveNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [resolving, setResolving] = useState<{ key: string; label: string } | null>(null);
  const isReviewer = ws.persona.roles.includes("reviewer");
  const isLeaver = ws.persona.roles.includes("leaver");
  const writable = !ws.read_only;
  const successor = ws.members.find((m) => m.roles.includes("successor"))?.name ?? "the successor";

  if (detail.loading) return <div className="flex items-center gap-2 p-6 text-[13px] text-fg-3"><Spinner className="h-4 w-4" /> Loading evidence…</div>;
  if (detail.error || !detail.data) return <div className="p-6"><Alert tone="error">{detail.error ?? "Not found"}</Alert></div>;
  const c = detail.data;
  const m = STATUS_META[c.status as Status];
  const others = c.conflict?.others ?? [];
  const openConflict = !!c.conflict && !c.conflict.resolved;

  async function act(action: string, body: Record<string, string> = {}) {
    setBusy(true);
    setErr(null);
    try {
      const wasUnreviewed = c.review_state === "none";
      await api(`/claims/${c.id}/review`, { workspaceId: ws.id, method: "POST", body: { action, ...body } });
      setMode("idle");
      setNote("");
      const claimId = c.id;
      const undoable = wasUnreviewed && (action === "confirm" || action === "reject");
      toast(ACTION_TOAST[action] ?? "Saved", "success", undoable ? {
        label: "Undo",
        onClick: async () => {
          try {
            await api(`/claims/${claimId}/review`, { workspaceId: ws.id, method: "POST", body: { action: "restore" } });
            toast("Undone");
            onChanged();
          } catch (e) {
            toast(e instanceof Error ? e.message : String(e), "error");
          }
        },
      } : undefined);
      detail.reload();
      onChanged();
      if (action === "confirm" || action === "reject") onReviewed?.(claimId); // move on to the next claim
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  // F11: the choice shows at once (with a spinner) while the server re-grades the group; on failure it reverts.
  async function resolve(body: Record<string, unknown>, msg: string, pending: { key: string; label: string }) {
    setBusy(true);
    setErr(null);
    setResolving(pending);
    try {
      await api(`/conflicts/${c.conflict!.id}/resolve`, { workspaceId: ws.id, method: "POST", body });
      toast(msg); // the toast lives in the shell, so it still shows if the reviewer has moved on
      detail.reload();
      onChanged();
    } catch (e) {
      setResolving(null);
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  const options = openConflict ? [c, ...others] : [];
  const chosen = options.find((o) => o.id === pick);
  const doResolve = () => {
    const n = resolveNote.trim() || undefined;
    if (pick === "risk") void resolve({ keep_as_risk: true, note: n ?? "Unclear which is current" }, "Kept both as an open risk", { key: "risk", label: "Keeping both as an open risk" });
    else if (chosen) void resolve({ winner_claim_id: chosen.id, note: n }, "Marked as current; the other is superseded",
      { key: chosen.id, label: `Marking “${chosen.text.length > 60 ? `${chosen.text.slice(0, 60)}…` : chosen.text}” as current` });
  };

  const canConfirm = c.evidence.some((e) => e.quote_found && e.verdict === "supports") && c.review_state !== "confirmed";
  const onShortcut = (k: string) => {
    if (!writable || !isReviewer || busy || mode !== "idle") return;
    if (k === "c" && canConfirm && c.status !== "rejected" && !openConflict) void act("confirm");
    else if (k === "r" && c.status !== "rejected") setMode("reject");
    else if (k === "e") { setText(c.text); setMode("edit"); }
  };
  const access = [...new Set(c.evidence.map((e) => e.source.access))];
  const allPublic = access.length > 0 && access.every((a) => a === "All members");
  const firstRef = c.source_refs[0];
  const lastReview = c.history[c.history.length - 1];
  const evidenceSources = new Set(c.evidence.map((e) => e.source.id)).size;

  return (
    <article className="flex min-h-0 flex-1 flex-col" data-testid="claim-panel">
      <ShortcutBinder onKey={onShortcut} />
      {/* header */}
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-line px-4">
        {clm(c.number) && <span className="font-mono text-[12px] text-fg-3">{clm(c.number)}</span>}
        {total > 0 && <span className="text-[12px] text-fg-3">· {position} of {total}</span>}
        <span className="ml-auto flex items-center gap-0.5">
          <IconButton aria-label="Previous claim" title="Previous (k)" onClick={onPrev}><ChevronUp /></IconButton>
          <IconButton aria-label="Next claim" title="Next (j)" onClick={onNext}><ChevronDown /></IconButton>
          <IconButton aria-label="Copy a link to this claim" title="Copy a link to this claim" data-testid="copy-claim-link"
            onClick={() => {
              const url = `${window.location.origin}/w/${ws.id}/review?tab=all&claim=${c.id}`;
              void navigator.clipboard.writeText(url).then(() => toast("Link to this claim copied"), () => toast(url, "info"));
            }}><Link2 /></IconButton>
        </span>
      </div>

      {/* body */}
      <div className="scroll-quiet min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="mx-auto max-w-[880px] px-5 py-5 sm:px-7">
          <div className="flex flex-wrap items-center gap-2">
            <StatusChip status={c.status as Status} promoted={!!c.flags?.reviewer_confirmed_without_evidence} size="md" />
            <span className="text-[12px] text-fg-3">{c.type_label}</span>
            {c.origin === "checklist" && <span className="text-[12px] text-fg-3">· from the repository checklist</span>}
            {c.origin === "testimony" && <span className="text-[12px] text-fg-3">· leaver testimony</span>}
            {!c.stated && <span className="inline-flex items-center gap-1 text-[12px] text-fg-3" title="The AI marked this as likely but not stated"><Sparkles className="h-3 w-3" /> not explicitly stated</span>}
          </div>
          <h1 className="mt-2.5 text-[20px] font-semibold leading-7 tracking-[-0.015em] text-fg">{c.text}</h1>
          <p className="mt-1.5 text-[13px] leading-5 text-fg-3" data-testid="status-reason">
            <span className={`font-medium ${m.text}`}>Why {m.label.toLowerCase()}:</span> {c.status_reason}
          </p>

          {c.source_changed && (
            <div className="mt-4"><Alert tone="warn"><span data-testid="source-changed"><b className="font-semibold">The source changed after this claim was made.</b> {c.source_changed.note} (noticed {c.source_changed.at.slice(0, 10)}). Confirm, edit, promote with a note, or reject it; any of these clears this notice.</span></Alert></div>
          )}

          <PropertyList className="mt-5" rows={[
            { label: "Subject", value: <code className="rounded-[4px] border border-line bg-bg-sunk px-1.5 font-mono text-[12px] leading-5">{c.subject_key}</code> },
            ...(others.length ? [{ label: "Conflicts with", value: <span className="min-w-0 truncate">{others.map((o) => <span key={o.id}>{clm(o.number) && <span className="mr-1.5 font-mono text-[12px] text-fg-3">{clm(o.number)}</span>}{o.text}</span>)}</span> }] : []),
            ...(c.superseded_by_text ? [{ label: "Replaced by", value: <span className="min-w-0 truncate">{c.superseded_by_text}</span> }] : []),
            { label: "Stated", value: c.occurred_at ? <span>{new Date(c.occurred_at).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}{firstRef && <span className="text-fg-3"> · {firstRef}</span>}</span> : <span className="text-fg-3">{firstRef ?? "Not dated"}</span> },
            { label: "Visible to", value: access.length ? (allPublic ? <span className="inline-flex items-center gap-1.5"><Users className="h-3.5 w-3.5 text-fg-3" /> All members <span className="text-fg-3">· every cited source is open to the team</span></span> : <span className="text-con">{access.filter((a) => a !== "All members").join(", ")} <span className="text-fg-3">· withheld from anyone else</span></span>) : <span className="text-fg-3">No cited source</span> },
            { label: "Review", value: c.review_state === "none" ? <span className="text-fg-3">Not reviewed</span> : <span>{REVIEW_LABEL[c.review_state] ?? c.review_state}{lastReview && <span className="text-fg-3"> · {lastReview.actor_role} · {lastReview.at.slice(0, 10)}</span>}</span> },
          ]} />

          <div className="mt-5"><RuleChecks c={c} others={others} isReviewer={isReviewer} /></div>

          {/* evidence */}
          <div className="mt-6 flex items-baseline gap-2">
            <h2 className="text-[14px] font-semibold text-fg">Evidence</h2>
            <span className="text-[12.5px] text-fg-3">
              {c.evidence.length === 0 ? "none" : `${c.evidence.length} quote${c.evidence.length === 1 ? "" : "s"} from ${evidenceSources} source${evidenceSources === 1 ? "" : "s"}`}{openConflict ? ", side by side" : ""}
            </span>
          </div>
          {c.evidence.length === 0 && !openConflict ? (
            <p className="mt-2 rounded-lg border border-dashed border-line-2 px-3.5 py-3 text-[13px] text-fg-3">
              {c.status === "missing" ? "No source covers this. It goes on the list of questions for the leaver." : "No evidence was cited."}
            </p>
          ) : (
            openConflict ? (
              <div className="mt-2 grid items-start gap-3 md:grid-cols-2">
                <div className="min-w-0 space-y-2">
                  <p className="text-[12px] font-medium text-fg-3"><span className="font-mono">{clm(c.number) ?? "This claim"}</span> · this claim</p>
                  {c.evidence.map((e) => <EvidenceCard key={e.id} e={e} tag={c.value ? `says ${c.value}` : null} />)}
                </div>
                {others.map((o) => (
                  <div key={o.id} className="min-w-0 space-y-2">
                    <p className="text-[12px] font-medium text-fg-3"><span className="font-mono">{clm(o.number) ?? "Other claim"}</span> · the claim it disagrees with</p>
                    <OtherEvidence id={o.id} value={o.value} />
                  </div>
                ))}
              </div>
            ) : (
              <div className="mt-2 grid grid-cols-1 gap-3">
                {c.evidence.map((e) => <EvidenceCard key={e.id} e={e} tag={null} />)}
              </div>
            )
          )}

          {/* resolve (conflicts only) */}
          {openConflict && resolving && (
            <div className="mt-6"><Alert tone="info"><span className="inline-flex items-center gap-2" data-testid="resolving"><Spinner className="h-3.5 w-3.5" /> {resolving.label}. Re-grading the claims…</span></Alert></div>
          )}
          {openConflict && !resolving && isReviewer && writable && (
            <div className="mt-6">
              <h2 className="text-[14px] font-semibold text-fg">Resolve</h2>
              <p className="mt-0.5 text-[12.5px] text-fg-3">Which one is current? The other is kept as history, never deleted.</p>
              <div className="mt-2.5 grid gap-2" role="radiogroup" aria-label="Which claim is current">
                {[...options.map((o) => ({ key: o.id, title: o.value ? `Keep ${o.value}` : "This one is current", body: o.text })),
                  { key: "risk", title: "Keep both as an open risk", body: `${successor} sees both, flagged as a conflict to check.` }].map((o) => {
                  const on = pick === o.key;
                  return (
                    <button key={o.key} type="button" role="radio" aria-checked={on} onClick={() => setPick(o.key)}
                      className={`flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-left transition-colors ${on ? "border-accent shadow-[0_0_0_1px_var(--accent)]" : "border-line hover:bg-hover"}`}>
                      <span className={`mt-0.5 grid h-3.5 w-3.5 shrink-0 place-items-center rounded-full border ${on ? "border-accent" : "border-line-2"}`}>{on && <span className="h-2 w-2 rounded-full bg-accent" />}</span>
                      <span className="min-w-0">
                        <span className="block text-[13px] font-medium text-fg">{o.title}</span>
                        <span className="block text-[12.5px] text-fg-3">{o.body}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
              <label className="mt-3 block text-[12.5px] font-medium text-fg-2">Note for {successor} <span className="font-normal text-fg-3">(optional)</span>
                <textarea value={resolveNote} onChange={(e) => setResolveNote(e.target.value)} rows={2} maxLength={500}
                  placeholder="e.g. Code is the source of truth. Raise MAX_BYTES only if organisers complain again."
                  className="mt-1 w-full rounded-md border border-line-2 bg-bg px-2.5 py-2 text-[13px] text-fg outline-none placeholder:text-fg-4 focus:ring-2 focus:ring-[var(--ring)]" />
              </label>
            </div>
          )}

          {c.history.length > 0 && (
            <details className="mt-6 text-[12.5px] text-fg-3">
              <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 font-medium hover:text-fg"><History className="h-3.5 w-3.5" /> Review history ({c.history.length})</summary>
              <ul className="mt-2 space-y-1 pl-5">
                {c.history.map((h, i) => <li key={i}><span className="font-mono text-[11.5px]">{h.at.slice(0, 16).replace("T", " ")}</span> · {h.actor_role} · {h.action}{h.note ? `: “${h.note}”` : ""}</li>)}
              </ul>
            </details>
          )}
        </div>
      </div>

      {/* sticky action bar */}
      {writable && (isReviewer || isLeaver) && (
        <div className="shrink-0 border-t border-line bg-bg px-4 py-2.5">
          {mode === "idle" && (
            <div className="flex flex-wrap items-center gap-1.5">
              {isReviewer && openConflict && !resolving && (
                <Button size="sm" disabled={!pick || busy} onClick={doResolve} data-testid="resolve-conflict">
                  {pick === "risk" ? "Keep both as an open risk" : chosen ? `Resolve: ${chosen.value ? `keep ${chosen.value}` : "keep this one"}` : "Pick an option to resolve"} <Kbd className="border-white/40 bg-transparent text-white/80">↵</Kbd>
                </Button>
              )}
              {isReviewer && c.status !== "rejected" && (
                <>
                  {canConfirm && !openConflict && <Button size="sm" loading={busy} onClick={() => act("confirm")} data-testid="confirm"><Check /> Confirm <Kbd className="border-white/40 bg-transparent text-white/80">C</Kbd></Button>}
                  <Button size="sm" variant="secondary" disabled={busy} onClick={() => { setText(c.text); setMode("edit"); }}><Edit3 /> Edit <Kbd>E</Kbd></Button>
                  {["inferred", "missing"].includes(c.status) && (
                    <Button size="sm" variant="secondary" disabled={busy} onClick={() => setMode("promote")} title="Mark as true without source evidence (needs a note)"><Sparkles /> Promote with note</Button>
                  )}
                  <Button size="sm" variant="secondary" disabled={busy} onClick={() => setMode("reject")}><X /> Reject <Kbd>R</Kbd></Button>
                </>
              )}
              {isReviewer && c.status === "rejected" && <Button size="sm" variant="secondary" loading={busy} onClick={() => act("restore")}><RotateCcw /> Restore</Button>}
              {isLeaver && !isReviewer && <Button size="sm" variant="secondary" onClick={() => setMode("comment")}><Edit3 /> Add a comment or correction</Button>}
              {isReviewer && <span className="ml-auto hidden text-[12px] text-fg-3 xl:inline">Next unreviewed opens automatically</span>}
            </div>
          )}
          {mode === "edit" && (
            <div className="space-y-2">
              <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} maxLength={400} autoFocus
                className="w-full rounded-md border border-line-2 bg-bg px-2.5 py-2 text-[13px] text-fg outline-none focus:ring-2 focus:ring-[var(--ring)]" />
              <p className="text-[12px] text-fg-3">Saving re-runs the independent verifier on your new wording, so the status stays honest.</p>
              <div className="flex gap-1.5">
                <Button size="sm" loading={busy} onClick={() => act("edit", { text })}>{busy ? "Re-verifying…" : "Save and re-verify"}</Button>
                <Button size="sm" variant="ghost" onClick={() => setMode("idle")}>Cancel</Button>
              </div>
            </div>
          )}
          {(mode === "promote" || mode === "reject" || mode === "comment") && (
            <div className="space-y-2">
              <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={500} autoFocus
                placeholder={mode === "promote" ? "Why is this true without a source? (required, e.g. 'Rohan confirmed in person on 3 Nov')" : mode === "reject" ? "Reason (optional)" : "Your comment"}
                className="w-full rounded-md border border-line-2 bg-bg px-2.5 py-2 text-[13px] text-fg outline-none placeholder:text-fg-4 focus:ring-2 focus:ring-[var(--ring)]" />
              <div className="flex gap-1.5">
                <Button size="sm" variant={mode === "reject" ? "danger" : "primary"} loading={busy} disabled={mode !== "reject" && !note.trim()} onClick={() => act(mode, { note })}>
                  {mode === "promote" ? "Promote" : mode === "reject" ? "Reject claim" : "Add comment"}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setMode("idle")}>Cancel</Button>
              </div>
            </div>
          )}
          {err && <div className="mt-2"><Alert tone="error">{err}</Alert></div>}
        </div>
      )}
      {!writable && <p className="shrink-0 border-t border-line px-4 py-2.5 text-[12px] text-fg-3">Read-only copy. <Link href="/" className="text-accent-ink hover:underline">Open your own demo</Link> to review.</p>}
    </article>
  );
}

/** Subscribes to the page's keyboard shortcuts and always calls the latest handler. */
function ShortcutBinder({ onKey }: { onKey: (k: string) => void }) {
  const latest = useRef(onKey);
  useEffect(() => {
    latest.current = onKey;
  });
  useEffect(() => {
    const on = (e: Event) => latest.current((e as CustomEvent<string>).detail);
    window.addEventListener("baton:shortcut", on);
    return () => window.removeEventListener("baton:shortcut", on);
  }, []);
  return null;
}
