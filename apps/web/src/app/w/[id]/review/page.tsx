"use client";

import { ArrowRight, Check, ClipboardCopy, Download, Edit3, Github, History, Inbox, Keyboard, ListChecks, RotateCcw, Search, Sparkles, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";

import { CoachBar } from "@/components/CoachBar";
import { EvidenceCard } from "@/components/ledger/EvidenceCard";
import { STATUS_HELP, STATUS_META, STATUS_ORDER, StatusChip } from "@/components/ledger/StatusChip";
import { useToast } from "@/components/Toast";
import { NotForPersona } from "@/components/workspace/NotForPersona";
import { useWorkspace } from "@/components/workspace/WorkspaceShell";
import { Alert, Button, ButtonLink, Card, EmptyState, PageHeader, SkeletonList, Spinner } from "@/components/ui";
import { api, type ClaimDetail, type ClaimSummary, type Ledger, type Status } from "@/lib/api";
import { useApi } from "@/lib/useApi";

const TABS = [
  { key: "all", label: "All claims" },
  { key: "conflicts", label: "Conflicts" },
  { key: "missing", label: "Missing" },
  { key: "rejected", label: "Rejected" },
] as const;

export default function ReviewPage() {
  return (
    <Suspense fallback={<SkeletonList rows={5} />}>
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

  const canSee = ws.persona.roles.some((r) => ["reviewer", "admin", "leaver"].includes(r));
  const qs = new URLSearchParams({ tab, ...(status ? { status } : {}), ...(type ? { type } : {}) }).toString();
  const ledger = useApi<Ledger>(canSee ? `/workspaces/${ws.id}/claims?${qs}` : null);
  const toast = useToast();
  const [selectMode, setSelectMode] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [showKeys, setShowKeys] = useState(false);

  const claimsAll = (ledger.data?.claims ?? []).filter((c) => !q || c.text.toLowerCase().includes(q.toLowerCase()));
  const currentId = selected && claimsAll.some((c) => c.id === selected) ? selected : claimsAll[0]?.id ?? null;

  // Keyboard review: j/k move, c confirm, r reject, e edit, x select, ? help. Ignored while typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.metaKey || e.ctrlKey || e.altKey || t.closest("input, textarea, select, [contenteditable=true]")) return;
      const idx = claimsAll.findIndex((c) => c.id === currentId);
      if (e.key === "j" || e.key === "ArrowDown") {
        const n = claimsAll[Math.min(idx + 1, claimsAll.length - 1)];
        if (n) { setSelected(n.id); document.getElementById(`claim-${n.id}`)?.scrollIntoView({ block: "nearest" }); e.preventDefault(); }
      } else if (e.key === "k" || e.key === "ArrowUp") {
        const p = claimsAll[Math.max(idx - 1, 0)];
        if (p) { setSelected(p.id); document.getElementById(`claim-${p.id}`)?.scrollIntoView({ block: "nearest" }); e.preventDefault(); }
      } else if (e.key === "x" && currentId) {
        setSelectMode(true);
        setPicked((s) => { const n = new Set(s); if (n.has(currentId)) n.delete(currentId); else n.add(currentId); return n; });
      } else if (e.key === "?") {
        setShowKeys((v) => !v);
      } else if (["c", "r", "e"].includes(e.key)) {
        window.dispatchEvent(new CustomEvent("baton:shortcut", { detail: e.key }));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [claimsAll, currentId]);

  if (!canSee) return <NotForPersona step="The draft ledger" />;

  async function bulk(action: "confirm" | "reject") {
    if (action === "reject" && !confirm(`Reject ${picked.size} claims? They won't reach the successor.`)) return;
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

  const claims = claimsAll;
  const current = currentId;
  const progress = ledger.data?.progress;
  const isReviewer = ws.persona.roles.includes("reviewer");
  const successor = ws.members.find((m) => m.roles.includes("successor"))?.name ?? "the successor";

  return (
    <div>
      <CoachBar id="review" step="Step 3 · Verify.">
        Every claim is graded by its evidence. Open one to see the exact quote in its source and why it got its status, then confirm, fix
        or reject it. When you&apos;re done, preview what {successor} will see.
      </CoachBar>

      <PageHeader eyebrow="Verify" title="Inspect and review claims"
        actions={isReviewer ? <ButtonLink href={`/w/${ws.id}/review/preview`}>Preview what {successor} will see <ArrowRight className="h-4 w-4" /></ButtonLink> : undefined} />
      {progress && progress.total > 0 && (
        <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-2xl border border-line bg-card px-4 py-3" data-testid="review-progress">
          <div className="min-w-[200px] flex-1">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-ink">{progress.reviewed} of {progress.total} claims reviewed</span>
              <span className="text-muted">{Math.round((100 * progress.reviewed) / progress.total)}%</span>
            </div>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-paper-2">
              <div className="h-full rounded-full bg-verified-solid transition-all duration-700" style={{ width: `${(100 * progress.reviewed) / progress.total}%` }} />
            </div>
          </div>
          {progress.supported_unconfirmed > 0 && isReviewer && !ws.read_only && (
            <span className="text-xs text-muted">{progress.supported_unconfirmed} supported claims await confirmation</span>
          )}
          <button onClick={() => setShowKeys((v) => !v)} className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs text-muted hover:bg-paper-2 hover:text-ink" title="Keyboard shortcuts">
            <Keyboard className="h-3.5 w-3.5" /> Shortcuts
          </button>
          {isReviewer && !ws.read_only && (
            <Button size="sm" variant={selectMode ? "primary" : "secondary"} onClick={() => { setSelectMode((v) => !v); setPicked(new Set()); }}>
              <ListChecks className="h-4 w-4" /> {selectMode ? "Done selecting" : "Select"}
            </Button>
          )}
        </div>
      )}
      {showKeys && (
        <div className="animate-fade mt-3 flex flex-wrap gap-x-5 gap-y-1.5 rounded-xl bg-paper-2 px-4 py-2.5 text-xs text-ink-2">
          {[["j / ↓", "next claim"], ["k / ↑", "previous"], ["c", "confirm"], ["r", "reject"], ["e", "edit"], ["x", "select for bulk"], ["?", "toggle this help"]].map(([k, d]) => (
            <span key={k}><kbd className="rounded-md border border-line-2 bg-card px-1.5 py-0.5 font-mono text-[11px] text-ink">{k}</kbd> {d}</span>
          ))}
        </div>
      )}
      {picked.size > 0 && (
        <div className="animate-pop sticky top-36 z-10 mt-3 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-ink/15 bg-strong px-4 py-2.5 text-sm text-on-strong shadow-[var(--shadow-lg)]" data-testid="bulk-bar">
          <span><b>{picked.size}</b> selected</span>
          <div className="flex gap-2">
            <Button size="sm" variant="success" loading={bulkBusy} onClick={() => bulk("confirm")}><Check className="h-4 w-4" /> Confirm</Button>
            <Button size="sm" variant="danger" disabled={bulkBusy} onClick={() => bulk("reject")}><X className="h-4 w-4" /> Reject</Button>
            <Button size="sm" variant="ghost" className="text-on-strong hover:bg-on-strong/10" onClick={() => setPicked(new Set())}>Clear</Button>
          </div>
        </div>
      )}
      {ws.read_only && <Alert tone="warn" className="mt-4">This is the shared read-only copy. Go back to the start page and choose <b>Try the demo</b> to get your own editable copy.</Alert>}

      {/* Filter bar */}
      <div className="mt-6 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="no-scrollbar inline-flex w-fit max-w-full overflow-x-auto rounded-xl bg-paper-2 p-1 ring-1 ring-line" role="tablist">
          {TABS.map((t) => {
            const n = ledger.data?.tab_counts[t.key as keyof Ledger["tab_counts"]];
            const active = tab === t.key;
            return (
              <button key={t.key} role="tab" aria-selected={active} onClick={() => setParam("tab", t.key)}
                className={`shrink-0 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition ${active ? "bg-card text-ink shadow-[var(--shadow-sm)]" : "text-muted hover:text-ink"}`}>
                {t.label}{n !== undefined && <span className={`ml-1.5 rounded-md px-1.5 py-px text-[11px] ${active ? "bg-paper-2" : ""}`}>{n}</span>}
              </button>
            );
          })}
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search claims" aria-label="Search claims"
            className="h-10 w-full rounded-xl border border-line bg-card pl-9 pr-3 text-sm outline-none transition focus:border-ink/30 focus:ring-2 focus:ring-amber/30 lg:w-72" />
        </div>
      </div>
      {tab === "all" && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {STATUS_ORDER.map((s) => {
            const on = status === s;
            return (
              <button key={s} onClick={() => setParam("status", on ? null : s)} title={STATUS_HELP[s]}
                className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 transition ${on ? `${STATUS_META[s].chip} ring-2` : "bg-card text-ink-2 ring-line hover:ring-ink/25"}`}>
                <span className={`h-2 w-2 rounded-full ${STATUS_META[s].dot}`} /> {STATUS_META[s].label}
                <span className="text-muted">{ledger.data?.status_counts[s] ?? 0}</span>
              </button>
            );
          })}
          {type && <button onClick={() => setParam("type", null)} className="inline-flex items-center gap-1 rounded-full bg-strong px-2.5 py-1 text-xs font-medium capitalize text-on-strong">{type.replace("_", " ")} <X className="h-3 w-3" /></button>}
        </div>
      )}
      {tab === "missing" && isReviewer && <QuestionsBar workspaceId={ws.id} />}

      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <ul className="stagger scroll-quiet space-y-2 lg:max-h-[calc(100vh-15rem)] lg:overflow-auto lg:pr-1" data-testid="claim-list">
          {ledger.loading && <SkeletonList rows={6} />}
          {ledger.error && <Alert tone="error">{ledger.error}</Alert>}
          {ledger.data && claims.length === 0 && <EmptyState icon={<Inbox className="h-5 w-5" />} title="Nothing here">No claims match this view.</EmptyState>}
          {claims.map((c) => (
            <ClaimRow key={c.id} c={c} active={c.id === current} onClick={() => setSelected(c.id)}
              selectable={selectMode} checked={picked.has(c.id)}
              onToggle={() => setPicked((s) => { const n = new Set(s); if (n.has(c.id)) n.delete(c.id); else n.add(c.id); return n; })} />
          ))}
        </ul>
        <div className="scroll-quiet lg:sticky lg:top-40 lg:max-h-[calc(100vh-11rem)] lg:overflow-auto lg:rounded-2xl">
          {current ? <ClaimPanel key={current} id={current} onChanged={ledger.reload} /> : !ledger.loading && <Card className="p-8 text-center text-sm text-muted">Select a claim to inspect its evidence.</Card>}
        </div>
      </div>
    </div>
  );
}

function ClaimRow({ c, active, onClick, selectable, checked, onToggle }:
  { c: ClaimSummary; active: boolean; onClick: () => void; selectable: boolean; checked: boolean; onToggle: () => void }) {
  return (
    <li id={`claim-${c.id}`} className="flex items-start gap-2">
      {selectable && (
        <input type="checkbox" checked={checked} onChange={onToggle} aria-label="Select claim"
          className="animate-fade mt-4 h-4 w-4 shrink-0 accent-[var(--ink)]" />
      )}
      <button onClick={onClick} aria-current={active}
        className={`group relative w-full overflow-hidden rounded-2xl border p-3.5 pl-4 text-left transition ${active ? "border-ink/25 bg-card shadow-[var(--shadow-md)]" : "border-line bg-card/70 hover:border-line-2 hover:bg-card"}`}>
        <span className={`absolute inset-y-0 left-0 w-1 transition ${active ? STATUS_META[c.status].dot : "bg-transparent group-hover:bg-line-2"}`} />
        <div className="flex items-center gap-2">
          <StatusChip status={c.status} promoted={!!c.flags?.reviewer_confirmed_without_evidence} />
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">{c.type_label}</span>
          {c.review_state === "edited" && <span className="text-[11px] text-muted">· edited</span>}
          {c.origin === "checklist" && <span className="text-[11px] text-muted">· checklist</span>}
        </div>
        <p className="mt-1.5 text-[14px] leading-snug text-ink">{c.text}</p>
        {c.source_refs.length > 0 && <p className="mt-1.5 truncate font-mono text-[11px] text-supported">{c.source_refs.join(" · ")}</p>}
      </button>
    </li>
  );
}

type QuestionsOut = { markdown: string; questions: unknown[]; leaver: string; issue_title: string; issue_body: string };

function QuestionsBar({ workspaceId }: { workspaceId: string }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const get = () => api<QuestionsOut>(`/workspaces/${workspaceId}/questions`, { workspaceId });
  const download = async () => {
    const r = await get();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([r.markdown], { type: "text/markdown" }));
    a.download = "questions-for-leaver.md";
    a.click();
  };
  const copyIssue = async () => {
    const r = await get();
    await navigator.clipboard.writeText(`# ${r.issue_title}\n\n${r.issue_body}`).catch(() => undefined);
    toast("Copied as a GitHub issue (title + checklist). Paste it into a new issue.");
  };
  return (
    <div className="animate-rise mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-missing/20 bg-missing-soft/60 px-4 py-3 text-sm text-missing">
      <span>Missing and conflicting items become targeted questions for the leaver.</span>
      <Button variant="secondary" size="sm" loading={busy} data-testid="copy-questions"
        onClick={async () => {
          setBusy(true);
          try {
            const r = await api<{ markdown: string; questions: unknown[]; leaver: string }>(`/workspaces/${workspaceId}/questions`, { workspaceId });
            await navigator.clipboard.writeText(r.markdown).catch(() => undefined);
            toast(`Copied ${r.questions.length} questions for ${r.leaver} as Markdown`);
          } catch (e) {
            toast(e instanceof Error ? e.message : String(e), "error");
          } finally {
            setBusy(false);
          }
        }}>
        <ClipboardCopy className="h-4 w-4" /> Copy questions for the leaver
      </Button>
      <div className="flex gap-2">
        <Button variant="ghost" size="sm" onClick={() => void copyIssue()}><Github className="h-4 w-4" /> Copy as GitHub issue</Button>
        <Button variant="ghost" size="sm" onClick={() => void download()}><Download className="h-4 w-4" /> Download .md</Button>
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

function ClaimPanel({ id, onChanged }: { id: string; onChanged: () => void }) {
  const { ws } = useWorkspace();
  const toast = useToast();
  const detail = useApi<ClaimDetail>(`/claims/${id}`);
  const [mode, setMode] = useState<"idle" | "edit" | "promote" | "reject" | "comment">("idle");
  const [text, setText] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const isReviewer = ws.persona.roles.includes("reviewer");
  const isLeaver = ws.persona.roles.includes("leaver");
  const writable = !ws.read_only;

  if (detail.loading) return <Card className="flex items-center gap-2 p-8 text-sm text-muted"><Spinner /> Loading evidence…</Card>;
  if (detail.error || !detail.data) return <Alert tone="error">{detail.error ?? "Not found"}</Alert>;
  const c = detail.data;
  const m = STATUS_META[c.status as Status];

  async function act(action: string, body: Record<string, string> = {}) {
    setBusy(true);
    setErr(null);
    try {
      await api(`/claims/${c.id}/review`, { workspaceId: ws.id, method: "POST", body: { action, ...body } });
      setMode("idle");
      setNote("");
      toast(ACTION_TOAST[action] ?? "Saved");
      detail.reload();
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function resolve(body: Record<string, unknown>, msg: string) {
    setBusy(true);
    setErr(null);
    try {
      await api(`/conflicts/${c.conflict!.id}/resolve`, { workspaceId: ws.id, method: "POST", body });
      toast(msg);
      detail.reload();
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const canConfirm = c.evidence.some((e) => e.quote_found && e.verdict === "supports") && c.review_state !== "confirmed";
  const onShortcut = (k: string) => {
    if (!writable || !isReviewer || busy || mode !== "idle") return;
    if (k === "c" && canConfirm && c.status !== "rejected") void act("confirm");
    else if (k === "r" && c.status !== "rejected") setMode("reject");
    else if (k === "e") { setText(c.text); setMode("edit"); }
  };
  return (
    <article className="animate-pop overflow-hidden rounded-2xl border border-line bg-card shadow-[var(--shadow-md)]" data-testid="claim-panel">
      <ShortcutBinder onKey={onShortcut} />
      <div className={`h-1 ${m.dot}`} />
      <div className="p-5">
        <div className="flex flex-wrap items-center gap-2">
          <StatusChip status={c.status as Status} promoted={!!c.flags?.reviewer_confirmed_without_evidence} size="md" />
          <span className="text-xs font-semibold uppercase tracking-wider text-muted">{c.type_label}</span>
          {c.origin === "checklist" && <span className="rounded-full bg-paper-2 px-2 py-0.5 text-[11px] text-ink-2 ring-1 ring-line">From the repo checklist</span>}
          {!c.stated && <span className="inline-flex items-center gap-1 rounded-full bg-paper-2 px-2 py-0.5 text-[11px] text-ink-2 ring-1 ring-line" title="The AI marked this as likely but not stated"><Sparkles className="h-3 w-3" /> Not explicitly stated</span>}
        </div>
        <p className="font-display mt-3 text-[21px] font-medium leading-snug text-ink">{c.text}</p>
        <div className={`mt-4 rounded-xl px-4 py-3 text-sm ${m.soft}`} data-testid="status-reason">
          <span className={`font-semibold ${m.text}`}>Why {m.label.toLowerCase()}: </span>
          <span className="text-ink-2">{c.status_reason}</span>
        </div>

        {c.conflict && !c.conflict.resolved && (
          <div className="mt-4 rounded-xl border border-conflicting/25 bg-conflicting-soft/60 p-4">
            <p className="text-sm font-semibold text-conflicting">Sources disagree. Which is current?</p>
            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
              {[c, ...c.conflict.others].map((o) => (
                <div key={o.id} className="flex flex-col justify-between gap-3 rounded-xl border border-line bg-card p-3">
                  <p className="text-sm text-ink">{o.text}</p>
                  {isReviewer && writable && (
                    <Button size="sm" variant="secondary" disabled={busy} onClick={() => resolve({ winner_claim_id: o.id }, "Marked as current; the other is superseded")}>
                      <Check className="h-3.5 w-3.5" /> This one is current
                    </Button>
                  )}
                </div>
              ))}
            </div>
            {isReviewer && writable && (
              <Button size="sm" variant="ghost" className="mt-2" disabled={busy} onClick={() => resolve({ keep_as_risk: true, note: "Unclear which is current" }, "Kept both as an open risk")}>
                Keep both as an open risk
              </Button>
            )}
          </div>
        )}

        <div className="mt-6 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-ink">Evidence <span className="font-normal text-muted">({c.evidence.length})</span></h3>
        </div>
        <div className="mt-2 space-y-3">
          {c.evidence.length === 0 && (
            <p className="rounded-xl border border-dashed border-line-2 p-4 text-sm text-muted">
              {c.status === "missing" ? "No source covers this. It goes on the list of questions for the leaver." : "No evidence was cited."}
            </p>
          )}
          {c.evidence.map((e) => <EvidenceCard key={e.id} e={e} />)}
        </div>
      </div>

      {writable && (isReviewer || isLeaver) && (
        <div className="border-t border-line bg-paper/60 p-4">
          {mode === "idle" && (
            <div className="flex flex-wrap gap-2">
              {isReviewer && c.status !== "rejected" && (
                <>
                  {canConfirm && <Button variant="success" loading={busy} onClick={() => act("confirm")} data-testid="confirm"><Check className="h-4 w-4" /> Confirm</Button>}
                  <Button variant="secondary" disabled={busy} onClick={() => { setText(c.text); setMode("edit"); }}><Edit3 className="h-4 w-4" /> Edit</Button>
                  {["inferred", "missing"].includes(c.status) && (
                    <Button variant="secondary" disabled={busy} onClick={() => setMode("promote")} title="Mark as true without source evidence (needs a note)"><Sparkles className="h-4 w-4" /> Promote with note</Button>
                  )}
                  <Button variant="danger" disabled={busy} onClick={() => setMode("reject")}><X className="h-4 w-4" /> Reject</Button>
                </>
              )}
              {isReviewer && c.status === "rejected" && <Button variant="secondary" loading={busy} onClick={() => act("restore")}><RotateCcw className="h-4 w-4" /> Restore</Button>}
              {isLeaver && !isReviewer && <Button variant="secondary" onClick={() => setMode("comment")}><Edit3 className="h-4 w-4" /> Add a comment or correction</Button>}
            </div>
          )}
          {mode === "edit" && (
            <div className="animate-fade space-y-2">
              <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} maxLength={400} autoFocus
                className="w-full rounded-xl border border-line bg-card p-3 text-sm outline-none focus:border-ink/30 focus:ring-2 focus:ring-amber/30" />
              <p className="text-xs text-muted">Saving re-runs the independent verifier on your new wording, so the status stays honest.</p>
              <div className="flex gap-2">
                <Button loading={busy} onClick={() => act("edit", { text })}>{busy ? "Re-verifying…" : "Save and re-verify"}</Button>
                <Button variant="ghost" onClick={() => setMode("idle")}>Cancel</Button>
              </div>
            </div>
          )}
          {(mode === "promote" || mode === "reject" || mode === "comment") && (
            <div className="animate-fade space-y-2">
              <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={500} autoFocus
                placeholder={mode === "promote" ? "Why is this true without a source? (required, e.g. 'Rohan confirmed in person on 3 Nov')" : mode === "reject" ? "Reason (optional)" : "Your comment"}
                className="w-full rounded-xl border border-line bg-card p-3 text-sm outline-none focus:border-ink/30 focus:ring-2 focus:ring-amber/30" />
              <div className="flex gap-2">
                <Button variant={mode === "reject" ? "danger" : "primary"} loading={busy} disabled={mode !== "reject" && !note.trim()} onClick={() => act(mode, { note })}>
                  {mode === "promote" ? "Promote" : mode === "reject" ? "Reject claim" : "Add comment"}
                </Button>
                <Button variant="ghost" onClick={() => setMode("idle")}>Cancel</Button>
              </div>
            </div>
          )}
          {err && <Alert tone="error" className="mt-3">{err}</Alert>}
        </div>
      )}

      {c.history.length > 0 && (
        <details className="group border-t border-line px-5 py-3 text-xs text-muted">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 font-medium hover:text-ink"><History className="h-3.5 w-3.5" /> Review history ({c.history.length})</summary>
          <ul className="mt-2 space-y-1 pl-5">
            {c.history.map((h, i) => <li key={i}><span className="font-mono">{h.at.slice(0, 16).replace("T", " ")}</span> · {h.actor_role} · {h.action}{h.note ? `: “${h.note}”` : ""}</li>)}
          </ul>
        </details>
      )}
      {!writable && <p className="border-t border-line px-5 py-3 text-xs text-muted">Read-only copy. <Link href="/" className="underline">Open your own demo</Link> to review.</p>}
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
