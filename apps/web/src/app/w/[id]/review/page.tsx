"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

import { CoachBar } from "@/components/CoachBar";
import { EvidenceCard } from "@/components/ledger/EvidenceCard";
import { STATUS_HELP, STATUS_ORDER, StatusChip } from "@/components/ledger/StatusChip";
import { NotForPersona } from "@/components/workspace/NotForPersona";
import { useWorkspace } from "@/components/workspace/WorkspaceShell";
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
    <Suspense fallback={<p className="text-muted">Loading…</p>}>
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

  if (!canSee) return <NotForPersona step="The draft ledger" />;

  const setParam = (k: string, v: string | null) => {
    const next = new URLSearchParams(params.toString());
    if (v) next.set(k, v);
    else next.delete(k);
    if (k === "tab") {
      next.delete("status");
      next.delete("type");
    }
    router.replace(`${pathname}?${next.toString()}`);
  };

  const claims = (ledger.data?.claims ?? []).filter((c) => !q || c.text.toLowerCase().includes(q.toLowerCase()));
  const current = selected ?? claims[0]?.id ?? null;
  const isReviewer = ws.persona.roles.includes("reviewer");
  const successor = ws.members.find((m) => m.roles.includes("successor"));

  return (
    <div>
      <CoachBar id="review">
        <b>Step 3 · Verify.</b> Every claim is graded by its evidence. Open one to see the exact quote in its source and why
        it got its status, then confirm, fix or reject it. When you&apos;re done, preview what {successor?.name ?? "the successor"} will see.
      </CoachBar>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight text-navy">Verify and review claims</h1>
        {isReviewer && (
          <Link href={`/w/${ws.id}/review/preview`} className="rounded-lg bg-navy px-4 py-2 text-sm font-semibold text-white hover:bg-navy/90">
            Preview what {successor?.name ?? "the successor"} will see →
          </Link>
        )}
      </div>
      {ws.read_only && (
        <p className="mt-3 rounded-lg bg-amber/10 p-3 text-sm text-navy ring-1 ring-amber/40">
          This is the shared read-only copy. Go back to the start page and click <b>Try the demo</b> to get your own editable copy.
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-1 border-b border-line">
        {TABS.map((t) => {
          const n = ledger.data?.tab_counts[t.key as keyof Ledger["tab_counts"]];
          return (
            <button key={t.key} onClick={() => { setSelected(null); setParam("tab", t.key); }}
              className={`-mb-px border-b-2 px-3 py-2 text-sm ${tab === t.key ? "border-navy font-semibold text-navy" : "border-transparent text-muted hover:text-navy"}`}>
              {t.label}{n !== undefined ? ` (${n})` : ""}
            </button>
          );
        })}
        <Link href={`/w/${ws.id}/ledger`} className="ml-auto px-3 py-2 text-sm text-muted hover:text-navy">Timeline →</Link>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {tab === "all" && STATUS_ORDER.map((s) => (
          <button key={s} onClick={() => setParam("status", status === s ? null : s)} title={STATUS_HELP[s]}
            className={`rounded-full ${status === s ? "ring-2 ring-navy" : ""}`}>
            <span className="flex items-center gap-1"><StatusChip status={s} /><span className="pr-2 text-xs text-muted">{ledger.data?.status_counts[s] ?? 0}</span></span>
          </button>
        ))}
        {type && <button onClick={() => setParam("type", null)} className="rounded-full bg-panel px-2 py-0.5 text-xs ring-1 ring-line">type: {type} ✕</button>}
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search claims…" className="ml-auto w-48 rounded-lg border border-line px-3 py-1.5 text-sm" />
      </div>

      {tab === "missing" && isReviewer && <QuestionsBar workspaceId={ws.id} />}

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <ul className="max-h-[70vh] space-y-2 overflow-auto pr-1" data-testid="claim-list">
          {ledger.loading && <li className="text-muted">Loading…</li>}
          {ledger.error && <li className="text-rose-700">{ledger.error}</li>}
          {ledger.data && claims.length === 0 && <li className="rounded-lg border border-dashed border-line p-6 text-center text-sm text-muted">Nothing here.</li>}
          {claims.map((c) => <ClaimRow key={c.id} c={c} active={c.id === current} onClick={() => setSelected(c.id)} />)}
        </ul>
        <div>{current ? <ClaimPanel key={current} id={current} onChanged={ledger.reload} /> : null}</div>
      </div>
    </div>
  );
}

function ClaimRow({ c, active, onClick }: { c: ClaimSummary; active: boolean; onClick: () => void }) {
  return (
    <li>
      <button onClick={onClick} className={`w-full rounded-xl border p-3 text-left ${active ? "border-navy bg-white shadow-sm" : "border-line bg-white hover:border-navy/30"}`}>
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">{c.type_label}</span>
          <StatusChip status={c.status} promoted={!!c.flags?.reviewer_confirmed_without_evidence} />
          {c.review_state === "edited" && <span className="text-[11px] text-muted">edited</span>}
        </div>
        <p className="mt-1 text-sm text-navy">{c.text}</p>
        {c.source_refs.length > 0 && <p className="mt-1 truncate text-xs text-blue-700">{c.source_refs.join(" · ")}</p>}
      </button>
    </li>
  );
}

function QuestionsBar({ workspaceId }: { workspaceId: string }) {
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <div className="mt-3 flex flex-wrap items-center gap-3 rounded-xl bg-rose-50 p-3 text-sm text-rose-900 ring-1 ring-rose-200">
      <span>Missing and conflicting items become questions for the leaver.</span>
      <button className="rounded-lg bg-white px-3 py-1.5 font-semibold ring-1 ring-rose-300 hover:bg-rose-100" data-testid="copy-questions"
        onClick={async () => {
          try {
            const r = await api<{ markdown: string; questions: unknown[]; leaver: string }>(`/workspaces/${workspaceId}/questions`, { workspaceId });
            await navigator.clipboard.writeText(r.markdown).catch(() => undefined);
            setMsg(`Copied ${r.questions.length} questions for ${r.leaver} as Markdown.`);
          } catch (e) {
            setMsg(e instanceof Error ? e.message : String(e));
          }
        }}>
        Copy questions for the leaver
      </button>
      {msg && <span className="font-medium">{msg}</span>}
    </div>
  );
}

function ClaimPanel({ id, onChanged }: { id: string; onChanged: () => void }) {
  const { ws } = useWorkspace();
  const detail = useApi<ClaimDetail>(`/claims/${id}`);
  const [mode, setMode] = useState<"idle" | "edit" | "promote" | "reject" | "comment">("idle");
  const [text, setText] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const isReviewer = ws.persona.roles.includes("reviewer");
  const isLeaver = ws.persona.roles.includes("leaver");
  const writable = !ws.read_only;

  if (detail.loading) return <div className="rounded-xl border border-line p-6 text-muted">Loading evidence…</div>;
  if (detail.error || !detail.data) return <div className="rounded-xl border border-line p-6 text-rose-700">{detail.error ?? "Not found"}</div>;
  const c = detail.data;

  async function act(action: string, body: Record<string, string> = {}) {
    setBusy(true);
    setErr(null);
    try {
      await api(`/claims/${c.id}/review`, { workspaceId: ws.id, method: "POST", body: { action, ...body } });
      setMode("idle");
      setNote("");
      detail.reload();
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function resolve(body: Record<string, unknown>) {
    setBusy(true);
    setErr(null);
    try {
      await api(`/conflicts/${c.conflict!.id}/resolve`, { workspaceId: ws.id, method: "POST", body });
      detail.reload();
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const btn = "rounded-lg px-3 py-1.5 text-sm font-semibold disabled:opacity-50";
  return (
    <article className="rounded-xl border border-line bg-panel p-4" data-testid="claim-panel">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted">{c.type_label}</span>
        <StatusChip status={c.status as Status} promoted={!!c.flags?.reviewer_confirmed_without_evidence} />
        {c.origin === "checklist" && <span className="rounded-full bg-white px-2 py-0.5 text-[11px] text-muted ring-1 ring-line">from repo checklist</span>}
        {!c.stated && <span className="rounded-full bg-white px-2 py-0.5 text-[11px] text-muted ring-1 ring-line" title="The AI marked this as likely but not stated">AI: not explicitly stated</span>}
      </div>
      <p className="mt-2 text-base font-medium text-navy">{c.text}</p>
      <p className="mt-2 rounded-lg bg-white p-3 text-sm text-zinc-700 ring-1 ring-line" data-testid="status-reason">
        <b className="capitalize">{c.status}:</b> {c.status_reason}
      </p>

      {c.conflict && !c.conflict.resolved && (
        <div className="mt-4 rounded-xl bg-orange-50 p-3 ring-1 ring-orange-200">
          <p className="text-sm font-semibold text-orange-900">Sources disagree</p>
          <ul className="mt-2 space-y-2 text-sm">
            {[c, ...c.conflict.others].map((o) => (
              <li key={o.id} className="flex items-start justify-between gap-2 rounded-lg bg-white p-2 ring-1 ring-orange-100">
                <span>{o.text}</span>
                {isReviewer && writable && (
                  <button disabled={busy} onClick={() => resolve({ winner_claim_id: o.id })} className={`${btn} shrink-0 bg-orange-600 text-white`}>This is current</button>
                )}
              </li>
            ))}
          </ul>
          {isReviewer && writable && (
            <button disabled={busy} onClick={() => resolve({ keep_as_risk: true, note: "Unclear which is current" })} className={`${btn} mt-2 bg-white text-orange-900 ring-1 ring-orange-300`}>
              Keep both as an open risk
            </button>
          )}
        </div>
      )}

      <h3 className="mt-4 text-sm font-semibold text-navy">Evidence ({c.evidence.length})</h3>
      <div className="mt-2 space-y-3">
        {c.evidence.length === 0 && (
          <p className="rounded-lg border border-dashed border-line bg-white p-4 text-sm text-muted">
            {c.status === "missing" ? "No source covers this. It goes on the questions list for the leaver." : "No evidence was cited."}
          </p>
        )}
        {c.evidence.map((e) => <EvidenceCard key={e.id} e={e} />)}
      </div>

      {writable && (isReviewer || isLeaver) && (
        <div className="mt-4 border-t border-line pt-4">
          {mode === "idle" && (
            <div className="flex flex-wrap gap-2">
              {isReviewer && c.status !== "rejected" && (
                <>
                  {c.evidence.some((e) => e.quote_found && e.verdict === "supports") && c.review_state !== "confirmed" && (
                    <button disabled={busy} onClick={() => act("confirm")} className={`${btn} bg-emerald-600 text-white`} data-testid="confirm">Confirm</button>
                  )}
                  <button disabled={busy} onClick={() => { setText(c.text); setMode("edit"); }} className={`${btn} bg-white text-navy ring-1 ring-line`}>Edit</button>
                  {["inferred", "missing"].includes(c.status) && (
                    <button disabled={busy} onClick={() => setMode("promote")} className={`${btn} bg-white text-navy ring-1 ring-line`} title="Mark as true without source evidence (needs a note)">Promote with note</button>
                  )}
                  <button disabled={busy} onClick={() => setMode("reject")} className={`${btn} bg-white text-rose-700 ring-1 ring-rose-200`}>Reject</button>
                </>
              )}
              {isReviewer && c.status === "rejected" && <button disabled={busy} onClick={() => act("restore")} className={`${btn} bg-white text-navy ring-1 ring-line`}>Restore</button>}
              {isLeaver && !isReviewer && <button onClick={() => setMode("comment")} className={`${btn} bg-white text-navy ring-1 ring-line`}>Add a comment or correction</button>}
            </div>
          )}
          {mode === "edit" && (
            <div className="space-y-2">
              <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} maxLength={400} className="w-full rounded-lg border border-line p-2 text-sm" />
              <p className="text-xs text-muted">Saving re-runs the verifier on your new wording, so the status stays honest.</p>
              <div className="flex gap-2">
                <button disabled={busy} onClick={() => act("edit", { text })} className={`${btn} bg-navy text-white`}>{busy ? "Re-verifying…" : "Save and re-verify"}</button>
                <button onClick={() => setMode("idle")} className={`${btn} text-muted`}>Cancel</button>
              </div>
            </div>
          )}
          {(mode === "promote" || mode === "reject" || mode === "comment") && (
            <div className="space-y-2">
              <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={500}
                placeholder={mode === "promote" ? "Why is this true without a source? (required, e.g. 'Rohan confirmed in person on 3 Nov')" : mode === "reject" ? "Reason (optional)" : "Your comment"}
                className="w-full rounded-lg border border-line p-2 text-sm" />
              <div className="flex gap-2">
                <button disabled={busy || (mode !== "reject" && !note.trim())} onClick={() => act(mode, { note })}
                  className={`${btn} ${mode === "reject" ? "bg-rose-600" : "bg-navy"} text-white`}>
                  {mode === "promote" ? "Promote" : mode === "reject" ? "Reject claim" : "Add comment"}
                </button>
                <button onClick={() => setMode("idle")} className={`${btn} text-muted`}>Cancel</button>
              </div>
            </div>
          )}
          {err && <p className="mt-2 text-sm text-rose-700">{err}</p>}
        </div>
      )}

      {c.history.length > 0 && (
        <details className="mt-4 text-xs text-muted">
          <summary className="cursor-pointer">Review history ({c.history.length})</summary>
          <ul className="mt-1 space-y-0.5">
            {c.history.map((h, i) => <li key={i}>{h.at.slice(0, 16).replace("T", " ")} · {h.actor_role} · {h.action}{h.note ? `: “${h.note}”` : ""}</li>)}
          </ul>
        </details>
      )}
    </article>
  );
}
